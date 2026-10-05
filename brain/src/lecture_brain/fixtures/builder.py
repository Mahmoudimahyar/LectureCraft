"""Build the labeled synthetic fixture workspace (planner + five course roots).

The layout mirrors what the read-only owner inventory found in the real workspaces: a
``planner-config.yaml`` mapping course ids to roots, per-course ``.agent/source-index.json`` pinned
by a publication marker, ``learning/`` catalogs and attempts, ``materials/lectures`` and
``materials/sessions`` folders with registered, unregistered, empty and unavailable sources.
All content is synthetic. Nothing here is ever written into a real course folder.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import math
import shutil
import struct
import wave

import yaml
from fpdf import FPDF

from ..contracts import dump_json, sha256_hex
from ..ownerio.attempts import learning_input_digest
from ..ownerio.inventory import disk_version_id, unregistered_source_id
from ..tutoring import policy as tp
from . import content as c

FIXTURE_VERSION = "11"
MARKER = ".ll-synthetic-fixture"
TERM = "2026-fall"
FIXED_TIME = "2026-09-12T12:00:00Z"
_PDF_DATE = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)
_COLORS = {"teal": (15, 110, 91), "orange": (181, 128, 58), "slate": (95, 127, 147), "red": (192, 57, 43), "ink": (19, 34, 56)}


# ---- synthetic teaching policy --------------------------------------------------------------------
# Invented sentences only. Each row: (clause id suffix, sentence, category, exclusion reason or None, restriction, actions).
# The personal rows exist so that leaving them out can be tested; "Robin Sample" is not a person.
_POLICY_COMMON = [
    ("pacing-01", "Fixture policy: keep each reply to the depth the learner picked and stop once the question is answered.", "mode_pacing", None, False, "all"),
    ("help-01", "Fixture policy: when the learner asks for help, give the help first and do not turn the request into a quiz.", "direct_help", None, False, "all"),
    ("diagnostic-01", "Fixture policy: a diagnostic question is an offer the learner may skip, and only one is offered at a time.", "optional_diagnostics", None, False, "all"),
    ("error-01", "Fixture policy: when an earlier tutor statement was wrong or a transcript line looks misheard, say so and give the corrected version.", "assistant_error_and_asr_uncertainty", None, False, "all"),
    ("alternatives-01", "Fixture policy: accept a correct answer that uses a different method or different wording from the model answer.", "alternatives", None, False, ["assessment"]),
    ("personal-01", "Fixture learner Robin Sample studies in the weekday evening blocks of the fixture planner.", "planner_personal", "names the fixture learner and a planner schedule", False, "all"),
    ("assistance-01", "Fixture policy: note what help was given before an answer, because helped work is not unaided evidence.", "assistance", None, False, "all"),
    ("history-01", "Robin Sample missed the fixture promoter question twice last week.", "learner_history", "describes the fixture learner's own attempt history", False, "all"),
    ("source-01", "Fixture policy: say which statements come from the supplied course source and which are your own added clarification.", "source_vs_added_clarification", None, False, "all"),
    ("save-01", "Fixture policy: only the course's own writer saves an attempt, and the tutor never saves anything itself.", "owner_save", None, False, "all"),
    ("unrelated-01", "The fixture planner renews its parking permit in spring.", "unrelated", "not about tutoring", False, "all"),
]
_POLICY_COURSE = {
    "be505": [
        ("modes-01", "Modes learn/assess/produce/maintain keep their meaning.", "mode_pacing", None, False, "all"),
        ("assistance-01", "Assistance is recorded per skill.", "assistance", None, False, "all"),
        ("restriction-01", "Fixture course rule: do not write out a full solution to a graded fixture problem set for the learner.", "assistance", None, True, "all"),
        ("history-01", "Robin Sample has two open fixture attempts on the origin question.", "learner_history", "describes the fixture learner's own attempt history", False, "all"),
    ],
    "be562": [("restriction-01", "Fixture course rule: remind the learner that help on a fixture problem set has to be disclosed.", "assistance", None, True, "all")],
}


def _strategy_text(course_id: str) -> str:
    rows = _POLICY_COURSE.get(course_id, [])
    return "# Fixture learning strategy\n" + ("\n" + " ".join(row[1] for row in rows) + "\n" if rows else "")


def _policy_text() -> str:
    half = len(_POLICY_COMMON) // 2
    return (f"# Fixture tutoring policy\n\n> {c.FIXTURE_NOTE}\n\n## Session behaviour\n\n" + " ".join(row[1] for row in _POLICY_COMMON[:half])
            + "\n\n## Evidence and saving\n\n" + "\n".join(row[1] for row in _POLICY_COMMON[half:]) + "\n")


def _write_policy_projection(planner: Path, roots: dict[str, Path]) -> None:
    """The synthetic projection over the synthetic policy files: spans and hashes are taken from the bytes just written."""
    files = [("planner/protocols/tutoring-policy.md", "common", "protocols/tutoring-policy.md", planner, "common", _POLICY_COMMON)]
    files += [(f"{cid}/learning-strategy.md", f"course:{cid}", "learning-strategy.md", roots[cid], cid, _POLICY_COURSE.get(cid, [])) for cid in roots]
    sources, clauses = [], []
    for label, scope, rel, base, prefix, rows in files:
        data = (base / rel).read_bytes()
        text = data.decode("utf-8")
        sources.append(tp.source_entry(label, scope, rel, data))
        for suffix, sentence, category, reason, restriction, actions in rows:
            start = text.index(sentence)
            clauses.append(tp.clause_entry(f"{prefix}.{suffix}", label, text, start, start + len(sentence), category=category, include=reason is None, exclusion_reason=reason,
                                           restriction=restriction, actions=actions))
    _write(planner / tp.SYNTHETIC_PROJECTION_REL, _json({"contract": tp.CONTRACT, "projection_version": 1, "review_state": "drafted_unreviewed", "sources": sources, "clauses": clauses,
                                                         "required_categories": list(tp.REQUIRED_CATEGORIES), "note": c.FIXTURE_NOTE}))


# ---- media builders ------------------------------------------------------------------------------
def _figure(pdf: FPDF, kind: str) -> None:
    """Draw a small coloured figure. Colours are deliberately saturated: the UI must not alter them."""
    x, y = 150.0, 60.0
    pdf.set_line_width(2.5)
    if kind == "ring":
        for i, name in enumerate(("teal", "orange", "slate", "red")):
            pdf.set_draw_color(*_COLORS[name])
            pdf.arc(x, y, 60, start_angle=i * 90 + 6, end_angle=(i + 1) * 90 - 6)
    else:
        color = {"ori": "teal", "promoter": "orange", "marker": "slate"}[kind]
        pdf.set_fill_color(*_COLORS[color])
        pdf.rect(x, y + 10, 60, 30, style="F")
        pdf.set_fill_color(*_COLORS["red"])
        pdf.rect(x + 20, y + 45, 20, 8, style="F")
    pdf.set_line_width(0.2)
    pdf.set_draw_color(0, 0, 0)


def write_pdf(path: Path, pages: list[dict]) -> None:
    pdf = FPDF(orientation="landscape", unit="mm", format=(190.5, 254.0))  # 4:3 slide
    pdf.set_creation_date(_PDF_DATE)
    pdf.set_title(path.stem)
    pdf.set_author("Lecture Learning synthetic fixture")
    pdf.set_auto_page_break(False)
    for number, page in enumerate(pages, start=1):
        pdf.add_page()
        pdf.set_fill_color(255, 255, 255)
        pdf.rect(0, 0, 254, 190.5, style="F")
        pdf.set_text_color(*_COLORS["ink"])
        pdf.set_font("helvetica", "B", 26)
        pdf.set_xy(16, 18)
        pdf.cell(0, 12, page["title"])
        pdf.set_font("helvetica", "", 15)
        y = 52
        for bullet in page.get("bullets", []):
            pdf.set_xy(20, y)
            pdf.multi_cell(120, 8, "- " + bullet)
            y = pdf.get_y() + 5
        if page.get("figure"):
            _figure(pdf, page["figure"])
        pdf.set_font("helvetica", "I", 9)
        pdf.set_text_color(110, 110, 110)
        pdf.set_xy(16, 176)
        pdf.cell(0, 6, f"{c.FIXTURE_NOTE} - {page.get('printed') or number}")
    path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(path))


def write_docx(path: Path, paragraphs: list[str]) -> None:
    """A minimal word-processing file (a zip with one document part). Synthetic text only; it is never opened by an Office program here."""
    import zipfile
    from xml.sax.saxutils import escape

    body = "".join(f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>" for text in paragraphs)
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>')
    types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
             '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" '
             'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in (("[Content_Types].xml", types), ("word/document.xml", document)):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))  # fixed timestamp: the same bytes on every build
            archive.writestr(info, data)


def write_wav(path: Path, segments: list[tuple[float, float]], rate: int = 8000) -> int:
    """Write a mono 8-bit PCM tone track; each segment gets its own pitch. Returns duration in ms."""
    total = max(end for _, end in segments)
    frames = bytearray()
    for index in range(int(total * rate)):
        t = index / rate
        value = 128
        for seg_index, (start, end) in enumerate(segments):
            if start <= t < end:
                freq = 220.0 + 55.0 * seg_index
                envelope = min(1.0, (t - start) * 20, (end - t) * 20)
                value = 128 + int(40 * envelope * math.sin(2 * math.pi * freq * t))
                break
        frames.append(max(0, min(255, value)))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(1)
        out.setframerate(rate)
        out.writeframes(bytes(frames))
    return int(total * 1000)


def _vtt(lecture: dict) -> str:
    """A cue file with one cue per transcript line (synthetic timing spread evenly over each slide's interval)."""
    def stamp(ms: int) -> str:
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"

    out = ["WEBVTT", ""]
    for slide in lecture["slides"]:
        start, end = slide["seconds"][0] * 1000, slide["seconds"][1] * 1000
        step = (end - start) // len(slide["lines"])
        for i, line in enumerate(slide["lines"]):
            out += [f"{stamp(start + i * step)} --> {stamp(start + (i + 1) * step)}", line, ""]
    return "\n".join(out)


def _write(path: Path, data: bytes | str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        data = data.encode("utf-8")
    path.write_bytes(data)


def _yaml(value) -> str:
    return yaml.safe_dump(value, sort_keys=False, allow_unicode=True, width=130)


def _json(value) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


# ---- owner-shaped records ------------------------------------------------------------------------
def _version(path: Path | None, review: str = "partial", availability: str | None = None) -> dict:
    if path is None:
        return {"version_id": "missing-1", "sha256": None, "observed_at": None, "availability": "unavailable", "planning_review": "pending", "reviewed_ranges": [], "notes": ["Fixture placeholder: not yet supplied."]}
    data = path.read_bytes()
    if not data:
        digest = hashlib.sha256(b"").hexdigest()
        return {"version_id": f"v1-{digest[:12]}", "sha256": digest, "observed_at": FIXED_TIME, "availability": "empty", "planning_review": "pending", "reviewed_ranges": [], "notes": ["Fixture zero-byte file."]}
    digest = hashlib.sha256(data).hexdigest()
    return {"version_id": f"v1-{digest[:12]}", "sha256": digest, "observed_at": FIXED_TIME, "availability": availability or "readable",
            "planning_review": review, "reviewed_ranges": ["fixture pages 1-2"] if review in {"partial", "complete"} else [], "notes": ["Synthetic fixture source."]}


def _entry(root: Path, source_id: str, kind: str, rel: str | None, *, role: str = "primary", date: str | None = None, related: list[str] | None = None,
           origin: str | None = None, review: str = "partial") -> dict:
    path = (root / rel) if rel else None
    version = _version(path, review)
    return {
        "source_id": source_id, "role": role, "kind": kind, "current_path": rel, "original_filename": Path(rel).name if rel else None, "path_aliases": [],
        "origin_id": origin, "source_date": date, "date_basis": "fixture-declared date", "related_source_ids": related or [],
        "current_version_id": version["version_id"], "versions": [version],
    }


def _write_index(root: Path, course_id: str, sources: list[dict], revision: int = 3) -> None:
    index = {
        "contract_version": "course-tracking-v1", "course_id": course_id, "term": TERM, "revision": revision, "record_state": "live",
        "coverage": {"checked_at": "2026-09-12T12:00:00.0000000Z", "local_scope_status": "partial", "included_paths": [s["current_path"] for s in sources if s["current_path"]],
                     "excluded_paths": ["materials/textbook (fixture: large references are not bulk indexed)"], "blocked_sources": [], "live_platforms_checked": [], "notes": [c.FIXTURE_NOTE]},
        "sources": sources,
    }
    index_bytes = _json(index).encode("utf-8")
    _write(root / ".agent/source-index.json", index_bytes)
    requirements = _yaml({"contract_version": "course-tracking-v1", "course_id": course_id, "term": TERM, "revision": 1, "record_state": "live", "items": [], "issues": []})
    grades = _yaml({"contract_version": "course-tracking-v1", "course_id": course_id, "term": TERM, "revision": 1, "record_state": "live", "components": [], "issues": []})
    state = f"# {course_id.upper()} course state\n\n> {c.FIXTURE_NOTE}\n"
    _write(root / "planning/requirements.yaml", requirements)
    _write(root / "planning/grades.yaml", grades)
    _write(root / "course-state.md", state)
    marker = {"contract_version": "course-tracking-publication-v1", "course_id": course_id, "term": TERM, "as_of": "2026-09-12",
              "files": {"planning/requirements.yaml": sha256_hex(requirements.encode()), "planning/grades.yaml": sha256_hex(grades.encode()),
                        ".agent/source-index.json": sha256_hex(index_bytes), "course-state.md": sha256_hex(state.encode())}}
    _write(root / ".agent/course-tracking/publication.json", _json(marker))


def write_learning_state(root: Path, course_id: str) -> None:
    attempts = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((root / "learning/attempts").glob("*/*.json"))]
    real = sum(1 for a in attempts if a["record_kind"] == "attempt")
    corrections = sum(1 for a in attempts if a["record_kind"] == "assessment_revision")
    text = (f"# {course_id.upper()} learning state\n\n> {c.FIXTURE_NOTE}. Generated view; original attempts remain the evidence.\n\n"
            f"Input digest: `{learning_input_digest(root)}`\n\nReal attempt records: {real}. Assessment corrections: {corrections} (not new attempts).\n")
    _write(root / "learning-state.md", text)


def _skills_doc(course_id: str, topics: list[dict], skills: list[dict]) -> dict:
    return {"contract_version": "course-learning-v1", "course_id": course_id, "term": TERM, "record_state": "live", "revision": 1, "topics": topics, "skills": skills, "issues": []}


def _families_doc(course_id: str, families: list[dict]) -> dict:
    return {"contract_version": "course-learning-v1", "course_id": course_id, "term": TERM, "record_state": "live", "revision": 1, "families": families, "issues": []}


def _observation(skill_id: str, outcome: str, *, assistance: str = "none", reference: str = "none", analysis: str = "Synthetic fixture analysis.",
                 missing: list[str] | None = None, errors: list[str] | None = None, confidence: str = "high") -> dict:
    return {"skill_id": skill_id, "outcome": outcome, "assistance": assistance, "reference_access": reference, "analysis": analysis,
            "missing_or_incorrect": missing or [], "error_types": errors or [], "assessment_confidence": confidence}


def _attempt(course_id: str, attempt_id: str, recorded_at: str, family: tuple[str, int], prompt: str, excerpt: str, observations: list[dict], *,
             mode: str = "assess", occurred_at: str | None = "same", time_basis: str = "recorded_now", question_id: str | None = None,
             prior_exposure: str = "unseen", review: dict | None = None) -> dict:
    record = {
        "contract_version": "course-learning-v1", "course_id": course_id, "term": TERM, "record_kind": "attempt", "attempt_id": attempt_id,
        "session_id": f"{course_id}-fixture-session-01", "recorded_at": recorded_at, "occurred_at": recorded_at if occurred_at == "same" else occurred_at,
        "time_basis": time_basis, "mode": mode, "evidence_kind": "observed_response", "assessor": "agent", "user_confidence": None,
        "question": {"family_id": family[0], "family_revision": family[1], "prompt": prompt, "prior_exposure": prior_exposure},
        "response_evidence": {"locator": "Synthetic fixture session transcript (no real conversation exists)", "excerpt": excerpt},
        "observations": observations,
    }
    if question_id:
        record["question"]["question_id"] = question_id
        record["question"]["question_version"] = 1
    if review:
        record["review_suggestion"] = review
    return record


def _save_record(root: Path, record: dict) -> Path:
    record_id = record["attempt_id"] if record["record_kind"] == "attempt" else record["event_id"]
    month = datetime.fromisoformat(record["recorded_at"].replace("Z", "+00:00")).strftime("%Y-%m")
    path = root / "learning/attempts" / month / f"{record_id}.json"
    _write(path, _json(record))
    return path


# ---- be505 ---------------------------------------------------------------------------------------
def _source_ref(root: Path, index: dict[str, dict], source_id: str, locator: dict) -> dict:
    entry = index[source_id]
    version = next(v for v in entry["versions"] if v["version_id"] == entry["current_version_id"])
    return {"source_id": source_id, "version_id": version["version_id"], "sha256": version["sha256"], "locator": locator}


def _disk_ref(root: Path, rel: str, locator: dict) -> dict:
    digest = hashlib.sha256((root / rel).read_bytes()).hexdigest()
    return {"source_id": unregistered_source_id(rel), "version_id": disk_version_id(digest), "sha256": digest, "locator": locator}


def _artifact(root: Path, rel: str, media_type: str) -> dict:
    data = (root / rel).read_bytes()
    return {"path": rel, "sha256": sha256_hex(data), "bytes": len(data), "media_type": media_type}


def _annotation(root: Path, annotation_id: str, relation: str, frm: dict, to: dict, *, state: str, basis: str, support: dict, reviewer: str | None) -> None:
    record = {"contract": "ll.annotation/1", "annotation_id": annotation_id, "scope": {"course_id": "be505", "term": TERM}, "revision": 1, "supersedes": None,
              "relation": relation, "from": frm, "to": to, "review_state": state, "basis": basis, "support": [support], "reviewer_ref": reviewer, "created_at": FIXED_TIME}
    _write(root / "work/lecture-review/source-links" / f"{annotation_id}.r1.json", dump_json(record))


def _build_be505(root: Path) -> None:
    cid = "be505"
    _write(root / "course.yaml", _yaml({"schema_version": 1, "course_id": cid, "term": TERM, "display_name": "FIXTURE BE 505 - Molecular Systems (synthetic)",
                                        "workspace_root": ".", "bindings": {"planner": None, "shared_learning": None}}))
    _write(root / "AGENTS.md", f"# Fixture course instructions\n\n{c.COURSE_INSTRUCTIONS[cid]}\n")
    _write(root / "learning-strategy.md", _strategy_text(cid))

    sources: list[dict] = []
    for number, lecture in enumerate(c.BE505_LECTURES, start=1):
        deck_rel = f"materials/lectures/{lecture['unit']}/{lecture['deck']}"
        write_pdf(root / deck_rel, lecture["slides"])
        nn = f"{number:02d}"
        related = []
        if lecture["session"]:
            session_dir = f"materials/sessions/{lecture['session']}-lecture"
            segments = [s["seconds"] for s in lecture["slides"]] + [r["seconds"] for r in lecture["revisits"]]
            write_wav(root / session_dir / lecture["recording"], segments)
            lines = [line for s in lecture["slides"] for line in s["lines"]] + [line for r in lecture["revisits"] for line in r["lines"]]
            _write(root / session_dir / lecture["transcript"], "\n".join(lines) + "\n")
            if lecture.get("cue_file"):
                _write(root / session_dir / Path(lecture["transcript"]).with_suffix(".vtt").name, _vtt(lecture))
            if lecture["indexed"]["transcript"]:
                related.append(f"src-lecture-{nn}-transcript")
                sources.append(_entry(root, f"src-lecture-{nn}-transcript", "lecture_transcript", f"{session_dir}/{lecture['transcript']}", date=lecture["session"],
                                      related=[f"src-lecture-{nn}-slides"], origin=f"session:{cid}:{lecture['session']}-lecture"))
            if lecture["indexed"]["recording"]:
                related.append(f"src-lecture-{nn}-recording")
                sources.append(_entry(root, f"src-lecture-{nn}-recording", "lecture_recording", f"{session_dir}/{lecture['recording']}", role="reference", date=lecture["session"],
                                      related=[f"src-lecture-{nn}-slides"], review="not_needed"))
        if lecture.get("sheet"):
            sheet_rel = f"materials/lectures/{lecture['unit']}/{lecture['sheet']['file']}"
            write_pdf(root / sheet_rel, lecture["sheet"]["pages"])
            related.append(f"src-lecture-{nn}-in-class-questions")
            sources.append(_entry(root, f"src-lecture-{nn}-in-class-questions", "in_class_question_sheet", sheet_rel, related=[f"src-lecture-{nn}-slides"]))
        if lecture["indexed"]["slides"]:
            sources.append(_entry(root, f"src-lecture-{nn}-slides", "lecture_slides", deck_rel, date=lecture["session"], related=related))
    (root / "materials/sessions/2026-09-10-lecture").mkdir(parents=True, exist_ok=True)  # session folder with nothing recorded

    write_pdf(root / "materials/assignments/ps-01/Fixture PS01.pdf", c.PS01_PAGES)
    write_pdf(root / "materials/assignments/ps-01/Fixture PS01 solutions.pdf", c.PS01_SOLUTION_PAGES)
    write_pdf(root / "materials/textbook/Fixture Textbook.pdf", c.TEXTBOOK_PAGES)
    sources.append(_entry(root, "src-ps-01-brief", "assignment_brief", "materials/assignments/ps-01/Fixture PS01.pdf", date="2026-09-05"))
    sources.append(_entry(root, "src-ps-01-solutions", "assignment_solution", "materials/assignments/ps-01/Fixture PS01 solutions.pdf", role="reference", date="2026-09-12", related=["src-ps-01-brief"]))
    sources.append(_entry(root, "src-ps-02-brief", "assignment_brief", None))
    write_docx(root / "materials/assignments/ps-03/Fixture PS03.docx", [*c.PS03_QUESTION_LINES, c.FIXTURE_NOTE])  # labelled synthetic, like every fixture page
    write_pdf(root / "materials/assignments/ps-03/Fixture PS03 blank.pdf", c.PS03_PAGES)
    sources.append(_entry(root, "src-ps-03-brief", "assignment_brief", "materials/assignments/ps-03/Fixture PS03.docx", date="2026-09-19"))
    sources.append(_entry(root, "src-ps-03-working-pdf", "assignment_working_copy", "materials/assignments/ps-03/Fixture PS03 blank.pdf", role="reference", date="2026-09-19", related=["src-ps-03-brief"]))
    _write_index(root, cid, sources)
    index = {s["source_id"]: s for s in sources}

    def version_of(source_id: str) -> str:
        return index[source_id]["current_version_id"]

    skills = []
    for s in c.BE505_SKILLS:
        skills.append({"skill_id": s["skill_id"], "topic_ids": [s["topic"]], "ability": s["ability"], "performance_target": s["target"],
                       "assessment_conditions": "Closed notes unless stated.", "need_basis": "user_selected", "priority": s["priority"], "priority_reason": "Fixture planning judgment.",
                       "study_decision": s["decision"], "linked_item_ids": [], "source_refs": [{"source_id": s["source"][0], "version_id": version_of(s["source"][0]), "locator": s["source"][1]}],
                       "concept_id": s["concept"], "action_types": [s["ability"]], "criterion_refs": []})
    _write(root / "learning/skills.yaml", _yaml(_skills_doc(cid, c.BE505_TOPICS, skills)))

    families, questions = [], []
    for q in c.BE505_QUESTIONS:
        skill_ids = [crit[0] for crit in q["criteria"]]
        ref = {"source_id": q["source"][0], "version_id": version_of(q["source"][0]), "locator": q["source"][1]}
        families.append({"family_id": q["family_id"], "revision": 1, "format": "short written explanation", "skill_ids": skill_ids,
                         "reasoning_signature": "Explain mechanism and boundary.", "prompt_template": q["prompt"] or q["prompt_status"], "origin": q["origin"], "source_refs": [ref],
                         "rubric": [{"skill_id": crit[0], "criterion": crit[2]} for crit in q["criteria"]], "question_ids": [q["question_id"]]})
        questions.append({"question_id": q["question_id"], "version": 1, "collection": q["collection"], "number": q["number"], "title": q["title"], "prompt": q["prompt"],
                          "criteria": [{"criterion_id": f"{q['question_id']}.C{i:02d}", "tag": "core", "action": crit[3][0], "observable": crit[2], "concept_id": crit[1], "skill_id": crit[0], "action_types": crit[3]}
                                       for i, crit in enumerate(q["criteria"], start=1)],
                          "origin": q["origin"], "source_refs": [ref], "source_note": c.FIXTURE_NOTE, "bank_path": q.get("bank_path", "work/lecture-review/fixture-question-bank.md"), "input_files": {},
                          "topic": "be505.topic.plasmids", "family_id": q["family_id"], "family_revision": 1, "page": q["page"],
                          "assessor_path": "work/lecture-review/lecture-01-assessor-guide-v1.md",
                          **({"prompt_status": q["prompt_status"]} if q["prompt"] is None else {}), **({"source_path": q["source_path"]} if q.get("source_path") else {})})
    families.append({"family_id": "be505.family.slide-teach-back-unrubriced", "revision": 1, "format": "open teach-back", "skill_ids": ["be505.skill.selection.interpret"],
                     "reasoning_signature": "Fixture family used to exercise catalog reads.", "prompt_template": "Explain this slide in your own words.", "origin": "generated_practice",
                     "source_refs": [{"source_id": "src-lecture-01-slides", "version_id": version_of("src-lecture-01-slides"), "locator": "slide 4"}],
                     "rubric": [{"skill_id": "be505.skill.selection.interpret", "criterion": "States what selection shows and does not show."}]})
    _write(root / "learning/question-families.yaml", _yaml(_families_doc(cid, families)))
    _write(root / "learning/question-index.json", _json({
        "contract_version": "be505-question-index-v1", "revision": 1, "course_id": cid, "term": TERM, "record_state": "live", "questions": questions, "concepts": c.BE505_CONCEPTS,
        "relationships": [dict(r, automatic_credit=False) for r in c.BE505_RELATIONSHIPS], "legacy_attempt_links": [],
        "policy": {"shared_concept": "Synthetic: a shared concept alone never grants credit.", "strict_containment": "Synthetic: containment is a relation between questions, not automatic credit.",
                   "unassessed": "Synthetic: artifacts without a genuine response are not attempts.", "family_matching": "Synthetic: a question is matched to its family by id and revision.",
                   "future_attempts": "Synthetic: new attempts carry question_id and question_version.", "coverage": c.FIXTURE_NOTE}, "source_index_digest": sha256_hex((root / ".agent/source-index.json").read_bytes()), "unassessed_artifacts": []}))
    # Answer guidance stays in a separate restricted file, as in the real course.
    # Answer guidance stays in a separate restricted file, shaped as in the real course: entries keyed ``id``, a version on the file and on most entries.
    _write(root / "work/lecture-review/lecture-01-question-map-v1.json", _json({"version": 1, "questions": [
        {"id": q["question_id"], **({"version": "1"} if q["number"] % 2 else {}), "title": q["title"], "prompt": q["prompt"], "criteria": [crit[2] for crit in q["criteria"]],
         "answer": q["answer"], "source": q["source"][1], "summary_page": "1"} for q in c.BE505_QUESTIONS], "strict_containment": []}))
    _write(root / "work/lecture-review/lecture-01-assessor-guide-v1.md", "# Fixture assessor guide (restricted)\n\n" + "\n".join(f"- {q['question_id']}: {q['answer']}" for q in c.BE505_QUESTIONS) + "\n")

    q1, q3, ps1 = c.BE505_QUESTIONS[0], c.BE505_QUESTIONS[2], c.BE505_QUESTIONS[3]
    _save_record(root, _attempt(cid, "be505-20260905-l01-q01-teachback-01", "2026-09-05T15:00:00+00:00", (q1["family_id"], 1), q1["prompt"],
                                "The origin is where the gene gets switched on.", [_observation("be505.skill.ori.explain", "partial", missing=["Confuses replication start with switching the gene on."], errors=["concept"])],
                                question_id=q1["question_id"], review={"skill_ids": ["be505.skill.ori.explain"], "reason": "Fixture: replication/transcription confusion.", "suggested_date": None, "selection": "unselected"}))
    _save_record(root, _attempt(cid, "be505-20260906-l01-q01-retry-02", "2026-09-06T15:00:00+00:00", (q1["family_id"], 1), q1["prompt"],
                                "Replication of the plasmid starts at the origin; it does not control expression.", [_observation("be505.skill.ori.explain", "demonstrated")],
                                question_id=q1["question_id"], prior_exposure="seen_exact"))
    _save_record(root, _attempt(cid, "be505-20260907-l01-q03-assisted-03", "2026-09-07T15:00:00+00:00", (q3["family_id"], 1), q3["prompt"],
                                "The plasmid is still copied. I am not sure about the product.", [
                                    _observation("be505.skill.ori-vs-promoter.integrate", "not_demonstrated", assistance="hint", missing=["Does not state the gene product is absent."], errors=["concept"], confidence="medium"),
                                    _observation("be505.skill.ori.explain", "demonstrated", assistance="hint"),
                                    _observation("be505.skill.promoter.explain", "not_observed", assistance="hint")],
                                mode="learn", occurred_at=None, time_basis="unknown", question_id=q3["question_id"]))
    _save_record(root, {"contract_version": "course-learning-v1", "course_id": cid, "term": TERM, "record_kind": "assessment_revision", "event_id": "be505-20260908-l01-q03-regrade-01",
                        "attempt_id": "be505-20260907-l01-q03-assisted-03", "replaces_assessment_id": "be505-20260907-l01-q03-assisted-03", "recorded_at": "2026-09-08T15:00:00+00:00",
                        "reason": "Fixture regrade: the response did separate copying from product, partially.",
                        "observations": [_observation("be505.skill.ori-vs-promoter.integrate", "partial", assistance="hint", missing=["Product outcome stated only tentatively."], errors=["concept"], confidence="medium"),
                                         _observation("be505.skill.ori.explain", "demonstrated", assistance="hint"),
                                         _observation("be505.skill.promoter.explain", "not_observed", assistance="hint")]})
    _save_record(root, _attempt(cid, "be505-20260909-ps01-q01-04", "2026-09-09T15:00:00+00:00", (ps1["family_id"], 1), ps1["prompt"], "Growth means the gene works.",
                                [_observation("be505.skill.selection.interpret", "uncertain", assistance="unknown", reference="unknown", confidence="low")], question_id=ps1["question_id"], prior_exposure="unknown"))
    write_learning_state(root, cid)

    # Reviewed source links (the app's own sidecar extension of the source-link owner).
    l1, l2 = c.BE505_LECTURES[0], c.BE505_LECTURES[1]
    transcript_rel = f"materials/sessions/{l1['session']}-lecture/{l1['transcript']}"
    support = _artifact(root, transcript_rel, "text/plain")
    line = 1
    occurrences = [(i + 1, s["seconds"], s["lines"]) for i, s in enumerate(l1["slides"])] + [(r["slide"], r["seconds"], r["lines"]) for r in l1["revisits"]]
    counts: dict[int, int] = {}
    for slide, (start, end), lines in occurrences:
        counts[slide] = counts.get(slide, 0) + 1
        page = _source_ref(root, index, "src-lecture-01-slides", {"kind": "page", "page": slide, "printed_label": None})
        media = _source_ref(root, index, "src-lecture-01-recording", {"kind": "media", "start_ms": start * 1000, "end_ms": end * 1000, "origin": "original_source_start"})
        text = _source_ref(root, index, "src-lecture-01-transcript", {"kind": "lines", "start": line, "end": line + len(lines) - 1})
        suffix = f"s{slide:02d}-o{counts[slide]}"
        _annotation(root, f"ann-l01-{suffix}-displayed", "displayed_during", page, media, state="confirmed", basis="manual_review", support=support, reviewer="fixture-reviewer")
        _annotation(root, f"ann-l01-{suffix}-transcript-time", "discussed_during", text, media, state="confirmed", basis="manual_review", support=support, reviewer="fixture-reviewer")
        _annotation(root, f"ann-l01-{suffix}-transcript", "explained_by", page, text, state="confirmed", basis="reviewed_source_map", support=support, reviewer="fixture-reviewer")
        line += len(lines)
    slide3 = _source_ref(root, index, "src-lecture-01-slides", {"kind": "page", "page": 3, "printed_label": None})
    slide2 = _source_ref(root, index, "src-lecture-01-slides", {"kind": "page", "page": 2, "printed_label": None})
    slide4 = _source_ref(root, index, "src-lecture-01-slides", {"kind": "page", "page": 4, "printed_label": None})
    _annotation(root, "ann-l01-s03-textbook", "explained_by", slide3, _disk_ref(root, "materials/textbook/Fixture Textbook.pdf", {"kind": "page", "page": 2, "printed_label": "34"}),
                state="confirmed", basis="manual_review", support=support, reviewer="fixture-reviewer")
    _annotation(root, "ann-l01-s02-textbook-chapter", "explained_by", slide2, _disk_ref(root, "materials/textbook/Fixture Textbook.pdf", {"kind": "text", "description": "Chapter 3 (chapter-level relation; no exact page reviewed)"}),
                state="suggested", basis="transcript_only", support=support, reviewer=None)
    _annotation(root, "ann-l01-s04-ps01", "practiced_by", slide4, _source_ref(root, index, "src-ps-01-brief", {"kind": "page", "page": 1, "printed_label": None}),
                state="confirmed", basis="manual_review", support=support, reviewer="fixture-reviewer")
    # Lecture 02 carries no seeded links: its suggestions are produced by the preparation pipeline from the cue file.
    del l2


# ---- lighter courses ----------------------------------------------------------------------------
def _build_other(root: Path, cid: str, spec: dict) -> None:
    _write(root / "course.yaml", _yaml({"schema_version": 1, "course_id": cid, "term": TERM, "display_name": spec["display_name"], "workspace_root": ".", "bindings": {"planner": None, "shared_learning": None}}))
    _write(root / "AGENTS.md", f"# Fixture course instructions\n\n{c.COURSE_INSTRUCTIONS[cid]}\n")
    _write(root / "learning-strategy.md", _strategy_text(cid))
    sources: list[dict] = []
    for i, lecture in enumerate(spec["lectures"], start=1):
        rel = f"materials/lectures/{lecture['unit']}/{lecture['deck']}"
        if lecture.get("empty"):
            _write(root / rel, b"")
        elif lecture.get("pptx"):
            _write(root / rel, b"PK\x03\x04 synthetic fixture placeholder: not a real presentation; exercises the rendition-needed state\n")
        else:
            write_pdf(root / rel, [{"title": t, "bullets": ["Synthetic fixture slide."], "figure": "ring"} for t in lecture["slides"]])
        if lecture["indexed"]:
            sources.append(_entry(root, f"src-{lecture['unit']}-slides", "lecture_slides", rel))
        for name, titles in lecture.get("more_decks", []):
            write_pdf(root / f"materials/lectures/{lecture['unit']}/{name}", [{"title": t, "bullets": ["Synthetic fixture reading."], "figure": "marker"} for t in titles])
        for name in lecture.get("notes", []):
            _write(root / f"materials/lectures/{lecture['unit']}/{name}", "Synthetic fixture note for this lecture unit.\n")
    for i, session in enumerate(spec["sessions"], start=1):
        directory = f"materials/sessions/{session['date']}-lecture"
        (root / directory).mkdir(parents=True, exist_ok=True)
        if session["transcript"]:
            _write(root / directory / session["transcript"], "Synthetic fixture transcript line one.\nSynthetic fixture transcript line two.\n")
            if session.get("index_transcript"):
                sources.append(_entry(root, f"src-lecture-{i:02d}-transcript", "lecture_transcript", f"{directory}/{session['transcript']}", date=session["date"], origin=f"session:{cid}:{session['date']}-lecture",
                                      related=[f"src-{session['lecture']}-slides"] if session.get("lecture") else None))
        if session["recording"]:
            write_wav(root / directory / session["recording"], [(0, 6)])
            if session.get("index_recording"):
                sources.append(_entry(root, f"src-lecture-{i:02d}-audio", "lecture_recording", f"{directory}/{session['recording']}", role="reference", date=session["date"], review="not_needed",
                                      related=[f"src-{session['lecture']}-slides"] if session.get("lecture") else None))
    for placeholder in spec["placeholders"]:
        sources.append(_entry(root, placeholder, "assignment_brief", None))
    if not sources:
        _write(root / "materials/admin/Fixture syllabus.txt", "Synthetic fixture syllabus.\n")
        sources.append(_entry(root, "src-syllabus-fixture", "syllabus", "materials/admin/Fixture syllabus.txt"))
    _write_index(root, cid, sources)
    first = sources[0]
    ref = {"source_id": first["source_id"], "version_id": first["current_version_id"], "locator": "fixture"}
    topic = f"{cid}.topic.fixture"
    skills = [{"skill_id": sid, "topic_ids": [topic], "ability": ability, "performance_target": target, "assessment_conditions": "Fixture.", "need_basis": "explicit_requirement",
               "priority": "high", "priority_reason": "Fixture.", "study_decision": "develop", "linked_item_ids": [], "source_refs": [ref]} for sid, ability, target in spec["skills"]]
    _write(root / "learning/skills.yaml", _yaml(_skills_doc(cid, [{"topic_id": topic, "label": "Fixture topic", "aliases": []}], skills)))
    family_id, family_skills, prompt = spec["family"]
    _write(root / "learning/question-families.yaml", _yaml(_families_doc(cid, [{
        "family_id": family_id, "revision": 1, "format": "short written", "skill_ids": family_skills, "reasoning_signature": "Fixture.", "prompt_template": prompt, "origin": "generated_practice",
        "source_refs": [ref], "rubric": [{"skill_id": s, "criterion": "Fixture criterion for " + s.rsplit(".", 1)[-1]} for s in family_skills]}])))
    (root / "learning/attempts").mkdir(parents=True, exist_ok=True)
    if spec["attempts"]:
        observations = [_observation(family_skills[0], "partial", missing=["Fixture gap."], errors=["concept"])] + [_observation(s, "not_observed") for s in family_skills[1:]]
        _save_record(root, _attempt(cid, f"{cid}.attempt.20260912T035026Z.fixture-q1", "2026-09-12T03:50:26+00:00", (family_id, 1), prompt, "Synthetic fixture response.", observations))
    write_learning_state(root, cid)


# ---- planner -------------------------------------------------------------------------------------
def _build_planner(planner: Path, roots: dict[str, Path]) -> Path:
    config = {"contract": "main-planner-config-v1", "record_state": "live", "revision": 2, "timezone": "America/New_York",
              "paths": {"shared_learning": "shared-learning"}, "courses": {cid: {"root": root.as_posix()} for cid, root in roots.items()},
              "planning_policy": {"external_writes_enabled": False}}
    _write(planner / "planner-config.yaml", _yaml(config))
    # App-side read configuration of the fixture (the real one lives in the private binding): the page basis of one collection is "reviewed".
    _write(planner / "app-read-overrides.json", _json({"reviewed_page_basis": {"be505": ["L04"]}, "deck_overrides": {
        "be562": {"lecture-02": unregistered_source_id("materials/lectures/lecture-02/Fixture 562 Lecture 02.pdf")}}}))
    _write(planner / "AGENTS.md", f"# Fixture planner instructions\n\n{c.FIXTURE_NOTE}. Each course owns its records; a plan or file is not learning evidence.\n")
    _write(planner / "protocols/tutoring-policy.md", _policy_text())
    _write_policy_projection(planner, roots)
    _write(planner / "shared-learning/concepts.yaml", _yaml({
        "contract_version": "shared-learning-v1", "record_state": "live", "revision": 1,
        "concepts": [{"concept_id": "shared.probability.maximum-likelihood", "label": "Maximum likelihood (fixture)", "links": [
            {"link_id": "link.be562.chain-rule", "course_id": "be562", "skill_id": "be562.skill.chain-rule-factorization", "relation": "related", "review_state": "reviewed"},
            {"link_id": "link.cs542.mle", "course_id": "cs542", "skill_id": "cs542.skill.mle-explain", "relation": "related", "review_state": "reviewed"}]}]}))
    run = planner / "automation/course-tracking/runs/20260912T113243Z-0a1b2c3d-source-refresh"
    resource_key = sha256_hex(b"fixture-resource-key")
    course_reports = {}
    for cid, root in roots.items():
        marker = json.loads((root / ".agent/course-tracking/publication.json").read_text(encoding="utf-8"))
        files = dict(marker["files"], **{".agent/course-tracking/publication.json": sha256_hex((root / ".agent/course-tracking/publication.json").read_bytes())})
        snapshot = {"contract": "course-tracking-publish-baseline-v1", "publisher_version": "course-tracking-publisher-v1", "course_id": cid, "term": TERM,
                    "canonical_root": root.as_posix(), "resource_key": resource_key, "display_date": "2026-09-12", "files": files}
        _write(run / cid / "baseline.json", _json(snapshot))
        _write(run / cid / "post.json", _json(snapshot))
        _write(run / cid / "post-verify.json", _json({"publication": "consistent", "warnings": []}))
        index = json.loads((root / ".agent/source-index.json").read_text(encoding="utf-8"))
        course_reports[cid] = {"status": "EXPECTED", "changed_files": [], "expected_changed_files": [], "resource_key": resource_key,
                               "revisions": {"requirements": 1, "grades": 1, "source_index": index["revision"]}, "verify": {"publication": "consistent", "warnings": []},
                               "grades_sha256": marker["files"]["planning/grades.yaml"]}
    _write(run / "final-verification.json", _json({"contract": "course-source-refresh-final-verification-v1", "run": run.name, "courses": course_reports,
                                                    "physical_source_coverage": {"matched_readable_non_reference": 0, "mismatched": 0, "missing": 0, "reference_records_not_bulk_hashed": 0, "unavailable_or_nonreadable_records": 0, "details": {}},
                                                    "focused_checks": {}}))
    _write(run / "run-result.md", f"# Fixture source refresh run\n\n{c.FIXTURE_NOTE}\n")
    return planner / "planner-config.yaml"


def build_fixture_workspace(root: Path) -> Path:
    """Create the synthetic workspace under ``root`` and return the planner-config path."""
    root.mkdir(parents=True, exist_ok=True)
    _write(root / MARKER, f"version={FIXTURE_VERSION}\n{c.FIXTURE_NOTE}\n")
    names = {"be505": "BE 505", "be562": "BE 562", "be572": "BE 572", "cs542": "CS 542", "ds551": "DS 551"}
    roots = {cid: root / "University" / name for cid, name in names.items()}
    _build_be505(roots["be505"])
    for cid, spec in c.OTHER_COURSES.items():
        _build_other(roots[cid], cid, spec)
    return _build_planner(root / "University" / "Fixture Brain", roots)


def ensure_fixture_workspace(root: Path) -> Path:
    """Reuse an existing fixture of the current version; otherwise (re)build it.

    Only a directory that carries this module's marker file is ever replaced.
    """
    marker = root / MARKER
    config = root / "University" / "Fixture Brain" / "planner-config.yaml"
    if marker.is_file() and marker.read_text(encoding="utf-8").startswith(f"version={FIXTURE_VERSION}\n") and config.is_file():
        return config
    if root.exists():
        if not marker.is_file():
            raise RuntimeError(f"Refusing to replace {root}: it is not a generated fixture workspace")
        shutil.rmtree(root)
    return build_fixture_workspace(root)
