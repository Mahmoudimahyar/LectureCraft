"""Durable, owned source annotations (LL013): reviewed links between sources.

A typed, accepted time interval is a new source fact, so it is persisted — one immutable JSON file
per revision — beside the existing source maps under the source-link owner
(``work/lecture-review/source-links/<annotation-id>.r<N>.json``). The rendered alignment export is
derived from these files and can always be rebuilt; it is never the only copy of a confirmed link.

Rules kept here:
* a revision names its predecessor by id and bytes; a second, different revision N is a visible
  conflict that needs reconciliation (never last-write-wins);
* pipeline suggestions never replace or shadow a human-confirmed or rejected link;
* an inferred chapter-level relation stays chapter-level (a ``text`` locator), never an exact page;
* undo is a new revision restoring intent — history is not erased.
"""
from __future__ import annotations

from pathlib import Path
import re
import struct
import wave
from typing import Any

from . import contracts as c
from .config import Settings
from .fsutil import ExclusiveConflict, publish_exclusive, replace_atomic

_NAME = re.compile(r"^(?P<id>[A-Za-z0-9][A-Za-z0-9._-]{0,100})\.r(?P<rev>\d+)\.json$")
AREA_REL = "work/lecture-review/source-links"


class AnnotationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def link_key(record: dict) -> tuple:
    """Identity of *what is linked* (independent of the annotation id): used to dedupe suggestions."""
    frm, to = record["from"], record["to"]

    def anchor(src: dict) -> tuple:
        loc = src["locator"]
        return (src["source_id"], loc["kind"], loc.get("page"), loc.get("start"), loc.get("end"))

    return (record["relation"], anchor(frm), to["source_id"], to["locator"]["kind"])


def precision_of(record: dict) -> str:
    kind = record["to"]["locator"]["kind"]
    return {"text": "broad_reference", "media": "time_interval", "page": "exact_page", "lines": "line_range", "figure": "figure_region"}[kind]


_MP4_SUFFIXES = {".m4a", ".mp4", ".m4v", ".mov"}


def _mp4_duration_ms(path: Path) -> int | None:
    """Movie-header duration of an ISO-BMFF file (m4a/mp4): walk the top-level boxes to ``moov``, then to
    ``mvhd``. Only box headers and the small ``moov`` box are read — never the media data."""
    try:
        size = path.stat().st_size
        with open(path, "rb") as handle:
            offset = 0
            while offset + 8 <= size:
                handle.seek(offset)
                length, kind = struct.unpack(">I4s", handle.read(8))
                header = 8
                if length == 1:  # 64-bit box size
                    length = struct.unpack(">Q", handle.read(8))[0]
                    header = 16
                elif length == 0:  # box runs to the end of the file
                    length = size - offset
                if length < header or offset + length > size:
                    return None
                if kind == b"moov":
                    if length > 64 * 1024 * 1024:
                        return None
                    moov = handle.read(length - header)
                    cursor = 0
                    while cursor + 8 <= len(moov):
                        inner, inner_kind = struct.unpack(">I4s", moov[cursor:cursor + 8])
                        if inner < 8 or cursor + inner > len(moov):
                            return None
                        if inner_kind == b"mvhd":
                            body = moov[cursor + 8:cursor + inner]
                            if body[:1] == bytes([1]):  # version 1 uses 64-bit times
                                timescale, duration = struct.unpack(">IQ", body[20:32])
                            else:
                                timescale, duration = struct.unpack(">II", body[12:20])
                            return int(duration * 1000 / timescale) if timescale > 0 else None
                        cursor += inner
                    return None
                offset += length
    except (OSError, struct.error):
        return None
    return None


def media_duration_ms(path: Path) -> int | None:
    """Duration when it can be read from the file itself without extra tools (WAV, m4a/mp4); otherwise unknown."""
    if not path.is_file():
        return None
    suffix = path.suffix.lower()
    if suffix in _MP4_SUFFIXES:
        return _mp4_duration_ms(path)
    if suffix != ".wav":
        return None
    try:
        with wave.open(str(path), "rb") as handle:
            return int(handle.getnframes() * 1000 / handle.getframerate())
    except (wave.Error, OSError, EOFError):
        return None


class AnnotationStore:
    def __init__(self, settings: Settings):
        self._settings = settings

    def area(self, course_id: str) -> Path:
        return self._settings.source_links_area(course_id)

    def _areas(self, course_id: str) -> list[Path]:
        """Owner-side reviewed links plus the app's (possibly staged) area."""
        areas = [self._settings.course(course_id).root / AREA_REL]
        if self.area(course_id) not in areas:
            areas.append(self.area(course_id))
        return areas

    def _rel(self, annotation_id: str, revision: int) -> str:
        return f"{AREA_REL}/{annotation_id}.r{revision}.json"

    # ---- read -------------------------------------------------------------------------------
    def load(self, course_id: str) -> dict[str, Any]:
        chains: dict[str, dict[int, dict]] = {}
        problems: list[dict] = []
        for area in self._areas(course_id):
            if not area.is_dir():
                continue
            for path in sorted(area.iterdir()):
                match = _NAME.match(path.name)
                if not match or not path.is_file():
                    continue
                data = path.read_bytes()
                try:
                    record = c.parse_json(data)
                    errors = c.validate("annotation", record)
                except c.ContractError as exc:
                    errors = [str(exc)]
                    record = None
                if errors or record["annotation_id"] != match["id"] or record["revision"] != int(match["rev"]) or record["scope"]["course_id"] != course_id:
                    problems.append({"code": "invalid_annotation_file", "file": path.name})
                    continue
                entry = {"record": record, "artifact": c.artifact_for_bytes(data, self._rel(match["id"], int(match["rev"])), "application/json")}
                chains.setdefault(match["id"], {})[int(match["rev"])] = entry
        current: dict[str, dict] = {}
        history: dict[str, list[dict]] = {}
        for annotation_id, revisions in chains.items():
            ordered = [revisions[n] for n in sorted(revisions)]
            broken = False
            for previous, entry in zip([None, *ordered], ordered):
                supersedes = entry["record"]["supersedes"]
                expected = None if previous is None else {"record_id": annotation_id, "artifact": previous["artifact"]}
                if supersedes != expected or (previous is None and entry["record"]["revision"] != 1):
                    problems.append({"code": "broken_revision_chain", "annotation_id": annotation_id, "revision": entry["record"]["revision"]})
                    broken = True
                    break
            history[annotation_id] = ordered
            if not broken:
                current[annotation_id] = ordered[-1]
        conflicts = []
        conflict_dir = self.area(course_id) / "conflicts"
        if conflict_dir.is_dir():
            for path in sorted(conflict_dir.glob("*.json")):
                try:
                    record = c.parse_json(path.read_bytes())
                except c.ContractError:
                    continue
                head = current.get(record["annotation_id"])
                if head is None or head["record"]["revision"] <= record["revision"]:  # unresolved until a later revision exists
                    conflicts.append({"conflict_id": path.stem, "annotation_id": record["annotation_id"], "proposed": record,
                                      "current": head["record"] if head else None})
        return {"current": current, "history": history, "conflicts": conflicts, "problems": problems}

    def current_records(self, course_id: str) -> list[dict]:
        return [entry["record"] for entry in self.load(course_id)["current"].values()]

    # ---- write ------------------------------------------------------------------------------
    def _check_bounds(self, course_id: str, record: dict) -> None:
        to = record["to"]
        if to["locator"]["kind"] != "media":
            return
        from .ownerio.inventory import build_inventory

        inventory = build_inventory(self._settings.course(course_id))
        for session in inventory["sessions"]:
            for item in session["items"]:
                if item["source_id"] == to["source_id"] and item["path"]:
                    duration = media_duration_ms(self._settings.course(course_id).root / item["path"])
                    if duration is not None and to["locator"]["end_ms"] > duration + 500:
                        raise AnnotationError("outside_recording", f"interval ends at {to['locator']['end_ms']} ms but the recording is {duration} ms long")
                    return

    def _check_identity(self, course_id: str, record: dict) -> None:
        """A link is between exact versions. An end that names bytes other than the current file is refused."""
        from .ownerio.inventory import build_inventory
        from .preparation import current_identity

        root = self._settings.course(course_id).root
        inventory = build_inventory(self._settings.course(course_id))
        items = {i["source_id"]: i for i in inventory["other_sources"]}
        items.update({i["source_id"]: i for s in inventory["sessions"] for i in s["items"]})
        items.update({i["source_id"]: i for l in inventory["lectures"] for i in [*l["decks"], *l["extra_materials"]]})
        for end in ("from", "to"):
            item = items.get(record[end]["source_id"])
            if item is None or not item.get("path"):
                continue
            _, current = current_identity(root, item)
            if current is not None and current != record[end]["sha256"]:
                raise AnnotationError("stale_source", f"the link's {end!r} side names a version of {item['filename']} that is not the current file")

    def propose(self, course_id: str, record_bytes: bytes) -> dict[str, Any]:
        """Persist a new annotation or the next revision. Returns ``{status, artifact|conflict_id, reason}``."""
        try:
            record = c.parse_json(record_bytes)
        except c.ContractError as exc:
            raise AnnotationError("invalid_annotation", str(exc)) from exc
        errors = c.validate("annotation", record)
        if errors:
            raise AnnotationError("invalid_annotation", "; ".join(errors[:3]))
        if record["scope"]["course_id"] != course_id:
            raise AnnotationError("identity_mismatch", "annotation belongs to another course")
        if not _NAME.match(f"{record['annotation_id']}.r1.json"):
            raise AnnotationError("invalid_annotation", "annotation id is not a portable file name")
        self._check_bounds(course_id, record)
        self._check_identity(course_id, record)
        state = self.load(course_id)
        head = state["current"].get(record["annotation_id"])
        revision = record["revision"]
        if head is None:
            if revision != 1 or record["annotation_id"] in state["history"]:
                raise AnnotationError("stale_base", "revision does not follow an existing verified chain")
        else:
            expected = {"record_id": record["annotation_id"], "artifact": head["artifact"]}
            if revision <= head["record"]["revision"] or record["supersedes"] != expected:
                existing = next((e for e in state["history"][record["annotation_id"]] if e["record"]["revision"] == revision), None)
                if existing is not None and existing["artifact"]["sha256"] == c.sha256_hex(record_bytes):
                    return {"status": "already_saved", "artifact": existing["artifact"], "reason": None}
                conflict_id = f"{record['annotation_id']}.r{revision}.{c.sha256_hex(record_bytes)[:12]}"
                publish_exclusive(self.area(course_id) / "conflicts" / f"{conflict_id}.json", record_bytes)
                return {"status": "conflict", "conflict_id": conflict_id,
                        "reason": "Another revision was accepted first. Both versions are kept; compare and choose — nothing was overwritten."}
            if revision != head["record"]["revision"] + 1:
                raise AnnotationError("stale_base", "revision number must follow the current revision")
        path = self.area(course_id) / f"{record['annotation_id']}.r{revision}.json"
        try:
            result = publish_exclusive(path, record_bytes)
        except ExclusiveConflict:
            conflict_id = f"{record['annotation_id']}.r{revision}.{c.sha256_hex(record_bytes)[:12]}"
            publish_exclusive(self.area(course_id) / "conflicts" / f"{conflict_id}.json", record_bytes)
            return {"status": "conflict", "conflict_id": conflict_id, "reason": "Another revision was accepted first. Both versions are kept; compare and choose."}
        artifact = c.artifact_for_bytes(record_bytes, self._rel(record["annotation_id"], revision), "application/json")
        return {"status": "saved" if result == "created" else "already_saved", "artifact": artifact, "reason": None}

    def suggest(self, course_id: str, record: dict) -> dict[str, Any]:
        """Pipeline suggestion. Skipped when a human already confirmed or rejected the same link."""
        if record["review_state"] != "suggested" or record["reviewer_ref"] is not None:
            raise AnnotationError("invalid_annotation", "a pipeline may only write unreviewed suggestions")
        key = link_key(record)
        for existing in self.current_records(course_id):
            if link_key(existing) == key and (existing["review_state"] in {"confirmed", "rejected"} or existing["annotation_id"] != record["annotation_id"]):
                return {"status": "kept_existing", "annotation_id": existing["annotation_id"], "reason": f"existing {existing['review_state']} link is preserved"}
        if record["annotation_id"] in self.load(course_id)["history"]:
            return {"status": "kept_existing", "annotation_id": record["annotation_id"], "reason": "annotation already has a revision chain"}
        return self.propose(course_id, c.dump_json(record))

    # ---- derived export ---------------------------------------------------------------------
    def export_alignment(self, course_id: str) -> dict:
        """Rebuildable view of the current links. Deleting it loses nothing."""
        state = self.load(course_id)
        links = []
        for entry in sorted(state["current"].values(), key=lambda e: e["record"]["annotation_id"]):
            record = entry["record"]
            links.append({"annotation_id": record["annotation_id"], "revision": record["revision"], "relation": record["relation"], "review_state": record["review_state"],
                          "basis": record["basis"], "precision": precision_of(record), "from": record["from"], "to": record["to"], "artifact": entry["artifact"]})
        view = {"course_id": course_id, "generated_from": "source-link sidecar revisions", "links": links, "unresolved_conflicts": len(state["conflicts"]), "problems": state["problems"]}
        replace_atomic(self._settings.exports_area(course_id) / "alignment.json", c.dump_json(view))
        return view
