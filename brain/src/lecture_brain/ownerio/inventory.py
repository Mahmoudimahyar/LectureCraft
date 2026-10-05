"""Complete per-course source inventory (LL009).

The owner's source index is a planning/logistics index and deliberately leaves most recordings,
many slide decks and all textbooks unregistered. The all-lecture denominator therefore comes from
enumerating ``materials/`` on disk and reconciling it with the published index. Every unit keeps an
explicit state; nothing is dropped because it is missing, empty, unregistered or not displayable.

Lecture ↔ session correspondence is taken only from structured owner evidence
(``related_source_ids``). Where the owner recorded none, it stays "none recorded" — it is never
guessed from ordinal position.
"""
from __future__ import annotations

from pathlib import Path
import hashlib
import re
from typing import Any

from ..config import CourseBinding, Settings
from ..contracts import ContractError, resolve_inside
from . import OwnerReadError
from .source_index import read_source_index

_LECTURE_DIR = re.compile(r"(?i)^lecture-\d{2}$")
_SESSION_DIR = re.compile(r"^(\d{4}-\d{2}-\d{2})-lecture$")
_SOLUTION = re.compile(r"(?i)solution|answer[-_ ]?key|assessor")
_MEDIA_TYPES = {
    ".pdf": "application/pdf", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".ppt": "application/vnd.ms-powerpoint",
    ".key": "application/vnd.apple.keynote", ".txt": "text/plain", ".md": "text/markdown", ".vtt": "text/vtt", ".srt": "application/x-subrip",
    ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".html": "text/html", ".json": "application/json", ".csv": "text/csv",
}
_AUDIO_VIDEO = {".m4a", ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".mov"}
_DECK = {".pdf", ".pptx", ".ppt", ".key"}
_FOLDER_KIND = {"assignments": "assignment_brief", "textbook": "textbook", "textbooks": "textbook", "practice": "practice_set", "assessments": "assessment",
                "recitations": "recitation_material", "discussions": "discussion_material", "admin": "course_admin", "communications": "communication_export"}
MAX_ENUMERATED_FILES = 5000


def unregistered_source_id(relative_path: str) -> str:
    """Stable id for a file present on disk but absent from the owner's source index."""
    return "unreg-" + hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:20]


def disk_version_id(sha256: str) -> str:
    return "disk-" + sha256[:12]


_OPENABLE = {"registered_readable", "present_unindexed"}
PROVISIONAL_NOTE = ("Provisional identity: this file is not in the course index, so the id and version shown were derived by this app from the file's path and bytes. "
                    "They are not course source ids and may change when the course registers the file.")


def identity_status(item: dict) -> str:
    """"registered" when the course index names this file; otherwise "provisional" (an identity derived by this app)."""
    return "registered" if item.get("registration") == "registered" else "provisional"


def is_provisional_ref(ref: dict | None) -> bool:
    """A source reference whose id or version was derived by this app rather than taken from the course index."""
    return bool(ref) and (str(ref.get("source_id") or "").startswith("unreg-") or str(ref.get("version_id") or "").startswith("disk-"))


def primary_deck(lecture: dict) -> dict | None:
    """The deck a lecture unit is shown with. A unit may hold several files: prefer one that can actually be
    displayed (a readable PDF), then any readable deck, and among equals the one the course index registered.
    An empty or unconvertible file that merely sorts first never hides a usable deck beside it."""
    decks = lecture["decks"]
    if not decks:
        return None

    def rank(deck: dict) -> tuple[int, int]:
        readable = deck["state"] in _OPENABLE
        return (0 if readable and deck["rendition"] == "native_pdf" else 1 if readable else 2, 0 if deck["registration"] == "registered" else 1)

    return min(decks, key=rank)  # min keeps list (name) order among equals


def other_materials(lecture: dict) -> list[dict]:
    """Every other file of the unit — further decks and non-deck material — so none is unreachable."""
    primary = primary_deck(lecture)
    rows = []
    for role, items in (("deck", lecture["decks"]), ("extra", lecture["extra_materials"])):
        for item in items:
            if primary is not None and item["source_id"] == primary["source_id"]:
                continue
            rows.append({"source_id": item["source_id"], "filename": item["filename"], "role": role, "kind": item["kind"], "state": item["state"], "registration": item["registration"],
                         "rendition": item["rendition"], "media_type": item["media_type"], "bytes": item["bytes"], "available": item["state"] in _OPENABLE})
    return rows


def media_type_for(name: str) -> str:
    return _MEDIA_TYPES.get(Path(name).suffix.lower(), "application/octet-stream")


def _rendition(name: str | None) -> str:
    if not name:
        return "not_applicable"
    ext = Path(name).suffix.lower()
    if ext == ".pdf":
        return "native_pdf"
    if ext in {".pptx", ".ppt", ".key", ".docx"}:
        return "needs_rendition"
    if ext in _AUDIO_VIDEO:
        return "native_media"
    if ext in {".txt", ".md", ".vtt", ".srt"}:
        return "native_text"
    return "not_applicable"


def _disclosure(kind: str | None, name: str | None) -> str:
    return "restricted_solution" if _SOLUTION.search(kind or "") or _SOLUTION.search(name or "") else "open"


def _registered_item(root: Path, entry: dict) -> dict:
    rel = entry["path"]
    current = entry["current"]
    size = None
    declared_name = Path(rel).name if rel else None
    if rel is not None and not _path_in_course(root, rel):
        # The index is the owner's, but a path is only followed inside this course folder. It is reported, not read.
        rel, state = None, "registered_path_outside_course"
    elif rel is None:
        state = "registered_unavailable"
    else:
        path = root / rel
        if not path.is_file():
            state = "registered_missing_on_disk"
        else:
            size = path.stat().st_size
            if current["availability"] == "empty" or size == 0:
                state = "registered_empty"
            elif current["availability"] in {"unreadable", "unavailable"}:
                state = "registered_unreadable"
            else:
                state = "registered_readable"
    name = declared_name or entry.get("original_filename")
    return {
        "source_id": entry["source_id"], "version_id": current["version_id"], "sha256": current["sha256"], "kind": entry["kind"], "kind_basis": "owner_index",
        "role": entry["role"], "path": rel, "filename": name, "media_type": media_type_for(name) if name else None, "bytes": size, "state": state,
        "registration": "registered", "rendition": _rendition(name), "disclosure": _disclosure(entry["kind"], name), "source_date": entry["source_date"],
        "historical_versions": [dict(v, bytes_available=False) for v in entry["historical_versions"]],
    }


def _path_in_course(root: Path, rel: Any) -> bool:
    """True only for a portable relative path that stays inside the course folder without passing through a link."""
    try:
        resolve_inside(root, rel)
    except (ContractError, OSError):
        return False
    return True


def _disk_item(root: Path, rel: str, kind: str) -> dict:
    path = root / rel
    size = path.stat().st_size
    return {
        "source_id": unregistered_source_id(rel), "version_id": None, "sha256": None, "kind": kind, "kind_basis": "folder_convention", "role": None, "path": rel,
        "filename": path.name, "media_type": media_type_for(path.name), "bytes": size, "state": "present_unindexed" if size else "present_unindexed_empty",
        "registration": "unregistered", "rendition": _rendition(path.name), "disclosure": _disclosure(kind, path.name), "source_date": None, "historical_versions": [],
    }


def _session_state(items: list[dict]) -> str:
    kinds = {i["kind"] for i in items}
    has_t, has_r = "lecture_transcript" in kinds, "lecture_recording" in kinds
    if not items:
        return "empty_unrecorded"
    if has_t and has_r:
        return "transcript_and_recording"
    if has_t:
        return "transcript_only_no_recording"
    if has_r:
        return "recording_only_no_transcript"
    return "other_material_only"


def build_inventory(binding: CourseBinding) -> dict[str, Any]:
    root = binding.root
    result: dict[str, Any] = {"course_id": binding.course_id, "term": binding.term, "display_name": binding.display_name, "binding": binding.status,
                              "lectures": [], "sessions": [], "unlinked_sessions": [], "other_sources": [], "enumeration_truncated": False,
                              "skipped_outside_course": []}
    if not binding.usable:
        result["index"] = {"status": "unavailable", "reason": binding.problem}
        return result
    try:
        index = read_source_index(root, binding.course_id)
        entries = index["entries"]
        result["index"] = {"status": "ok", "revision": index["revision"], "sha256": index["index_sha256"], "as_of": index["as_of"], "local_scope_status": index["local_scope_status"]}
    except OwnerReadError as exc:
        entries = {}
        result["index"] = {"status": "unavailable", "reason": exc.message, "code": exc.code}

    by_path = {e["path"]: e for e in entries.values() if e["path"]}
    used_ids: set[str] = set()
    count = 0

    def item_for(rel: str, guessed_kind: str) -> dict:
        nonlocal count
        count += 1
        entry = by_path.get(rel)
        if entry is not None:
            used_ids.add(entry["source_id"])
            return _registered_item(root, entry)
        return _disk_item(root, rel, guessed_kind)

    def files_in(directory: Path) -> list[Path]:
        try:
            return sorted(p for p in directory.iterdir() if p.is_file() and not p.is_symlink())
        except OSError:
            return []

    root_resolved = root.resolve()
    scope: dict[Path, bool] = {}

    def in_course(directory: Path) -> bool:
        """A folder reached through a symlink or junction that leads out of the course is listed as skipped and never entered."""
        known = scope.get(directory)
        if known is None:
            try:
                known = not directory.is_symlink() and directory.resolve().is_relative_to(root_resolved)
            except OSError:
                known = False
            scope[directory] = known
            rel = directory.relative_to(root).as_posix()
            if not known and not any(rel == s or rel.startswith(s + "/") for s in result["skipped_outside_course"]):
                result["skipped_outside_course"].append(rel)
        return known

    materials = root / "materials"
    # --- sessions ------------------------------------------------------------------------------
    sessions: dict[str, dict] = {}
    session_of_source: dict[str, str] = {}
    sessions_dir = materials / "sessions"
    if sessions_dir.is_dir() and in_course(sessions_dir):
        for directory in sorted(p for p in sessions_dir.iterdir() if p.is_dir()):
            match = _SESSION_DIR.match(directory.name)
            if not match or not in_course(directory):
                continue
            items = []
            for path in files_in(directory):
                ext = path.suffix.lower()
                kind = "lecture_transcript" if ext in {".txt", ".vtt", ".srt"} else "lecture_recording" if ext in _AUDIO_VIDEO else "session_material"
                item = item_for(path.relative_to(root).as_posix(), kind)
                if item["registration"] == "unregistered":
                    item["kind"] = kind
                items.append(item)
                session_of_source[item["source_id"]] = match.group(1)
            sessions[match.group(1)] = {"session_id": match.group(1), "date": match.group(1), "dir": directory.relative_to(root).as_posix(), "state": _session_state(items),
                                        "items": items, "linked_lecture_ids": []}

    # --- lecture units -------------------------------------------------------------------------
    lectures_dir = materials / "lectures"
    if lectures_dir.is_dir() and in_course(lectures_dir):
        for directory in sorted((p for p in lectures_dir.iterdir() if p.is_dir() and _LECTURE_DIR.match(p.name)), key=lambda p: p.name.lower()):
            if not in_course(directory):
                continue
            decks, extras = [], []
            for path in files_in(directory):
                item = item_for(path.relative_to(root).as_posix(), "lecture_slides" if path.suffix.lower() in _DECK else "lecture_material")
                (decks if path.suffix.lower() in _DECK else extras).append(item)
            linked: list[str] = []
            for deck in decks:
                entry = entries.get(deck["source_id"])
                related = set(entry["related_source_ids"]) if entry else set()
                related |= {e["source_id"] for e in entries.values() if deck["source_id"] in e["related_source_ids"]}
                for source_id in related:
                    session_id = session_of_source.get(source_id)
                    if session_id and session_id not in linked:
                        linked.append(session_id)
            lecture_id = directory.name.lower()
            for session_id in linked:
                sessions[session_id]["linked_lecture_ids"].append(lecture_id)
            shown = primary_deck({"decks": decks})
            title = Path(shown["filename"]).stem if shown else directory.name
            result["lectures"].append({"lecture_id": lecture_id, "unit_dir": directory.relative_to(root).as_posix(), "title": title, "decks": decks, "extra_materials": extras,
                                       "sessions": [sessions[s] for s in sorted(linked)], "session_link": "owner_related_sources" if linked else "none_recorded"})

    result["sessions"] = [sessions[k] for k in sorted(sessions)]
    result["unlinked_sessions"] = [s for s in result["sessions"] if not s["linked_lecture_ids"]]

    # --- everything else under materials/ ------------------------------------------------------
    if materials.is_dir():
        for top in sorted(p for p in materials.iterdir() if p.is_dir() and p.name not in {"lectures", "sessions"}):
            if not in_course(top):
                continue
            for path in sorted(top.rglob("*")):
                if count >= MAX_ENUMERATED_FILES:
                    result["enumeration_truncated"] = True
                    break
                if path.is_file() and not path.is_symlink() and in_course(path.parent):
                    rel = path.relative_to(root).as_posix()
                    kind = _FOLDER_KIND.get(top.name, "material")
                    if kind == "assignment_brief" and _SOLUTION.search(path.name):
                        kind = "assignment_solution"
                    result["other_sources"].append(item_for(rel, kind))
    # --- registered entries that are not files under the enumerated folders (placeholders etc.) --
    for entry in entries.values():
        if entry["source_id"] not in used_ids:
            result["other_sources"].append(_registered_item(root, entry))
    return result


def _walk_items(inventory: dict):
    for lecture in inventory["lectures"]:
        yield from lecture["decks"]
        yield from lecture["extra_materials"]
    for session in inventory["sessions"]:
        yield from session["items"]
    yield from inventory["other_sources"]


def coverage_summary(settings: Settings) -> dict[str, Any]:
    """All-course preparation denominator. Never filtered by readiness and never mixed with learning evidence."""
    courses: dict[str, Any] = {}
    totals = {"lecture_units": 0, "sessions": 0, "sources": 0}
    for course_id, binding in sorted(settings.courses.items()):
        inventory = build_inventory(binding)
        by_state: dict[str, int] = {}
        for item in _walk_items(inventory):
            by_state[item["state"]] = by_state.get(item["state"], 0) + 1
        session_states: dict[str, int] = {}
        for session in inventory["sessions"]:
            session_states[session["state"]] = session_states.get(session["state"], 0) + 1
        courses[course_id] = {"binding": binding.status, "index": inventory["index"]["status"], "lecture_units": len(inventory["lectures"]), "sessions": len(inventory["sessions"]),
                              "sources": sum(by_state.values()), "by_state": by_state, "session_states": session_states,
                              "lectures_without_linked_session": sum(1 for l in inventory["lectures"] if not l["sessions"]),
                              "decks_needing_rendition": sum(1 for l in inventory["lectures"] for d in l["decks"] if d["rendition"] == "needs_rendition"),
                              "enumeration_truncated": inventory["enumeration_truncated"], "skipped_outside_course": len(inventory["skipped_outside_course"])}
        totals["lecture_units"] += len(inventory["lectures"])
        totals["sessions"] += len(inventory["sessions"])
        totals["sources"] += sum(by_state.values())
    return {"term": "2026-fall", "courses": courses, "totals": totals,
            "note": "Preparation/source coverage only. It says nothing about what was viewed, assessed or learned."}
