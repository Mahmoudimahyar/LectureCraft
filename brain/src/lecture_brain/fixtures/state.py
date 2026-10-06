"""App-private state of the synthetic fixture profile for its showcase unit (be505 lecture-05, amendment R2).

The fixture workspace (``builder.py``) holds what a course holds: files, an index, catalogs, a study map. What makes a
lecture view show recording ranges and suggested question links is NOT course material: it is state the app keeps for
itself. :func:`install` puts that state in place for the showcase unit, through the same doors the real profiles use:

a. the generated speech text of the showcase recording is IMPORTED by ``Derived.import_generation`` from the output
   root the fixture's synthetic speech double left beside the course folders (manifest contract, identity and byte
   checks, receipt — nothing is copied around the importer);
b. a suggestions file ``ll.inferred-anchors/1`` is STORED by ``inferred_anchors.store`` (the reader's own rules; a
   document it would refuse is not written);
c. the lecture's timing links are BUILT by ``timing_links.build`` from those inputs.

Everything here is labelled synthetic: no speech was recognised and no agent pass proposed or checked a link. The
states exist so that every one of them can be seen on screen and driven in a browser test.

Only the fixture profile is served: any other profile is refused before anything is read. A second call finds a note
of the first one (``<state_dir>/fixture-state.json``), checks that what it names is still there and does nothing else.
A suggestions file somebody else stored is left alone and reported.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from .. import contracts as c
from .. import inferred_anchors, timing_links
from ..config import Settings
from ..derived import MANIFEST_NAME, Derived
from ..fsutil import replace_atomic
from ..ownerio.inventory import primary_deck
from . import content
from .builder import FIXTURE_VERSION, MARKER, SHOWCASE_COURSE, SHOWCASE_RECORDING_ID, showcase_speech_root

STATE_CONTRACT = "fixture-state/1"
STATE_FILE = "fixture-state.json"
ANCHORS_PRODUCER = "synthetic-fixture (written out by lecture_brain.fixtures.state; no agent pass ran)"
ANCHORS_PRODUCED_AT = "2026-09-15T18:30:00Z"  # a fixed synthetic time: the same fixture gives the same file

__all__ = ["FixtureStateError", "STATE_CONTRACT", "STATE_FILE", "ANCHORS_PRODUCER", "install", "suggestions_document"]


class FixtureStateError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def _fixture_root(settings: Settings) -> Path:
    """The generated workspace the settings are bound to: ``<root>/University/Fixture Brain/planner-config.yaml``."""
    root = settings.planner_config.parents[2]
    if not (root / MARKER).is_file():
        raise FixtureStateError("not_a_fixture_workspace", "The planner configuration is not inside a generated synthetic fixture workspace.")
    return root


def _file_sha256(path: Path) -> str | None:
    try:
        return c.sha256_hex(path.read_bytes())
    except OSError:
        return None


def suggestions_document(settings: Settings, *, context: dict | None = None) -> dict[str, Any]:
    """The synthetic suggestions of the showcase unit as an ``ll.inferred-anchors/1`` document made against the course
    as it is now (question index, deck bytes). Pure but for reading the course."""
    context = context or inferred_anchors.course_context(settings, SHOWCASE_COURSE)
    index = context["index"]
    if index is None:
        raise FixtureStateError("catalog_unreadable", "The fixture question index could not be read.")
    lecture_id = content.SHOWCASE["unit"]
    lecture = next((unit for unit in context["inventory"]["lectures"] if unit["lecture_id"] == lecture_id), None)
    deck = primary_deck(lecture) if lecture is not None else None
    sha256 = context["deck_sha256_of"](deck) if deck is not None else None
    if sha256 is None:
        raise FixtureStateError("showcase_deck_missing", f"The fixture has no readable deck for {lecture_id}.")

    def criterion(question_id: str, number: int) -> str:
        return f"{question_id}.C{number:02d}"

    items = []
    for given in content.SHOWCASE_SUGGESTIONS:
        question_id = given["question_id"]
        item = {"question_id": question_id, "question_version": index["questions"][question_id]["version"], "lecture_id": lecture_id, "source_id": deck["source_id"],
                "source_sha256": sha256, "pages": list(given["pages"]), "regions": None, "criteria": [criterion(question_id, n) for n in given["criteria"]],
                "coverage": given["coverage"], "rationale": given["rationale"], "state": given["state"], "verifier": dict(given["verifier"]) if given["verifier"] else None}
        if given["per_page"] is not None:
            item["per_page"] = [{"page": page, "supports": [criterion(question_id, n) for n in numbers]} for page, numbers in sorted(given["per_page"].items())]
        items.append(item)
    examined = [{"question_id": given["question_id"], "question_version": index["questions"][given["question_id"]]["version"], "why": given["why"], "verifier": dict(given["verifier"])}
                for given in content.SHOWCASE_NO_CANDIDATE]
    return {"contract": inferred_anchors.CONTRACT, "course_id": SHOWCASE_COURSE, "produced_at": ANCHORS_PRODUCED_AT, "producer": ANCHORS_PRODUCER,
            "question_index_sha256": index["sha256"], "items": items, "no_candidate": examined}


def _links_path(settings: Settings) -> Path:
    """Where the app keeps the derived timing links of the showcase unit: ``<app area>/timing-links/<lecture_id>.json``."""
    return settings.app_area(SHOWCASE_COURSE) / "timing-links" / f"{content.SHOWCASE['unit']}.json"


def _note_holds(settings: Settings, note: Any, key: str, derived: Derived) -> bool:
    """Whether a note of an earlier install still describes what is on disk: the same fixture and speech output, the
    stored generation, the suggestions file with the bytes it had then, and the links document of that build."""
    if not isinstance(note, dict) or note.get("contract") != STATE_CONTRACT or note.get("key") != key:
        return False
    try:
        if derived.stored_created_at(SHOWCASE_COURSE, SHOWCASE_RECORDING_ID, str(note["generation"]["generation"])) is None:
            return False
        if _file_sha256(inferred_anchors.anchors_path(settings, SHOWCASE_COURSE)) != note["anchors"]["sha256"]:
            return False
        links = json.loads(_links_path(settings).read_text(encoding="utf-8"))
        return links.get("links_revision") == note["timing"]["links_revision"]
    except (OSError, ValueError, KeyError, TypeError):
        return False


def install(settings: Settings, *, now: Callable[[], str] | str, journal: Any = None, preparation: Any = None) -> dict[str, Any]:
    """Put the showcase unit's app-private state in place (see the module text) and say what was done.

    ``now`` is the app's clock (a callable giving an ISO time, or the time itself); ``journal`` and ``preparation`` are
    the running app's own when there is one (receipts then go to its journal instead of a second connection).
    Returns ``{status: "installed" | "unchanged", course_id, lecture_id, generation, anchors, timing}``.
    Raises :class:`FixtureStateError` for any profile but ``fixture`` and whenever a step was refused: a refused import
    or a refused suggestions file is never reported as done.
    """
    if settings.profile != "fixture":
        raise FixtureStateError("fixture_profile_only", f"Synthetic showcase state is installed only under the fixture profile, not under {settings.profile!r}.")
    clock: Callable[[], str] = now if callable(now) else (lambda: now)
    root = _fixture_root(settings)
    lecture_id = content.SHOWCASE["unit"]
    speech_root = showcase_speech_root(root)
    manifest_sha256 = _file_sha256(speech_root / MANIFEST_NAME)
    if manifest_sha256 is None:
        raise FixtureStateError("speech_output_missing", "The fixture workspace holds no speech output for the showcase recording; it was built by an older fixture version.")
    key = c.sha256_hex(c.dump_json([STATE_CONTRACT, FIXTURE_VERSION, manifest_sha256]))
    note_path = settings.state_dir / STATE_FILE
    try:
        note = json.loads(note_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        note = None
    derived = Derived(settings, journal, preparation=preparation, now=clock)
    if _note_holds(settings, note, key, derived):
        return dict(note, status="unchanged")

    # a. the generated speech text, through the importer
    generation = json.loads((speech_root / MANIFEST_NAME).read_text(encoding="utf-8"))["generation"]
    if derived.stored_created_at(SHOWCASE_COURSE, SHOWCASE_RECORDING_ID, generation) is not None:
        imported = {"status": "already_stored", "generation": generation}
    else:
        result = derived.import_generation(speech_root, course_id=SHOWCASE_COURSE)
        if result["status"] not in {"imported", "reused"}:
            raise FixtureStateError("speech_import_refused", f"The importer did not accept the fixture's speech output ({result.get('reason')}): {result.get('detail')}")
        imported = {"status": result["status"], "generation": result["generation"]}

    # b. the suggestions file, through its own reader's rules
    path = inferred_anchors.anchors_path(settings, SHOWCASE_COURSE)
    try:
        there = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        there = None
    if isinstance(there, dict) and there.get("producer") != ANCHORS_PRODUCER:
        anchors = {"status": "kept_other_file", "sha256": _file_sha256(path), "producer": there.get("producer")}  # somebody else's suggestions are not replaced
    else:
        context = inferred_anchors.course_context(settings, SHOWCASE_COURSE)
        try:
            stored = inferred_anchors.store(settings, SHOWCASE_COURSE, suggestions_document(settings, context=context), index=context["index"], inventory=context["inventory"],
                                            deck_sha256_of=context["deck_sha256_of"], guidance_text_of=context["guidance_text_of"])
        except inferred_anchors.InferredAnchorError as exc:
            raise FixtureStateError("suggestions_refused", f"The suggestions reader refused the fixture's document ({exc.code}): {exc.detail}") from None
        anchors = {key_: stored[key_] for key_ in ("status", "sha256", "accepted", "rejected_by_verifier", "no_candidate", "guidance_check")}

    # c. the timing links of the showcase unit, from what is now there
    try:
        document = timing_links.build(settings, SHOWCASE_COURSE, lecture_id, journal=journal, preparation=preparation, now=clock)
    except timing_links.TimingLinksError as exc:
        raise FixtureStateError("timing_build_refused", exc.message) from None
    record = next((row for row in document["recordings"] if row["source_id"] == SHOWCASE_RECORDING_ID), None)
    timing = {"links_revision": document["links_revision"], "stage": record["stage"] if record else None, "links": len(document["links"]), "candidates": len(document["candidates"]),
              "unassigned": len(document["unassigned"])}

    note = {"contract": STATE_CONTRACT, "key": key, "fixture_version": FIXTURE_VERSION, "course_id": SHOWCASE_COURSE, "lecture_id": lecture_id, "installed_at": clock(),
            "generation": imported, "anchors": anchors, "timing": timing,
            "note": "Synthetic fixture state: generated speech text nobody recognised and suggestions no agent pass made. Not evidence of anything."}
    replace_atomic(note_path, c.dump_json(note))
    return dict(note, status="installed")
