"""Remediation R1-E: the consumer of generated speech timing (derived manifests).

Everything here is synthetic. No speech recognition runs, nothing is installed and no real recording is read: the
"producer" is a helper that writes an output root the way a future runner would. What is proven is the consumer —
contract, private import into the app-local derived store, source-version invalidation, and the readback.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

from lecture_brain import contracts as c
from lecture_brain import derived as d
from lecture_brain.derived import Derived
from lecture_brain.journal import Journal
from lecture_brain.ownerio.inventory import build_inventory
from lecture_brain.preparation import Preparation

NOW = "2026-10-05T12:00:00Z"
PRODUCER = {"tool": "synthetic-fixture-producer", "tool_version": "0.0.0", "model": "none-synthetic", "language": "en", "parameters_sha256": "b" * 64}


@pytest.fixture()
def journal(settings, clock):
    j = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    yield j
    j.close()


@pytest.fixture()
def derived(settings, journal):
    return Derived(settings, journal, now=lambda: NOW)


def recording(settings, course="be505", *, registered=True) -> dict:
    """A synthetic recording of the fixture course (a generated tone WAV), found the way the app finds it."""
    inventory = build_inventory(settings.course(course))
    return next(i for s in inventory["sessions"] for i in s["items"] if i["kind"] == "lecture_recording" and (i["registration"] == "registered") == registered)


def tree(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


def default_segments(length_ms: int) -> list[dict]:
    """Four generated sentences with CLIP-relative times; the first carries word times."""
    step = length_ms // 4
    rows = [{"index": i, "clip_start_ms": i * step, "clip_end_ms": (i + 1) * step, "text": f"Synthetic generated sentence {i + 1}."} for i in range(4)]
    rows[0]["words"] = [{"clip_start_ms": 0, "clip_end_ms": 400, "text": "Synthetic", "probability": 0.9}, {"clip_start_ms": 400, "clip_end_ms": 900, "text": "generated"}]
    return rows


def write_root(root: Path, settings, *, course="be505", item=None, generation="gen-0001", window=(0, 20_000), offset=None, segments=None, created_at=NOW,
               duration_ms="measured", edit_segments=None, edit_manifest=None, extra_files=None, write_manifest=True) -> Path:
    """What a future runner leaves in its output root: outputs first, ``manifest.json`` last. Labeled synthetic double:
    the text is invented here, no audio is decoded."""
    from lecture_brain.annotations import media_duration_ms

    item = item or recording(settings, course)
    _, sha256 = Preparation(settings, converter=None).identity_of(course, item)
    if duration_ms == "measured":
        duration_ms = media_duration_ms(settings.course(course).root / item["path"])
    offset = window[0] if offset is None else offset
    document = {"contract": "ll.derived-segments/1", "course_id": course, "source_id": item["source_id"], "generation": generation, "time_base": "clip_relative",
                "clip_offset_ms": offset, "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": [],
                "segments": default_segments(window[1] - window[0]) if segments is None else segments}
    if edit_segments:
        edit_segments(document)
    root.mkdir(parents=True, exist_ok=True)
    files = {"segments.json": (c.dump_json(document), "application/json"), **(extra_files or {})}
    for name, (data, _) in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_bytes(data)
    manifest = {"contract": "ll.derived-manifest/1", "status": "complete", "kind": "speech_timing", "course_id": course, "generation": generation, "created_at": created_at,
                "consumer_version": d.CONSUMER_VERSION, "recording": {"source_id": item["source_id"], "sha256": sha256, "bytes": item["bytes"], "duration_ms": duration_ms},
                "producer": dict(PRODUCER), "window": {"start_ms": window[0], "end_ms": window[1]}, "time_base": "clip_relative", "clip_offset_ms": offset,
                "input_fingerprint": "0" * 64, "segments_path": "segments.json",
                "outputs": [c.artifact_for_bytes(data, name, media_type) for name, (data, media_type) in sorted(files.items())],
                "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": []}
    manifest["input_fingerprint"] = d.fingerprint_of(manifest)
    if edit_manifest:
        edit_manifest(manifest)
    if write_manifest:
        (root / "manifest.json").write_bytes(c.dump_json(manifest))
    return root


# ---- contract ---------------------------------------------------------------------------------------------------------
def test_manifest_and_segments_contracts_accept_the_examples_and_reject_unreviewed_claims(fixture_json):
    manifest = fixture_json("derived-manifest.valid.json")
    segments = fixture_json("derived-segments.valid.json")
    assert c.validate("derived-manifest", manifest) == []
    assert c.validate("derived-segments", segments) == []
    # A generation that is not finished is not a manifest: manifest-last means "complete" is the only status.
    assert c.validate("derived-manifest", dict(manifest, status="partial"))
    # Generated timing never arrives claiming review, a slide association or recording-absolute times.
    assert c.validate("derived-manifest", dict(manifest, review_state="confirmed"))
    assert c.validate("derived-manifest", dict(manifest, establishes=["slide_association"]))
    assert c.validate("derived-manifest", dict(manifest, time_base="recording_absolute"))
    assert c.validate("derived-segments", dict(segments, establishes=["human_review"]))
    assert c.validate("derived-segments", dict(segments, text_origin="original_transcript"))
    # Output paths are portable relative paths only.
    for bad in ("../segments.json", "/abs/segments.json", "C:/out/segments.json", "a\\b.json", "out/./segments.json"):
        broken = copy.deepcopy(manifest)
        broken["outputs"][0]["path"] = bad
        assert c.validate("derived-manifest", broken), bad
    # The window is required: a manifest cannot leave open how much of the recording was processed.
    assert c.validate("derived-manifest", {k: v for k, v in manifest.items() if k != "window"})
    assert c.validate("derived-manifest", {k: v for k, v in manifest.items() if k != "clip_offset_ms"})
    # A segment that states one absolute time must state both.
    half = copy.deepcopy(segments)
    half["segments"][0]["start_ms"] = 0
    assert c.validate("derived-segments", half)


def test_the_input_fingerprint_is_a_pinned_formula_a_runner_can_reproduce(fixture_json):
    """The runner computes this digest without this code. The formula is canonical JSON (sorted keys, no spaces, UTF-8)
    of exactly these fields; the committed example manifest carries the value, and this vector pins it."""
    manifest = fixture_json("derived-manifest.valid.json")
    material = {"contract": "ll.derived-input/1", "consumer_version": manifest["consumer_version"],
                "recording": {"sha256": manifest["recording"]["sha256"], "bytes": manifest["recording"]["bytes"]}, "window": manifest["window"],
                "clip_offset_ms": manifest["clip_offset_ms"], "producer": manifest["producer"]}
    by_hand = hashlib.sha256(json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    assert d.fingerprint_of(manifest) == by_hand == manifest["input_fingerprint"] == "b16c8aff84a7531fbfa95272fb564cdce41e35d9d15846a4c3df935c26bc20dd"
    assert d.CONSUMER_VERSION == manifest["consumer_version"] == "derived-consumer-1"
    # Every input changes it; the generation id and the creation time do not.
    assert d.fingerprint_of(dict(manifest, generation="another-id", created_at="2027-01-01T00:00:00Z")) == by_hand
    for change in ({"clip_offset_ms": 1}, {"window": {"start_ms": 0, "end_ms": 119_999}}, {"consumer_version": "derived-consumer-2"},
                   {"recording": dict(manifest["recording"], bytes=480_045)}, {"recording": dict(manifest["recording"], sha256="e" * 64)},
                   {"producer": dict(manifest["producer"], model="another-model")}, {"producer": dict(manifest["producer"], language="de")}):
        assert d.fingerprint_of(dict(manifest, **change)) != by_hand, change


def test_every_registered_derived_case_is_synthetic_and_listed(repo):
    cases = json.loads((repo / "fixtures/contracts/cases.json").read_text(encoding="utf-8"))["cases"]
    mine = [case for case in cases if case["schema"] in {"derived-manifest", "derived-segments"}]
    assert {case["schema"] for case in mine} == {"derived-manifest", "derived-segments"}
    for schema in ("derived-manifest", "derived-segments"):
        assert {case["expected_valid"] for case in mine if case["schema"] == schema} == {True, False}
    for case in mine:
        record = c.parse_json((repo / case["fixture"]).read_bytes())
        assert (not c.validate(case["schema"], record)) == case["expected_valid"], case["id"]
        assert record.get("course_id", "fixture-course") == "fixture-course"  # synthetic identity, never a real course


# ---- import and readback ----------------------------------------------------------------------------------------------
def test_a_complete_output_root_is_copied_into_the_app_store_and_read_back_in_recording_time(settings, derived, journal, tmp_path):
    item = recording(settings)
    materials_before = tree(settings.course("be505").root / "materials")
    root = write_root(tmp_path / "out" / "gen-0001", settings, window=(10_000, 30_000))  # a 20 s clip that starts 10 s into the 60 s recording
    root_before = tree(root)

    result = derived.import_generation(root, course_id="be505")

    assert result["status"] == "imported" and result["reused"] is False and result["reason"] is None
    stored = settings.app_area("be505") / "derived" / item["source_id"] / "gen-0001"
    assert tree(stored) == root_before  # the exact bytes, manifest included
    assert tree(root) == root_before and tree(settings.course("be505").root / "materials") == materials_before  # the importer only reads them

    current = derived.current("be505", item["source_id"])
    assert current["generation"] == "gen-0001" and current["state"] == "current"
    assert current["time_base"] == "recording_absolute" and current["clip_offset_ms"] == 10_000
    assert [(s["start_ms"], s["end_ms"]) for s in current["segments"]] == [(10_000, 15_000), (15_000, 20_000), (20_000, 25_000), (25_000, 30_000)]  # offset applied once
    assert [(w["start_ms"], w["end_ms"]) for w in current["segments"][0]["words"]] == [(10_000, 10_400), (10_400, 10_900)]
    assert current["segments"][1]["text"] == "Synthetic generated sentence 2."
    # How much of the recording this is: 20 s of 60 s, never "the lecture".
    assert current["window"] == {"start_ms": 10_000, "end_ms": 30_000} and current["duration_ms"] == 60_000
    assert current["coverage_fraction"] == pytest.approx(1 / 3) and current["covers_whole_recording"] is False
    # What it is: new generated text, unreviewed, establishing nothing about slides.
    assert current["text_origin"] == "generated_speech_text" and current["review_state"] == "generated_unreviewed" and current["establishes"] == []
    assert current["recording"]["sha256"] == Preparation(settings, converter=None).identity_of("be505", item)[1]

    receipts = journal.receipts(kind="derived-import")
    assert [r["payload"]["outcome"] for r in receipts] == ["imported"]
    assert receipts[0]["sha256"] == hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest() and receipts[0]["payload"]["generation"] == "gen-0001"


# ---- what is refused, and why -----------------------------------------------------------------------------------------
def stored_files(derived, course="be505") -> list[str]:
    store = derived.store_dir(course)
    return sorted(p.relative_to(store).as_posix() for p in store.rglob("*") if p.is_file()) if store.exists() else []


def assert_rejected(derived, journal, root, reason, *, course="be505"):
    """A refusal has a reason code, copies nothing, and leaves one receipt that says why."""
    before = stored_files(derived)
    result = derived.import_generation(root, course_id=course)
    assert (result["status"], result["reason"]) == ("rejected", reason), result
    assert result["reused"] is False and result["detail"]
    assert stored_files(derived) == before
    receipt = next(r for r in journal.receipts(kind="derived-import") if r["receipt_id"] == result["receipt_id"])
    assert receipt["payload"]["outcome"] == "rejected" and receipt["payload"]["reason"] == reason and receipt["job_id"] is None
    return result


def test_a_root_without_a_complete_manifest_is_incomplete_and_never_imported(settings, derived, journal, tmp_path):
    """Manifest-last: outputs without a manifest, or a manifest that does not say "complete", are work in progress."""
    assert_rejected(derived, journal, write_root(tmp_path / "no-manifest", settings, write_manifest=False), "incomplete")
    assert_rejected(derived, journal, write_root(tmp_path / "partial", settings, edit_manifest=lambda m: m.update(status="partial")), "incomplete")
    assert_rejected(derived, journal, tmp_path / "never-created", "root_missing")
    a_file = tmp_path / "a-file"
    a_file.write_text("not a directory", encoding="utf-8")
    assert_rejected(derived, journal, a_file, "root_missing")


def test_a_manifest_that_is_unreadable_invalid_or_meant_for_someone_else_is_refused(settings, derived, journal, tmp_path):
    broken = write_root(tmp_path / "broken", settings)
    (broken / "manifest.json").write_bytes(b'{"contract": "ll.derived-manifest/1", ')
    assert_rejected(derived, journal, broken, "manifest_unreadable")
    duplicated = write_root(tmp_path / "duplicated", settings)
    (duplicated / "manifest.json").write_bytes((duplicated / "manifest.json").read_bytes()[:-1] + b',"status":"complete"}')
    assert_rejected(derived, journal, duplicated, "manifest_unreadable")  # duplicate property: strict JSON only
    huge = write_root(tmp_path / "huge", settings)
    (huge / "manifest.json").write_bytes((huge / "manifest.json").read_bytes() + b" " * c.MAX_MANIFEST_BYTES)
    assert_rejected(derived, journal, huge, "manifest_too_large")
    assert_rejected(derived, journal, write_root(tmp_path / "extra", settings, edit_manifest=lambda m: m.update(approved=True)), "manifest_invalid")
    assert_rejected(derived, journal, write_root(tmp_path / "v2", settings, edit_manifest=lambda m: m.update(contract="ll.derived-manifest/2")), "manifest_invalid")
    assert_rejected(derived, journal, write_root(tmp_path / "reviewed", settings, edit_manifest=lambda m: m.update(review_state="confirmed")), "manifest_invalid")
    assert_rejected(derived, journal, write_root(tmp_path / "future", settings, edit_manifest=lambda m: m.update(consumer_version="derived-consumer-9")), "unsupported_consumer_version")
    # The command names the course; a manifest written for another course is not silently filed under this one.
    assert_rejected(derived, journal, write_root(tmp_path / "other-course", settings, edit_manifest=lambda m: m.update(course_id="be562")), "course_mismatch")
    result = derived.import_generation(write_root(tmp_path / "ok", settings), course_id="not-a-course")
    assert (result["status"], result["reason"]) == ("rejected", "unknown_course") and stored_files(derived) == []


def _link_directory(link: Path, target: Path) -> bool:
    """A directory link that needs no privilege: a junction on Windows, a symlink elsewhere."""
    import os
    import subprocess
    import sys

    if sys.platform == "win32":
        return subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True).returncode == 0
    os.symlink(target, link, target_is_directory=True)
    return True


def test_no_manifest_path_can_leave_the_selected_root(settings, derived, journal, tmp_path):
    """The manifest is data. A path in it is followed only when it is a plain relative path to a plain file inside the root."""
    secret = tmp_path / "outside" / "secret.json"
    secret.parent.mkdir()
    secret.write_bytes(b'{"private": "OUTSIDE-BYTES"}')
    outside = c.artifact_for_bytes(secret.read_bytes(), "x", "application/json")
    for number, bad in enumerate(["../outside/secret.json", "/outside/secret.json", secret.as_posix(), "C:/outside/secret.json", "sub\\secret.json", "sub/../../outside/secret.json", "NUL.json", "notes ./x.json"]):
        root = write_root(tmp_path / f"path-{number}", settings, edit_manifest=lambda m, bad=bad: m["outputs"].append(dict(outside, path=bad)))
        assert_rejected(derived, journal, root, "unsafe_path")
    # A folder inside the root that is really a link to somewhere else.
    linked = write_root(tmp_path / "linked", settings, edit_manifest=lambda m: m["outputs"].append(dict(outside, path="more/secret.json")))
    assert _link_directory(linked / "more", secret.parent), "could not create a directory link on this machine"
    assert_rejected(derived, journal, linked, "unsafe_path")
    # The selected root itself must be a real folder, not a link to one.
    real = write_root(tmp_path / "real", settings)
    assert _link_directory(tmp_path / "root-link", real)
    assert_rejected(derived, journal, tmp_path / "root-link", "root_is_link")
    # Outputs are listed once, never under the manifest's own name, and the segments file is one of them.
    twice = write_root(tmp_path / "twice", settings, edit_manifest=lambda m: m["outputs"].append(dict(m["outputs"][0], path="SEGMENTS.json")))
    assert_rejected(derived, journal, twice, "duplicate_output")
    own_name = write_root(tmp_path / "own-name", settings, edit_manifest=lambda m: m["outputs"].append(dict(outside, path="Manifest.json")))
    assert_rejected(derived, journal, own_name, "duplicate_output")
    unlisted = write_root(tmp_path / "unlisted", settings, edit_manifest=lambda m: m.update(segments_path="other.json"))
    assert_rejected(derived, journal, unlisted, "segments_not_listed")
    # Ids become folder names in the store: one that is not a portable folder name is refused, never rewritten.
    assert_rejected(derived, journal, write_root(tmp_path / "reserved", settings, generation="con"), "unsafe_path")
    assert_rejected(derived, journal, write_root(tmp_path / "dotted", settings, generation="gen-1."), "unsafe_path")
    assert "OUTSIDE-BYTES" not in json.dumps(journal.receipts(kind="derived-import"))
    # The app's own folders and the course folders are not output roots.
    inside_course = write_root(settings.course("be505").root / "materials" / "sessions" / "asr-out", settings)
    assert_rejected(derived, journal, inside_course, "root_inside_course")
    assert_rejected(derived, journal, write_root(settings.state_dir / "asr-out", settings), "root_inside_app")


def test_a_file_symlink_inside_the_root_is_not_followed(settings, derived, journal, tmp_path):
    secret = tmp_path / "secret.json"
    secret.write_bytes(b'{"private": "OUTSIDE-BYTES"}')
    root = write_root(tmp_path / "out", settings, edit_manifest=lambda m: m["outputs"].append(c.artifact_for_bytes(secret.read_bytes(), "linked.json", "application/json")))
    try:
        (root / "linked.json").symlink_to(secret)
    except OSError:
        pytest.skip("This machine does not allow creating a file symlink without elevation; the directory-link case is covered above.")
    assert_rejected(derived, journal, root, "unsafe_path")
    # The manifest itself is read as a plain file too.
    moved = write_root(tmp_path / "moved", settings)
    (tmp_path / "manifest-elsewhere.json").write_bytes((moved / "manifest.json").read_bytes())
    (moved / "manifest.json").unlink()
    (moved / "manifest.json").symlink_to(tmp_path / "manifest-elsewhere.json")
    assert_rejected(derived, journal, moved, "unsafe_path")


def test_declared_bytes_types_and_size_caps_are_enforced_before_anything_is_copied(settings, derived, journal, tmp_path, monkeypatch):
    missing = write_root(tmp_path / "missing", settings)
    (missing / "segments.json").unlink()
    assert_rejected(derived, journal, missing, "output_missing")
    longer = write_root(tmp_path / "longer", settings)
    (longer / "segments.json").write_bytes((longer / "segments.json").read_bytes() + b" ")
    assert_rejected(derived, journal, longer, "output_size_mismatch")
    changed = write_root(tmp_path / "changed", settings)
    (changed / "segments.json").write_bytes((changed / "segments.json").read_bytes().replace(b"sentence 1", b"sentence 9"))
    assert_rejected(derived, journal, changed, "output_digest_mismatch")
    a_folder = write_root(tmp_path / "folder", settings, edit_manifest=lambda m: m["outputs"].append(c.artifact_for_bytes(b"x", "notes", "text/plain")))
    (a_folder / "notes").mkdir()
    assert_rejected(derived, journal, a_folder, "output_missing")
    # Types: timed text and plain notes only. Nothing from a root is ever run, and nothing that looks runnable is kept.
    program = write_root(tmp_path / "program", settings, extra_files={"tool.exe": (b"MZ-not-a-program", "application/vnd.microsoft.portable-executable")})
    assert_rejected(derived, journal, program, "unsupported_media_type")
    mislabeled = write_root(tmp_path / "mislabeled", settings, edit_manifest=lambda m: m["outputs"][0].update(media_type="text/plain"))
    assert_rejected(derived, journal, mislabeled, "unsupported_media_type")  # the segments file is JSON
    # Size caps, per file and in total.
    monkeypatch.setattr(d, "MAX_OUTPUT_BYTES", 200)
    assert_rejected(derived, journal, write_root(tmp_path / "big", settings), "output_too_large")
    monkeypatch.setattr(d, "MAX_OUTPUT_BYTES", 32 * 1024 * 1024)
    monkeypatch.setattr(d, "MAX_TOTAL_BYTES", 1200)
    assert_rejected(derived, journal, write_root(tmp_path / "total", settings, extra_files={"log.txt": (b"n" * 1000, "text/plain")}), "output_too_large")
    monkeypatch.setattr(d, "MAX_TOTAL_BYTES", 64 * 1024 * 1024)
    # With the caps restored, a root with an extra plain-text output is accepted and both files are kept.
    result = derived.import_generation(write_root(tmp_path / "with-log", settings, extra_files={"logs/run.txt": (b"synthetic run log\n", "text/plain")}), course_id="be505")
    assert result["status"] == "imported" and result["files"] == 2
    assert stored_files(derived) == [f"{recording(settings)['source_id']}/gen-0001/{name}" for name in ("logs/run.txt", "manifest.json", "segments.json")]


def test_segment_times_are_clip_relative_bounded_by_the_window_and_the_offset_is_applied_once(settings, derived, journal, tmp_path, monkeypatch):
    """The recording is 60 s. Times in the file are relative to the clip; the manifest says where the clip starts."""
    def seg(start, end, **more):
        return {"index": more.pop("index", 0), "clip_start_ms": start, "clip_end_ms": end, "text": "Synthetic generated sentence.", **more}

    def root(name, **kwargs):
        return write_root(tmp_path / name, settings, **kwargs)

    # The segments file must belong to this manifest and be a valid generated-text document.
    assert_rejected(derived, journal, root("s-unknown", edit_segments=lambda s: s["segments"][0].update(slide_page=3)), "segments_invalid")
    assert_rejected(derived, journal, root("s-reviewed", edit_segments=lambda s: s.update(review_state="confirmed")), "segments_invalid")
    assert_rejected(derived, journal, root("s-other-gen", edit_segments=lambda s: s.update(generation="gen-9999")), "segments_mismatch")
    assert_rejected(derived, journal, root("s-other-src", edit_segments=lambda s: s.update(source_id="src-lecture-01-slides")), "segments_mismatch")
    not_json = root("s-not-json")
    garbage = b"WEBVTT\n\n00:00.000 --> 00:05.000\nnot the declared JSON\n"
    (not_json / "segments.json").write_bytes(garbage)
    manifest = json.loads((not_json / "manifest.json").read_text(encoding="utf-8"))
    manifest["outputs"] = [c.artifact_for_bytes(garbage, "segments.json", "application/json")]
    (not_json / "manifest.json").write_bytes(c.dump_json(manifest))
    assert_rejected(derived, journal, not_json, "segments_invalid")
    # Time base: the two files agree on the offset, and the clip cannot start after the window it claims to cover.
    assert_rejected(derived, journal, root("t-offset", window=(10_000, 30_000), edit_segments=lambda s: s.update(clip_offset_ms=0)), "time_base_mismatch")
    assert_rejected(derived, journal, root("t-late-clip", window=(10_000, 30_000), offset=12_000), "time_base_mismatch")
    # Bounds.
    assert_rejected(derived, journal, root("b-empty", segments=[seg(5_000, 5_000)]), "time_out_of_bounds")
    assert_rejected(derived, journal, root("b-reversed", segments=[seg(6_000, 5_000)]), "time_out_of_bounds")
    assert_rejected(derived, journal, root("b-after-window", window=(10_000, 30_000), segments=[seg(0, 5_000), seg(19_000, 21_000, index=1)]), "time_out_of_bounds")
    # Already-absolute times written into clip fields land outside the window once the offset is added: refused, not shifted twice.
    assert_rejected(derived, journal, root("b-absolute-in-clip-fields", window=(10_000, 30_000), segments=[seg(10_000, 15_000), seg(15_000, 30_000, index=1)]), "time_out_of_bounds")
    assert_rejected(derived, journal, root("b-word", segments=[seg(0, 5_000, words=[{"clip_start_ms": 25_000, "clip_end_ms": 26_000, "text": "late"}])]), "time_out_of_bounds")
    assert_rejected(derived, journal, root("b-word-reversed", segments=[seg(0, 5_000, words=[{"clip_start_ms": 900, "clip_end_ms": 100, "text": "back"}])]), "time_out_of_bounds")
    assert_rejected(derived, journal, root("b-order", segments=[seg(5_000, 9_000), seg(0, 4_000, index=1)]), "segments_out_of_order")
    assert_rejected(derived, journal, root("b-index", segments=[seg(0, 4_000, index=3), seg(5_000, 9_000, index=3)]), "segments_out_of_order")
    assert_rejected(derived, journal, root("w-empty", window=(20_000, 20_000)), "time_out_of_bounds")
    assert_rejected(derived, journal, root("w-past-end", window=(0, 61_000)), "window_exceeds_duration")  # 1 s past a 60 s recording
    assert_rejected(derived, journal, root("w-wrong-duration", duration_ms=600_000), "duration_mismatch")  # the file itself is 60 s
    # A file that also states recording-absolute times must agree with clip time + offset exactly.
    assert_rejected(derived, journal, root("a-wrong", window=(10_000, 30_000), segments=[seg(0, 5_000, start_ms=0, end_ms=5_000)]), "absolute_time_mismatch")
    assert_rejected(derived, journal, root("a-twice", window=(10_000, 30_000), segments=[seg(0, 5_000, start_ms=20_000, end_ms=25_000)]), "absolute_time_mismatch")
    assert_rejected(derived, journal, root("a-word", window=(10_000, 30_000),
                                           segments=[seg(0, 5_000, words=[{"clip_start_ms": 0, "clip_end_ms": 400, "start_ms": 0, "end_ms": 400, "text": "w"}])]), "absolute_time_mismatch")
    # Count cap.
    monkeypatch.setattr(d, "MAX_SEGMENTS", 3)
    assert_rejected(derived, journal, root("c-many"), "too_many_segments")  # the default synthetic root has four
    monkeypatch.setattr(d, "MAX_SEGMENTS", 20_000)
    monkeypatch.setattr(d, "MAX_WORDS", 1)
    assert_rejected(derived, journal, root("c-words"), "too_many_words")
    monkeypatch.setattr(d, "MAX_WORDS", 400_000)
    assert stored_files(derived) == []

    # Accepted: consistent absolute claims, an end within the tolerance of the recording's end, a zero-length word.
    ok = root("ok", generation="gen-ok", window=(40_000, 60_400),
              segments=[seg(0, 5_000, start_ms=40_000, end_ms=45_000, words=[{"clip_start_ms": 100, "clip_end_ms": 100, "start_ms": 40_100, "end_ms": 40_100, "text": "uh"}]),
                        seg(5_000, 20_400, index=1)])
    assert derived.import_generation(ok, course_id="be505")["status"] == "imported"
    current = derived.current("be505", recording(settings)["source_id"])
    assert [(s["start_ms"], s["end_ms"]) for s in current["segments"]] == [(40_000, 45_000), (45_000, 60_400)]
    assert current["segments"][0]["words"] == [{"start_ms": 40_100, "end_ms": 40_100, "text": "uh"}]


def refingerprint(manifest: dict) -> None:
    manifest["input_fingerprint"] = d.fingerprint_of(manifest)


def test_a_result_is_accepted_only_for_the_recording_as_the_app_identifies_it_now(settings, derived, journal, tmp_path):
    def root(name, edit, **kwargs):
        return write_root(tmp_path / name, settings, edit_manifest=lambda m: (edit(m), refingerprint(m)), **kwargs)

    assert_rejected(derived, journal, root("unknown", lambda m: m["recording"].update(source_id="src-never-listed")), "unknown_source")
    slides = next(i for l in build_inventory(settings.course("be505"))["lectures"] for i in l["decks"])
    assert_rejected(derived, journal, write_root(tmp_path / "slides", settings, item=slides, duration_ms=None), "not_a_recording")
    transcript = next(i for s in build_inventory(settings.course("be505"))["sessions"] for i in s["items"] if i["kind"] == "lecture_transcript")
    assert_rejected(derived, journal, write_root(tmp_path / "transcript", settings, item=transcript, duration_ms=None), "not_a_recording")
    assert_rejected(derived, journal, root("other-bytes", lambda m: m["recording"].update(sha256="e" * 64)), "changed_input")
    assert_rejected(derived, journal, root("other-size", lambda m: m["recording"].update(bytes=m["recording"]["bytes"] + 1)), "changed_input")
    # The fingerprint binds recording, window, offset, producer and consumer version: editing one without it is caught.
    for number, edit in enumerate([lambda m: m["producer"].update(model="another-model"), lambda m: m["window"].update(end_ms=19_000),
                                   lambda m: m["producer"].update(parameters_sha256="f" * 64), lambda m: m.update(input_fingerprint="0" * 64)]):
        assert_rejected(derived, journal, write_root(tmp_path / f"fp-{number}", settings, edit_manifest=edit), "fingerprint_mismatch")
    assert stored_files(derived) == []


def test_a_result_made_before_the_recording_changed_is_refused_as_changed_input(settings, derived, journal, tmp_path):
    from lecture_brain.fixtures.builder import write_wav

    item = recording(settings, registered=False)  # identified by its own bytes
    root = write_root(tmp_path / "before-change", settings, item=item)
    write_wav(settings.course("be505").root / item["path"], [(0, 30)])  # the session's recording is replaced by different audio
    assert_rejected(derived, journal, root, "changed_input")
    # A recording that is listed but cannot be opened is not a target either.
    gone = recording(settings)
    stale_root = write_root(tmp_path / "gone", settings, item=gone)
    (settings.course("be505").root / gone["path"]).unlink()
    assert_rejected(derived, journal, stale_root, "source_unavailable")


# ---- immutable generations --------------------------------------------------------------------------------------------
def private_files(settings) -> dict[str, str]:
    """Everything in the app's private state except the journal database itself."""
    return {name: digest for name, digest in tree(settings.state_dir).items() if not name.startswith("journal.sqlite")}


def test_importing_the_same_generation_again_writes_one_no_change_receipt_and_nothing_else(settings, derived, journal, tmp_path):
    import shutil

    root = write_root(tmp_path / "out", settings)
    first = derived.import_generation(root, course_id="be505")
    assert first["status"] == "imported"
    store = derived.store_dir("be505")
    course_before, private_before = tree(settings.course("be505").root), private_files(settings)
    written_at = {p: p.stat().st_mtime_ns for p in store.rglob("*") if p.is_file()}
    receipts_before = {r["receipt_id"] for r in journal.receipts()}

    second = derived.import_generation(root, course_id="be505")

    assert second["status"] == "reused" and second["reused"] is True and second["reason"] is None
    assert second["manifest_sha256"] == first["manifest_sha256"] and second["generation"] == "gen-0001"
    assert tree(settings.course("be505").root) == course_before and private_files(settings) == private_before
    assert {p: p.stat().st_mtime_ns for p in store.rglob("*") if p.is_file()} == written_at  # not rewritten, not touched
    new = [r for r in journal.receipts() if r["receipt_id"] not in receipts_before]
    assert [(r["kind"], r["payload"]["outcome"], r["payload"]["generation"]) for r in new] == [("derived-import", "no_change", "gen-0001")]
    assert journal.counts()["jobs"] == 0 and journal.events()[-1]["kind"] == "receipt"  # no job, no queue entry: a receipt only
    # The same bytes offered from another folder are the same generation.
    shutil.copytree(root, tmp_path / "out-copy")
    assert derived.import_generation(tmp_path / "out-copy", course_id="be505")["status"] == "reused"


def test_a_stored_generation_is_never_replaced_and_older_generations_are_kept(settings, derived, journal, tmp_path):
    item = recording(settings)
    first = write_root(tmp_path / "g1", settings, generation="gen-0001", created_at="2026-10-05T08:00:00Z", window=(0, 20_000))
    assert derived.import_generation(first, course_id="be505")["status"] == "imported"
    stored_before = tree(derived.store_dir("be505"))
    # The same generation id with other bytes is a conflict, whichever file differs.
    other_text = write_root(tmp_path / "g1-other", settings, generation="gen-0001", created_at="2026-10-05T08:00:00Z", window=(0, 20_000),
                            edit_segments=lambda s: s["segments"][0].update(text="A different generated sentence."))
    assert_rejected(derived, journal, other_text, "generation_conflict")
    other_time = write_root(tmp_path / "g1-later", settings, generation="gen-0001", created_at="2026-10-05T09:00:00Z", window=(0, 20_000))
    assert_rejected(derived, journal, other_time, "generation_conflict")
    assert tree(derived.store_dir("be505")) == stored_before
    # A new generation is stored beside the old one; the old one stays on disk and is no longer the one served.
    second = write_root(tmp_path / "g2", settings, generation="gen-0002", created_at="2026-10-05T20:00:00Z", window=(0, 60_000))
    assert derived.import_generation(second, course_id="be505")["status"] == "imported"
    after = tree(derived.store_dir("be505"))
    assert {name: digest for name, digest in after.items() if "/gen-0001/" in name} == stored_before and len(after) == 2 * len(stored_before)
    current = derived.current("be505", item["source_id"])
    assert current["generation"] == "gen-0002" and current["covers_whole_recording"] is True and current["coverage_fraction"] == pytest.approx(1.0)
    listed = {g["generation"]: g["state"] for r in derived.status("be505")["recordings"] if r["source_id"] == item["source_id"] for g in r["generations"]}
    assert listed == {"gen-0001": "superseded", "gen-0002": "current"}


def test_a_copy_that_does_not_read_back_exactly_never_gets_a_manifest(settings, derived, journal, tmp_path, monkeypatch):
    """Outputs are written first and read back; the manifest is written only after they verify. A generation without a
    manifest does not exist for any reader, and the next import replaces the leftovers."""
    item = recording(settings)
    root = write_root(tmp_path / "out", settings)
    real = d.replace_atomic
    monkeypatch.setattr(d, "replace_atomic", lambda path, data: real(path, data[:-1] + b"!"))  # a disk that stores one wrong byte
    result = derived.import_generation(root, course_id="be505")
    assert (result["status"], result["reason"]) == ("rejected", "store_verify_failed")
    destination = derived.store_dir("be505") / item["source_id"] / "gen-0001"
    assert destination.is_dir() and not (destination / "manifest.json").exists()
    assert derived.current("be505", item["source_id"]) is None
    assert [g["state"] for r in derived.status("be505")["recordings"] if r["source_id"] == item["source_id"] for g in r["generations"]] == ["incomplete"]
    monkeypatch.setattr(d, "replace_atomic", real)
    assert derived.import_generation(root, course_id="be505")["status"] == "imported"
    assert tree(destination) == tree(root) and derived.current("be505", item["source_id"])["generation"] == "gen-0001"
    # A stored generation that was damaged afterwards is not served and is not silently repaired.
    (destination / "segments.json").write_bytes(b"{}")
    assert derived.current("be505", item["source_id"]) is None
    assert_rejected(derived, journal, root, "stored_generation_damaged")
    assert [g["state"] for r in derived.status("be505")["recordings"] if r["source_id"] == item["source_id"] for g in r["generations"]] == ["invalid"]


# ---- source-version invalidation --------------------------------------------------------------------------------------
def states(derived, source_id, course="be505") -> dict[str, str]:
    return {g["generation"]: g["state"] for r in derived.status(course)["recordings"] if r["source_id"] == source_id for g in r["generations"]}


def republish_recording(course_root: Path, source_id: str, seconds: int) -> None:
    """Replace a registered synthetic recording and publish the new version the way the course's publisher would:
    new bytes, a new current version in the index, and the pinned digest of the index."""
    from lecture_brain.fixtures.builder import _version, write_wav

    index_path = course_root / ".agent" / "source-index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    entry = next(s for s in index["sources"] if s["source_id"] == source_id)
    write_wav(course_root / entry["current_path"], [(0, seconds)])
    version = _version(course_root / entry["current_path"], "not_needed")
    entry["versions"].append(version)
    entry["current_version_id"] = version["version_id"]
    data = json.dumps(index, indent=2).encode("utf-8")
    index_path.write_bytes(data)
    marker_path = course_root / ".agent" / "course-tracking" / "publication.json"
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    marker["files"][".agent/source-index.json"] = hashlib.sha256(data).hexdigest()
    marker_path.write_text(json.dumps(marker, indent=2), encoding="utf-8")


@pytest.mark.parametrize("registered", [False, True], ids=["identified-by-its-bytes", "registered-in-the-course-index"])
def test_a_generation_for_older_recording_bytes_is_kept_reported_stale_and_not_served(settings, derived, journal, tmp_path, registered):
    from lecture_brain.fixtures.builder import write_wav

    item = recording(settings, registered=registered)
    source_id = item["source_id"]
    old_root = write_root(tmp_path / "old", settings, item=item, generation="gen-old", created_at="2026-10-05T08:00:00Z")
    assert derived.import_generation(old_root, course_id="be505")["status"] == "imported"
    assert derived.current("be505", source_id)["generation"] == "gen-old"
    stored_before = tree(derived.store_dir("be505"))
    old_sha = derived.current("be505", source_id)["recording"]["sha256"]

    # The recording itself changes (a re-upload, a trimmed file): what was generated from the old bytes no longer applies.
    if registered:
        republish_recording(settings.course("be505").root, source_id, seconds=30)
    else:
        write_wav(settings.course("be505").root / item["path"], [(0, 30)])
    fresh = Derived(settings, journal, now=lambda: NOW)  # as after a restart: nothing remembered in memory decides this
    assert fresh.current("be505", source_id) is None
    row = next(r for r in fresh.status("be505")["recordings"] if r["source_id"] == source_id)
    assert row["sha256"] != old_sha and row["current_generation"] is None and row["duration_ms"] == 30_000
    assert [(g["generation"], g["state"], g["recording_sha256"]) for g in row["generations"]] == [("gen-old", "stale", old_sha)]
    assert tree(fresh.store_dir("be505")) == stored_before  # kept on disk, byte for byte
    assert_rejected(fresh, journal, old_root, "changed_input")  # offering the old result again is not a "no change"

    # A generation made from the new bytes is served; the stale one stays where it was.
    new_item = recording(settings, registered=registered)
    assert new_item["source_id"] == source_id
    new_root = write_root(tmp_path / "new", settings, item=new_item, generation="gen-new", created_at="2026-10-05T07:00:00Z", window=(0, 30_000))
    assert fresh.import_generation(new_root, course_id="be505")["status"] == "imported"
    assert fresh.current("be505", source_id)["generation"] == "gen-new"  # current bytes decide, not the later timestamp of the stale one
    assert states(fresh, source_id) == {"gen-new": "current", "gen-old": "stale"}
    assert {name: digest for name, digest in tree(fresh.store_dir("be505")).items() if "/gen-old/" in name} == stored_before


# ---- cancellation and failed writes -----------------------------------------------------------------------------------
def test_a_stop_between_copy_steps_leaves_no_manifest_and_the_import_can_be_retried(settings, derived, journal, tmp_path, monkeypatch):
    item = recording(settings)
    root = write_root(tmp_path / "out", settings, extra_files={"logs/run.txt": (b"synthetic run log\n", "text/plain")})  # two outputs to copy
    destination = derived.store_dir("be505") / item["source_id"] / "gen-0001"
    stop_file = settings.state_dir / d.STOP_FILE
    real = d.replace_atomic

    def copy_then_stop(path, data):
        real(path, data)
        stop_file.write_text("stop requested while the first output was being copied", encoding="utf-8")

    monkeypatch.setattr(d, "replace_atomic", copy_then_stop)
    result = derived.import_generation(root, course_id="be505")
    assert (result["status"], result["reason"], result["reused"]) == ("cancelled", "cancelled", False)
    assert len([p for p in destination.rglob("*") if p.is_file()]) == 1 and not (destination / "manifest.json").exists()  # one output copied, then stopped
    assert derived.current("be505", item["source_id"]) is None and states(derived, item["source_id"]) == {"gen-0001": "incomplete"}
    receipt = next(r for r in journal.receipts(kind="derived-import") if r["receipt_id"] == result["receipt_id"])
    assert receipt["payload"]["outcome"] == "cancelled"
    # While the stop file is present nothing is started at all.
    monkeypatch.setattr(d, "replace_atomic", real)
    partial = tree(destination)
    assert derived.import_generation(root, course_id="be505")["status"] == "cancelled" and tree(destination) == partial
    # Removing it lets the same root be imported; the leftovers are replaced by the complete generation.
    stop_file.unlink()
    assert derived.import_generation(root, course_id="be505")["status"] == "imported"
    assert tree(destination) == tree(root) and derived.current("be505", item["source_id"])["generation"] == "gen-0001"


def test_a_caller_supplied_cancel_check_is_observed_before_the_manifest_is_written(settings, journal, tmp_path):
    item = recording(settings)
    root = write_root(tmp_path / "out", settings)
    asked = []

    def cancel() -> bool:
        asked.append(len(asked))
        return len(asked) >= 3  # not at the start, not before the single output: only at the last check, just before the manifest

    stoppable = Derived(settings, journal, now=lambda: NOW, cancel=cancel)
    result = stoppable.import_generation(root, course_id="be505")
    destination = stoppable.store_dir("be505") / item["source_id"] / "gen-0001"
    assert result["status"] == "cancelled" and len(asked) == 3
    assert (destination / "segments.json").is_file() and not (destination / "manifest.json").exists()
    assert Derived(settings, journal, now=lambda: NOW).import_generation(root, course_id="be505")["status"] == "imported"


def test_a_failed_write_is_a_refusal_with_a_receipt_not_a_half_visible_generation(settings, derived, journal, tmp_path, monkeypatch):
    item = recording(settings)
    root = write_root(tmp_path / "out", settings)

    def no_space(path, data):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(d, "replace_atomic", no_space)
    result = derived.import_generation(root, course_id="be505")
    assert (result["status"], result["reason"]) == ("rejected", "store_write_failed")
    assert derived.current("be505", item["source_id"]) is None and stored_files(derived) == []
    assert next(r for r in journal.receipts(kind="derived-import") if r["receipt_id"] == result["receipt_id"])["payload"]["reason"] == "store_write_failed"


# ---- cold backlog -----------------------------------------------------------------------------------------------------
def backlog_roots(settings, base: Path) -> list[Path]:
    """Five finished output roots waiting to be imported: several windows of two synthetic recordings."""
    first, second = recording(settings), recording(settings, registered=False)
    plan = [(first, "gen-a", (0, 20_000)), (first, "gen-b", (20_000, 40_000)), (first, "gen-c", (40_000, 60_000)), (second, "gen-d", (0, 20_000)), (second, "gen-e", (20_000, 45_000))]
    return [write_root(base / item["source_id"] / generation, settings, item=item, generation=generation, window=window, created_at=f"2026-10-05T0{n}:00:00Z")
            for n, (item, generation, window) in enumerate(plan, start=1)]


def test_a_cold_backlog_is_drained_in_bounded_calls_and_a_finished_backlog_is_all_no_change(settings, derived, journal, tmp_path):
    roots = backlog_roots(settings, tmp_path / "asr-out")
    broken = write_root(tmp_path / "asr-out" / "broken", settings, generation="gen-x", write_manifest=False)  # an unfinished root in the same folder
    offered = [roots[0], roots[1], broken, *roots[2:]]

    first = derived.import_backlog(offered, course_id="be505", max_imports=2)
    assert first["counts"] == {"imported": 2, "reused": 0, "rejected": 0, "cancelled": 0} and first["complete"] is False
    assert first["remaining"] == [str(p) for p in offered[2:]] and len(first["results"]) == 2  # the bound was reached: the rest was not looked at
    assert len(stored_files(derived)) == 4  # two generations: a manifest and a segments file each

    second = derived.import_backlog(offered, course_id="be505", max_imports=2)
    # What is already stored costs nothing and does not use up the bound; an unfinished root is skipped with its reason and blocks nothing.
    assert second["counts"] == {"imported": 2, "reused": 2, "rejected": 1, "cancelled": 0} and second["remaining"] == [str(roots[4])]
    assert [(r["status"], r["reason"]) for r in second["results"]] == [("reused", None), ("reused", None), ("rejected", "incomplete"), ("imported", None), ("imported", None)]

    third = derived.import_backlog(offered, course_id="be505", max_imports=2)
    assert third["counts"] == {"imported": 1, "reused": 4, "rejected": 1, "cancelled": 0} and third["remaining"] == [] and third["complete"] is True
    assert len(stored_files(derived)) == 10
    assert states(derived, recording(settings)["source_id"]) == {"gen-a": "superseded", "gen-b": "superseded", "gen-c": "current"}

    # A further run over the finished backlog: one "no change" receipt per stored generation, the same refusal, and nothing else.
    course_before, private_before = tree(settings.course("be505").root), private_files(settings)
    receipts_before = {r["receipt_id"] for r in journal.receipts()}
    fourth = derived.import_backlog(offered, course_id="be505", max_imports=2)
    assert fourth["counts"] == {"imported": 0, "reused": 5, "rejected": 1, "cancelled": 0} and fourth["complete"] is True
    new = [r for r in journal.receipts() if r["receipt_id"] not in receipts_before]
    assert sorted(r["payload"]["outcome"] for r in new) == ["no_change"] * 5 + ["rejected"] and {r["kind"] for r in new} == {"derived-import"}
    assert tree(settings.course("be505").root) == course_before and private_files(settings) == private_before and journal.counts()["jobs"] == 0


def test_a_backlog_call_stops_at_a_stop_request_and_reports_what_is_left(settings, journal, tmp_path):
    roots = backlog_roots(settings, tmp_path / "asr-out")
    imported = []
    stoppable = Derived(settings, journal, now=lambda: NOW, cancel=lambda: bool(imported))  # a stop is requested once the first import has finished
    real = stoppable.import_generation

    def counted(root, *, course_id):
        result = real(root, course_id=course_id)
        if result["status"] == "imported":
            imported.append(result["generation"])
        return result

    stoppable.import_generation = counted
    report = stoppable.import_backlog(roots, course_id="be505", max_imports=8)
    assert report["counts"]["imported"] == 1 and report["counts"]["cancelled"] == 1 and report["complete"] is False
    assert report["remaining"] == [str(p) for p in roots[1:]]  # the stopped root is still to do
    assert Derived(settings, journal, now=lambda: NOW).import_backlog(roots, course_id="be505", max_imports=8)["counts"] == {"imported": 4, "reused": 1, "rejected": 0, "cancelled": 0}


# ---- where things are written -----------------------------------------------------------------------------------------
def test_with_real_course_folders_the_importer_writes_only_into_the_private_app_area_and_keeps_its_own_receipt(workspace, tmp_path):
    """The read-only profile used for real course folders: after an import the course and planner folders are
    byte-identical; the generation is in the private shadow area; and a caller that passes no journal still leaves
    the receipt in the app's one journal."""
    from lecture_brain.config import load_settings

    settings = load_settings("local", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "private-state")
    item = recording(settings)
    before = {cid: tree(binding.root) for cid, binding in settings.courses.items()}
    planner_before = tree(settings.planner_root)
    root = write_root(tmp_path / "asr-out" / "gen-0001", settings)

    consumer = Derived(settings)
    result = consumer.import_generation(root, course_id="be505")

    assert result["status"] == "imported" and result["receipt_id"]
    assert {cid: tree(binding.root) for cid, binding in settings.courses.items()} == before and tree(settings.planner_root) == planner_before
    store = consumer.store_dir("be505")
    assert store.is_relative_to(tmp_path / "private-state") and not store.is_relative_to(settings.course("be505").root)
    assert tree(store / item["source_id"] / "gen-0001") == tree(root)
    assert consumer.current("be505", item["source_id"])["generation"] == "gen-0001"
    opened = Journal.open(settings.journal_path, synced_roots=settings.synced_roots)
    try:
        assert [(r["receipt_id"], r["payload"]["outcome"]) for r in opened.receipts(kind="derived-import")] == [(result["receipt_id"], "imported")]
        assert opened.counts()["jobs"] == 0
    finally:
        opened.close()


# ---- the source-refresh path is not an audio worker -------------------------------------------------------------------
def test_source_refresh_and_the_supervisor_never_import_or_produce_speech_timing(settings, clock, tmp_path, monkeypatch):
    """Existing refresh: updater receipt -> inventory/preparation job -> supervisor round. A finished output root lies
    ready the whole time and the importer is booby-trapped; nothing on that path may reach it."""
    import subprocess
    import sys

    from lecture_brain.journal import JobState
    from lecture_brain.runtime import Runtime
    from lecture_brain.updater import consume_receipts

    # The refresh module does not even load this one.
    loaded = subprocess.run([sys.executable, "-c", "import sys, lecture_brain.updater; print('lecture_brain.derived' in sys.modules)"], capture_output=True, text=True, check=True)
    assert loaded.stdout.strip() == "False"

    write_root(tmp_path / "asr-out" / "gen-0001", settings)

    def trap(*args, **kwargs):
        raise AssertionError("the source-refresh path reached the derived-timing importer")

    for name in ("import_generation", "import_backlog"):
        monkeypatch.setattr(Derived, name, trap)
    runtime = Runtime(settings, clock=clock)
    try:
        started = runtime.startup()
        assert started["updater"]["queued"] == len(settings.courses)
        for _ in range(8):
            runtime.tick()
            consume_receipts(settings, runtime.journal)
        jobs = runtime.journal.jobs()
        assert jobs and {(j["workflow"], j["detail"]["kind"]) for j in jobs} == {("WF02", "inventory-refresh")}
        assert all(j["state"] == JobState.SUCCEEDED for j in jobs)  # the refresh work itself ran to the end
        assert not [kind for kind in runtime.coordinator.internal_handlers if "derived" in kind or "speech" in kind or "audio" in kind]
        assert runtime.journal.receipts(kind="derived-import") == []
        assert not any((settings.app_area(course_id) / "derived").exists() for course_id in settings.courses)
    finally:
        runtime.journal.close()


# ---- command line -----------------------------------------------------------------------------------------------------
def test_the_private_commands_import_selected_roots_and_read_the_status_back(workspace, settings, tmp_path, monkeypatch, capsys):
    from lecture_brain import cli

    monkeypatch.setenv("LL_FIXTURE_ROOT", str(workspace))  # the command line's fixture profile uses this test's synthetic workspace
    base = ["--profile", "fixture", "--state-dir", str(settings.state_dir)]
    item = recording(settings)
    root = write_root(tmp_path / "asr-out" / "gen-0001", settings, window=(0, 20_000))
    unfinished = write_root(tmp_path / "asr-out" / "gen-0002", settings, generation="gen-0002", write_manifest=False)

    def run(*args):
        code = cli.main([*base, *args])
        return code, json.loads(capsys.readouterr().out)

    code, report = run("import-derived", "--course", "be505", "--root", str(root))
    assert code == 0 and report["counts"] == {"imported": 1, "reused": 0, "rejected": 0, "cancelled": 0} and report["complete"] is True
    assert report["results"][0]["generation"] == "gen-0001" and report["results"][0]["receipt_id"]

    code, status = run("derived-status", "--course", "be505")
    row = next(r for r in status["recordings"] if r["source_id"] == item["source_id"])
    assert code == 0 and status["consumer_version"] == d.CONSUMER_VERSION and status["manifest_contract"] == "ll.derived-manifest/1"
    assert row["current_generation"] == "gen-0001" and row["covers_whole_recording"] is False and row["coverage_fraction"] == pytest.approx(1 / 3)
    assert row["bytes"] == item["bytes"] and row["sha256"] == Preparation(settings, converter=None).identity_of("be505", item)[1] and row["path"] == item["path"]
    assert [(g["generation"], g["state"], g["input_fingerprint"]) for g in row["generations"]] == [("gen-0001", "current", report["results"][0]["input_fingerprint"])]
    assert {r["source_id"]: r["current_generation"] for r in status["recordings"]} == {item["source_id"]: "gen-0001", recording(settings, registered=False)["source_id"]: None}
    assert status["totals"]["recordings"] == 2 and status["totals"]["with_current_generation"] == 1 and status["totals"]["whole_recording_covered"] == 0
    assert "current" not in status  # the generated text itself is printed only when one recording is asked for

    code, one = run("derived-status", "--course", "be505", "--source", item["source_id"], "--segments")
    assert code == 0 and [r["source_id"] for r in one["recordings"]] == [item["source_id"]]
    assert one["current"]["generation"] == "gen-0001" and one["current"]["review_state"] == "generated_unreviewed"
    assert [(s["start_ms"], s["end_ms"]) for s in one["current"]["segments"]] == [(0, 5_000), (5_000, 10_000), (10_000, 15_000), (15_000, 20_000)]
    code, brief = run("derived-status", "--course", "be505", "--source", item["source_id"])
    assert "segments" not in brief["current"] and brief["current"]["segment_count"] == 4

    code, again = run("import-derived", "--course", "be505", "--root", str(root))
    assert code == 0 and again["counts"]["reused"] == 1 and again["results"][0]["reused"] is True
    code, mixed = run("import-derived", "--course", "be505", "--root", str(root), "--root", str(unfinished), "--max-imports", "4")
    assert code == 1 and [(r["status"], r["reason"]) for r in mixed["results"]] == [("reused", None), ("rejected", "incomplete")]
    code, unknown = run("import-derived", "--course", "not-a-course", "--root", str(root))
    assert code == 1 and unknown["results"][0]["reason"] == "unknown_course"

    opened = Journal.open(settings.journal_path, synced_roots=[])
    try:
        outcomes = [r["payload"]["outcome"] for r in opened.receipts(kind="derived-import")]
        assert sorted(outcomes) == ["imported", "no_change", "no_change", "rejected", "rejected"] and opened.counts()["jobs"] == 0
    finally:
        opened.close()


def test_generations_of_a_recording_that_is_no_longer_listed_stay_on_disk_and_are_reported(settings, derived, journal, tmp_path):
    item = recording(settings, registered=False)
    assert derived.import_generation(write_root(tmp_path / "out", settings, item=item), course_id="be505")["status"] == "imported"
    stored_before = tree(derived.store_dir("be505"))
    (settings.course("be505").root / item["path"]).unlink()  # the file leaves the course folder; an unregistered file is then no longer a source

    status = derived.status("be505")
    assert item["source_id"] not in {r["source_id"] for r in status["recordings"]}
    assert [(u["source_id"], [(g["generation"], g["state"]) for g in u["generations"]]) for u in status["unlisted"]] == [(item["source_id"], [("gen-0001", "stale")])]
    assert status["totals"]["generations"]["stale"] == 1 and derived.current("be505", item["source_id"]) is None
    assert tree(derived.store_dir("be505")) == stored_before


def test_an_import_does_not_widen_the_public_file_route_and_is_not_swept_up_by_cleanup(settings, derived, journal, tmp_path, clock):
    """A manifest grants nothing: the browser-facing file route still serves generated PDF renditions only, and the
    cleanup of rebuildable data does not remove generations (this app cannot regenerate them)."""
    from fastapi.testclient import TestClient

    from lecture_brain.api import create_app
    from lecture_brain.runtime import Runtime

    source_id = recording(settings)["source_id"]
    assert derived.import_generation(write_root(tmp_path / "out", settings), course_id="be505")["status"] == "imported"
    stored_before = tree(derived.store_dir("be505"))
    runtime = Runtime(settings, clock=clock)
    try:
        client = TestClient(create_app(runtime, extra_hosts={"testserver"}))
        inside = f"derived/{source_id}/gen-0001"
        for path in (f".agent/learning-app/{inside}/segments.json", f".agent/learning-app/{inside}/manifest.json", f".agent/learning-app/renditions/../{inside}/segments.json",
                     f".agent/learning-app/renditions/%2e%2e/{inside}/segments.json", f".agent/learning-app/renditions/..%2f{inside}/segments.json"):
            response = client.get(f"/api/files/be505/{path}")
            assert response.status_code in {403, 404} and "Synthetic generated sentence" not in response.text, path
        preview = runtime.retention.cleanup_preview("be505")
        assert not [entry for entry in preview["removable"] if "derived" in entry["path"]]
        assert runtime.cleanup_apply("be505", preview["preview_id"])["status"] == "done"
        assert tree(derived.store_dir("be505")) == stored_before
    finally:
        runtime.journal.close()


def test_a_course_that_is_missing_from_the_planner_does_not_make_the_working_folder_off_limits(workspace, tmp_path, monkeypatch):
    """A configured course without a folder has no root at all. It must not be read as "the current folder", which would
    refuse every output root below wherever the command happens to be started."""
    import yaml

    from lecture_brain.config import load_settings

    config = workspace / "University" / "Fixture Brain" / "planner-config.yaml"
    planner = yaml.safe_load(config.read_text(encoding="utf-8"))
    del planner["courses"]["cs542"]
    config.write_text(yaml.safe_dump(planner), encoding="utf-8")
    settings = load_settings("local", env={}, planner_config=config, state_dir=tmp_path / "private-state")
    assert settings.courses["cs542"].status == "missing_root"
    monkeypatch.chdir(tmp_path)
    root = write_root(tmp_path / "asr-out" / "gen-0001", settings)
    assert Derived(settings).import_generation(root, course_id="be505")["status"] == "imported"
    # The course that has no folder has no recordings to attach anything to.
    other = Derived(settings).import_generation(write_root(tmp_path / "asr-out" / "gen-0002", settings, generation="gen-0002", edit_manifest=lambda m: (m.update(course_id="cs542"), refingerprint(m))), course_id="cs542")
    assert (other["status"], other["reason"]) == ("rejected", "unknown_source")


# ---- the lecture view is the consumer (R1-T1, R1-T2) ---------------------------------------------------
def test_imported_generated_timing_reaches_the_lecture_view_labelled_and_changes_nothing_else(settings, derived, journal, tmp_path):
    from lecture_brain.projections import Projector

    projector = Projector(settings, journal)
    before = projector.lecture_view("be505", "lecture-01")
    assert all(r["generated_text"] is None for r in before["recordings"])
    item = recording(settings)
    assert derived.import_generation(write_root(tmp_path / "out", settings, item=item, window=(0, 20_000)), course_id="be505")["status"] == "imported"
    after = projector.lecture_view("be505", "lecture-01")
    generated = next(r["generated_text"] for r in after["recordings"] if r["source_id"] == item["source_id"])
    assert generated["review_state"] == "generated_unreviewed" and generated["text_origin"] == "generated_speech_text" and generated["establishes"] == []
    assert generated["window"] == {"start_ms": 0, "end_ms": 20_000} and generated["covers_whole_recording"] is False and 0 < generated["coverage_fraction"] < 1
    assert generated["segments"] and all(0 <= s["start_ms"] < s["end_ms"] <= 20_000 and s["text"] for s in generated["segments"])
    # Generated times belong to the generated text: the course transcript stays untimed where it was, no slide gains a link,
    # and the unit's preparation state does not change (the first seconds of speech text are not "the lecture processed").
    assert [t["timing"] for t in after["transcripts"]] == [t["timing"] for t in before["transcripts"]]
    assert [t["line_times"] for t in after["transcripts"]] == [t["line_times"] for t in before["transcripts"]]
    assert [s["occurrences"] for s in after["slides"]] == [s["occurrences"] for s in before["slides"]]
    assert after["preparation"] == before["preparation"]
    assert after["timing_summary"] == {"reviewed_links": sum(1 for s in after["slides"] for o in s["occurrences"] if o["review_state"] == "confirmed"),
                                       "suggested_links": sum(1 for s in after["slides"] for o in s["occurrences"] if o["review_state"] != "confirmed"),
                                       "text_match_suggestions": sum(1 for s in after["slides"] for r in s["transcript_ranges"] if r["review_state"] != "confirmed"),
                                       "generated_text_recordings": 1, "scheduled_preparation": "not_active"}
