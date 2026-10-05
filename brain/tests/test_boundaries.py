"""Boundaries that must hold when the app runs on real course folders.

These are properties, not mechanics: the labeled test tutor never runs outside a generated synthetic workspace;
no route of the read-only profile changes a course or planner byte; a path that leaves the course folder — written in
the course index, or reached through a link on disk — is neither read, hashed, prepared nor served; and being on
loopback is not treated as being the user.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from lecture_brain import contracts as c
from lecture_brain.api import create_app
from lecture_brain.config import ConfigError, load_settings
from lecture_brain.native import UnverifiedNativeAdapter, select_adapter
from lecture_brain.native.fixture_tutor import FixtureTutorAdapter
from lecture_brain.ownerio.inventory import build_inventory
from lecture_brain.runtime import Runtime
from lecture_brain.transport import signing

from helpers import Device, question_message, source_ref, submission

PLANNER = ("University", "Fixture Brain", "planner-config.yaml")


def _tree(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


def _republish_index(course_root, mutate):
    """Change the synthetic course's source index the way its publisher would: bytes plus the pinned digest."""
    index_path = course_root / ".agent" / "source-index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    mutate(index)
    data = json.dumps(index, indent=2).encode("utf-8")
    index_path.write_bytes(data)
    marker_path = course_root / ".agent" / "course-tracking" / "publication.json"
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    marker["files"][".agent/source-index.json"] = hashlib.sha256(data).hexdigest()
    marker_path.write_text(json.dumps(marker, indent=2), encoding="utf-8")


# ---- the labeled test tutor never meets real data ---------------------------------------------------------------
def test_fixture_profile_refuses_any_folder_that_is_not_a_generated_synthetic_workspace(workspace, tmp_path):
    """The fixture profile writes directly and answers with a keyword double. It must be impossible to point it at
    course folders that were not generated as synthetic fixtures — whatever a caller, a file or the environment says."""
    config = workspace.joinpath(*PLANNER)
    assert load_settings("fixture", env={}, planner_config=config, state_dir=tmp_path / "s0").profile == "fixture"  # the generated workspace is accepted

    (workspace / ".ll-synthetic-fixture").unlink()  # the same folders without the generator's marker stand for real course folders
    with pytest.raises(ConfigError, match="synthetic"):
        load_settings("fixture", env={}, planner_config=config, state_dir=tmp_path / "s1")
    # The profiles meant for real folders still open them: read-only, staged, no test tutor.
    for profile in ("local", "live"):
        settings = load_settings(profile, env={}, planner_config=config, state_dir=tmp_path / f"s-{profile}")
        adapter = select_adapter(settings)
        assert isinstance(adapter, UnverifiedNativeAdapter) and not isinstance(adapter, FixtureTutorAdapter) and adapter.is_test_double is False


def test_a_real_profile_with_a_failing_native_route_never_falls_back_to_the_test_tutor(workspace, tmp_path, clock):
    """Native enabled but unproven, missing executable, wrong binding: every case blocks. None answers."""
    config = workspace.joinpath(*PLANNER)
    for env in ({"LL_NATIVE_ENABLED": "true"}, {"LL_NATIVE_ENABLED": "true", "LL_COURSE_WRITES_ENABLED": "true"}, {}):
        settings = load_settings("live", env=env, planner_config=config, state_dir=tmp_path / f"live-{len(env)}")
        runtime = Runtime(settings, clock=clock)
        try:
            assert isinstance(runtime.adapter, UnverifiedNativeAdapter)
            assert runtime.maintenance.capabilities(runtime.adapter)["native"]["status"] == "not_verified"
            assert create_app(runtime, extra_hosts={"testserver"}) is not None
            client = TestClient(create_app(runtime, extra_hosts={"testserver"}))
            assert client.post("/api/fixture/native-mode", json={"mode": "normal"}).status_code == 404  # fixture controls do not exist here
            assert client.get("/api/settings").json()["fixture_modes"] is None
        finally:
            runtime.journal.close()


# ---- no route of the read-only profile writes into a course ----------------------------------------------------------
STATE_CHANGING_ROUTES = {
    ("POST", "/api/courses/{course_id}/resume/resolve"), ("POST", "/api/reveal"), ("PUT", "/api/transport/{course_id}/inbox/{request_id}/{path:path}"),
    ("POST", "/api/pairing/request"), ("POST", "/api/pairing/{key_id}/approve"), ("POST", "/api/pairing/{key_id}/revoke"),
    ("POST", "/api/activity/{request_id}/reconcile"), ("POST", "/api/activity/{request_id}/retry"), ("POST", "/api/supervisor/{action}"),
    ("POST", "/api/fixture/native-mode"), ("POST", "/api/probe-native"), ("POST", "/api/maintenance/apply"), ("POST", "/api/prepare/{course_id}"),
    ("POST", "/api/export"), ("POST", "/api/cleanup/{course_id}/apply"), ("POST", "/api/evidence-deletion"), ("POST", "/api/acceptance/run"),
}


def _bundle_files(settings, device, request_id, action, payload, depth="quick"):
    payload_bytes = c.dump_json(payload)
    request = {"contract": "ll.request/1", "request_id": request_id, "logical_input_id": f"input-{request_id}", "device_id": device.device_id, "sequence": 1,
               "scope": {"course_id": "be505", "term": "2026-fall"}, "thread_key": "tutor-be505", "binding_revision": settings.binding_revision, "parent_request_id": None,
               "action": action, "depth": depth, "submitted_at": "2026-10-04T10:00:01Z", "payload": c.artifact_for_bytes(payload_bytes, "payload.json", "application/json"), "expires_at": None}
    files = {"request.json": c.dump_json(request), "payload.json": payload_bytes}
    manifest = {"contract": "ll.bundle/1", "bundle_id": f"bundle-{request_id}", "kind": "request", "scope": request["scope"], "created_at": "2026-10-04T10:00:02Z",
                "signer_key_id": device.key_id, "record_path": "request.json", "files": [c.artifact_for_bytes(data, name, "application/json") for name, data in sorted(files.items())],
                "predecessor_manifest": None}
    manifest_bytes = c.dump_json(manifest)
    return {**files, "ready.sig.json": c.dump_json(signing.sign_manifest(device.private_key, manifest_bytes, key_id=device.key_id)), "ready.json": manifest_bytes}


def test_every_state_changing_route_of_the_read_only_profile_leaves_course_and_planner_bytes_untouched(workspace, tmp_path, clock):
    """UI, transport, maintenance, export, cleanup, repair, acceptance and preparation are all driven; afterwards the
    course folders and the planner folder are byte-identical. The route table is pinned so a new route cannot be
    added without being driven here."""
    settings = load_settings("local", env={}, planner_config=workspace.joinpath(*PLANNER), state_dir=tmp_path / "private-state")
    roots = {cid: b.root for cid, b in settings.courses.items()}
    before = {cid: _tree(root) for cid, root in roots.items()}
    planner_before = _tree(settings.planner_root)
    runtime = Runtime(settings, clock=clock)
    runtime.startup()
    try:
        app = create_app(runtime, extra_hosts={"testserver"})
        declared = {(method, route.path) for route in app.routes for method in getattr(route, "methods", set()) if method not in {"GET", "HEAD", "OPTIONS"}}
        assert declared == STATE_CHANGING_ROUTES, "a state-changing route was added or removed: drive it below and update the pinned table"
        client = TestClient(app)
        used: set[tuple[str, str]] = set()

        def call(method, template, url, expect, **kwargs):
            response = client.request(method, url, **kwargs)
            assert response.status_code in expect, (method, url, response.status_code, response.text[:300])
            used.add((method, template))
            return response

        issues_at_start = client.get("/api/maintenance/issues").json()["issues"]
        assert any(i["repair"] == "rebuild_alignment_export" for i in issues_at_start), "a repair that writes a file is available and gets applied below"
        device = Device("device-browser")
        call("POST", "/api/pairing/request", "/api/pairing/request", {200}, json={"device_id": device.device_id, "label": "Browser", "public_key_spki_b64": device.spki_b64})
        call("POST", "/api/pairing/{key_id}/approve", f"/api/pairing/{device.key_id}/approve", {200}, json={"reviewed_fingerprint": device.fingerprint})
        ask = question_message(settings, "req-b-ask", "What does the origin do?", [source_ref(roots["be505"])])
        explain = submission("req-b-explain", text="The origin starts replication; it does not control expression.", question_id="BE505-L01-Q01",
                             prompt="What does the origin of replication control?", family=("be505.family.question.l01-q01", 1))
        for request_id, action, payload, depth in (("req-b-ask", "ask", ask, "quick"), ("req-b-explain", "explain_back", explain, "standard")):
            for name, data in _bundle_files(settings, device, request_id, action, payload, depth).items():
                call("PUT", "/api/transport/{course_id}/inbox/{request_id}/{path:path}", f"/api/transport/be505/inbox/{request_id}/{name}", {200}, content=data)
        for action in ("tick", "pause", "resume", "tick"):
            call("POST", "/api/supervisor/{action}", f"/api/supervisor/{action}", {200})
        assert client.get("/api/activity").json()["jobs"], "the submissions were admitted"
        call("POST", "/api/activity/{request_id}/reconcile", "/api/activity/req-b-ask/reconcile", {200, 409})
        call("POST", "/api/activity/{request_id}/retry", "/api/activity/req-b-ask/retry", {200, 409})
        call("POST", "/api/prepare/{course_id}", "/api/prepare/be505", {200})
        call("POST", "/api/export", "/api/export", {200}, json={"courses": sorted(roots)})
        preview = client.get("/api/cleanup/be505/preview").json()
        call("POST", "/api/cleanup/{course_id}/apply", "/api/cleanup/be505/apply", {200}, json={"preview_id": preview["preview_id"]})
        for issue in [*issues_at_start, *client.get("/api/maintenance/issues").json()["issues"], {"issue_id": "owner-view:be562"}, {"issue_id": "no-such-issue"}]:
            call("POST", "/api/maintenance/apply", "/api/maintenance/apply", {200}, json={"issue_id": issue["issue_id"]})
        attempt = next(iter(sorted((roots["be505"] / "learning" / "attempts").glob("*/*.json"))))
        call("POST", "/api/evidence-deletion", "/api/evidence-deletion", {200}, json={"course_id": "be505", "path": attempt.relative_to(roots["be505"]).as_posix()})
        call("POST", "/api/acceptance/run", "/api/acceptance/run", {200})
        call("POST", "/api/probe-native", "/api/probe-native", {200})
        restricted = next(i for i in build_inventory(settings.course("be505"))["other_sources"] if i["disclosure"] == "restricted_solution")
        call("POST", "/api/reveal", "/api/reveal", {200}, json={"course_id": "be505", "source_id": restricted["source_id"]})
        call("POST", "/api/courses/{course_id}/resume/resolve", "/api/courses/be505/resume/resolve", {400}, json={"chosen": "none", "set_aside": []})
        call("POST", "/api/fixture/native-mode", "/api/fixture/native-mode", {404}, json={"mode": "normal"})
        call("POST", "/api/pairing/{key_id}/revoke", f"/api/pairing/{device.key_id}/revoke", {200})
        assert used == STATE_CHANGING_ROUTES

        assert {cid: _tree(root) for cid, root in roots.items()} == before
        assert _tree(settings.planner_root) == planner_before
        # What was submitted is kept, complete, in the private store; nothing was graded and nothing answered.
        private = tmp_path / "private-state"
        assert any("The origin starts replication" in p.read_text(encoding="utf-8", errors="ignore") for p in private.rglob("*.json"))
        assert not list(private.rglob("learning/attempts/*/*.json")) and runtime.journal.counts()["dispatches"] == 0
    finally:
        runtime.journal.close()


# ---- paths that leave the course folder -------------------------------------------------------------------------------------
def test_an_index_entry_pointing_outside_the_course_is_reported_and_never_read_hashed_or_served(workspace, settings, clock, tmp_path):
    root = settings.course("be505").root
    outside = workspace / "outside-secret.pdf"
    outside.write_bytes((root / "materials" / "lectures" / "lecture-01").glob("*.pdf").__next__().read_bytes() + b"\n% outside the course\n")
    outside_sha = hashlib.sha256(outside.read_bytes()).hexdigest()
    escaped = os.path.relpath(outside, root).replace("\\", "/")
    assert escaped.startswith("../")

    def mutate(index):
        entry = next(s for s in index["sources"] if s["source_id"] == "src-lecture-02-slides")
        entry["current_path"] = escaped

    _republish_index(root, mutate)
    inventory = build_inventory(settings.course("be505"))
    item = next(i for i in inventory["other_sources"] + [d for l in inventory["lectures"] for d in l["decks"]] if i["source_id"] == "src-lecture-02-slides")
    assert item["state"] == "registered_path_outside_course" and item["path"] is None and item["bytes"] is None

    runtime = Runtime(settings, clock=clock)
    try:
        client = TestClient(create_app(runtime, extra_hosts={"testserver"}))
        assert client.get("/api/sources/be505/src-lecture-02-slides/content").status_code == 404
        assert client.get("/api/sources/be505/src-lecture-02-slides").json()["state"] == "registered_path_outside_course"
        for url in ("/api/courses/be505", "/api/courses/be505/lectures/lecture-02", "/api/courses/be505/search-index", "/api/coverage"):
            assert client.get(url).status_code == 200, url
        assert client.post("/api/prepare/be505").status_code == 200
        # The outside file's bytes were never read: its digest is known to nothing the app keeps or serves.
        assert runtime.preparation.identity_of("be505", item)[1] != outside_sha
        kept = [p for p in [*(tmp_path / "state").rglob("*"), *root.rglob("*")] if p.is_file() and p.suffix in {".json", ".txt"}]
        assert kept and not [p for p in kept if outside_sha.encode() in p.read_bytes()]
        assert outside_sha not in client.get("/api/courses/be505/lectures/lecture-02").text
    finally:
        runtime.journal.close()


def _link_directory(link, target) -> bool:
    """A directory link that needs no privilege: a junction on Windows, a symlink elsewhere."""
    if sys.platform == "win32":
        return subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True).returncode == 0
    os.symlink(target, link, target_is_directory=True)
    return True


def test_a_folder_link_inside_the_course_does_not_pull_outside_files_into_the_app(workspace, settings, clock):
    root = settings.course("be505").root
    elsewhere = workspace / "elsewhere"
    elsewhere.mkdir()
    deck = next((root / "materials" / "lectures" / "lecture-01").glob("*.pdf"))
    (elsewhere / "Private outside deck.pdf").write_bytes(deck.read_bytes())
    (elsewhere / "notes.txt").write_text("PRIVATE-OUTSIDE-TEXT", encoding="utf-8")
    assert _link_directory(root / "materials" / "lectures" / "lecture-09", elsewhere), "could not create a directory link on this machine"
    assert _link_directory(root / "materials" / "practice-linked", elsewhere)

    inventory = build_inventory(settings.course("be505"))
    names = {i["filename"] for l in inventory["lectures"] for i in [*l["decks"], *l["extra_materials"]]} | {i["filename"] for i in inventory["other_sources"]}
    assert "Private outside deck.pdf" not in names and "notes.txt" not in names
    assert "lecture-09" not in {l["lecture_id"] for l in inventory["lectures"]}
    assert sorted(inventory["skipped_outside_course"]) == ["materials/lectures/lecture-09", "materials/practice-linked"]

    runtime = Runtime(settings, clock=clock)
    try:
        client = TestClient(create_app(runtime, extra_hosts={"testserver"}))
        index = client.get("/api/courses/be505/search-index")
        assert index.status_code == 200 and "PRIVATE-OUTSIDE-TEXT" not in index.text and "Private outside deck" not in index.text
        assert client.get("/api/coverage").json()["courses"]["be505"]["skipped_outside_course"] == 2
    finally:
        runtime.journal.close()


# ---- loopback is not authentication ---------------------------------------------------------------------------------
@pytest.fixture()
def runtime(settings, clock):
    rt = Runtime(settings, clock=clock)
    rt.startup()
    yield rt
    rt.journal.close()


def test_requests_from_other_sites_sandboxed_documents_and_lookalike_hosts_are_refused(runtime):
    client = TestClient(create_app(runtime), base_url="http://127.0.0.1:8765")
    assert client.get("/api/health").status_code == 200
    for host in ("127.0.0.1.evil.example", "localhost.evil.example:8765", "evil.example", "127.0.0.1:8765.evil.example", "[::1].evil.example", ""):
        assert client.get("/api/health", headers={"host": host}).status_code == 403, host
    for origin in ("null", "https://evil.example", "http://127.0.0.1.evil.example", "http://localhost.evil.example:8765", "file://", "http://evil.example:8765",
                   "http://127.0.0.1:9999", "http://localhost:8765", "ftp://127.0.0.1:8765", ""):  # another local port or name is another page, not this app
        assert client.post("/api/supervisor/pause", headers={"origin": origin}).status_code == 403, origin
        assert client.get("/api/courses/be505/history", headers={"origin": origin}).status_code == 403, origin
    for site in ("cross-site", "same-site"):  # e.g. an <img>, a form or a script tag on another page
        assert client.get("/api/courses/be505/history", headers={"sec-fetch-site": site}).status_code == 403, site
        assert client.post("/api/supervisor/pause", headers={"sec-fetch-site": site}).status_code == 403, site
    assert client.get("/api/courses/be505/history", headers={"sec-fetch-site": "none"}).status_code == 200  # typed into the address bar
    assert runtime.journal.get_value("supervisor-paused", False) is False  # none of the refused requests acted
    # The app's own origin works, and no response invites another origin to read it.
    own = client.post("/api/supervisor/pause", headers={"origin": "http://127.0.0.1:8765"})
    assert own.status_code == 200
    for response in (own, client.get("/api/courses/be505/history"), client.options("/api/courses/be505/history", headers={"origin": "https://evil.example", "access-control-request-method": "GET"})):
        assert not [h for h in response.headers if h.lower().startswith("access-control-")]


def test_static_and_file_routes_cannot_be_walked_out_of_their_folders(runtime, tmp_path):
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>app</title>", encoding="utf-8")
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET-BYTES", encoding="utf-8")
    client = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=static))
    drive = secret.as_posix()
    for path in ("/..%2fsecret.txt", "/%2e%2e/secret.txt", "/..%5csecret.txt", "/assets/..%2f..%2fsecret.txt", f"/{drive}", f"/{drive.replace('/', '%5c')}", "//" + drive, "/%2f" + drive.lstrip("/")):
        response = client.get(path)
        assert "TOP-SECRET-BYTES" not in response.text, path
    course_yaml = (runtime.settings.course("be505").root / "course.yaml").read_text(encoding="utf-8")
    for path in ("/api/files/be505/.agent/learning-app/renditions/..%2f..%2f..%2fcourse.yaml", "/api/files/be505/course.yaml", "/api/files/be505/.agent/learning-app/renditions/%2e%2e/%2e%2e/%2e%2e/course.yaml"):
        response = client.get(path)
        assert response.status_code in {403, 404} and course_yaml not in response.text, path
    for request_dir, name in (("..", "request.json"), ("req-1", "..%2f..%2fescape.json"), ("req-1", "C:%5cescape.json"), ("req%2f..%2f..", "x.json")):
        response = client.put(f"/api/transport/be505/inbox/{request_dir}/{name}", content=b"{}")
        assert response.status_code in {400, 404, 405}, (request_dir, name, response.status_code)
    assert not list(tmp_path.rglob("escape.json"))


def test_course_documents_are_served_as_inert_data_and_answer_material_stays_closed(runtime):
    """A course file can be anything, including a web page with scripts. It is served sandboxed, never sniffed, and
    answer keys need the recorded reveal; a reveal token is not a general pass."""
    settings = runtime.settings
    root = settings.course("be505").root
    hostile = root / "materials" / "practice" / "hostile.html"
    hostile.parent.mkdir(parents=True, exist_ok=True)
    hostile.write_text("<script>fetch('/api/supervisor/pause',{method:'POST'})</script>", encoding="utf-8")
    client = TestClient(create_app(runtime, extra_hosts={"testserver"}))
    inventory = build_inventory(settings.course("be505"))
    page = next(i for i in inventory["other_sources"] if i["filename"] == "hostile.html")
    response = client.get(f"/api/sources/be505/{page['source_id']}/content")
    assert response.status_code == 200
    assert response.headers["content-security-policy"] == "sandbox" and response.headers["x-content-type-options"] == "nosniff"
    restricted = next(i for i in inventory["other_sources"] if i["disclosure"] == "restricted_solution")
    assert client.get(f"/api/sources/be505/{restricted['source_id']}/content").status_code == 403
    assert client.get(f"/api/sources/be505/{restricted['source_id']}/content?reveal=guess").status_code == 403
    index = client.get("/api/courses/be505/search-index").text
    history = client.get("/api/courses/be505/history").text
    answer = (root / restricted["path"]).read_bytes()[:4000].decode("utf-8", "ignore")
    for line in [l.strip() for l in answer.splitlines() if len(l.strip()) > 30][:5]:
        assert line not in index and line not in history


# ---- identities of files the course index has not registered are provisional, and say so --------------------------------
def test_an_unregistered_file_has_a_provisional_identity_that_never_enters_a_course_owned_record(runtime, settings):
    """The app must be able to cite, link and prepare a file the course has not registered, so it derives an identity
    from the file's bytes. That identity is this app's own: it is labelled provisional wherever it is shown or exported,
    and it never appears in a record the course owns (an attempt), where it would pass for a course source id."""
    from lecture_brain.annotations import AnnotationStore
    from lecture_brain.ownerio.inventory import identity_status, is_provisional_ref

    client = TestClient(create_app(runtime, extra_hosts={"testserver"}))
    inventory = build_inventory(settings.course("be562"))
    items = [i for l in inventory["lectures"] for i in [*l["decks"], *l["extra_materials"]]] + [i for s in inventory["sessions"] for i in s["items"]]
    unregistered = next(i for i in items if i["registration"] == "unregistered" and i["bytes"])
    registered = next(i for i in items if i["registration"] == "registered" and i["state"] == "registered_readable")
    assert identity_status(unregistered) == "provisional" and identity_status(registered) == "registered"
    shown = client.get(f"/api/sources/be562/{unregistered['source_id']}").json()
    assert shown["identity"] == "provisional" and "not in the course index" in shown["identity_note"] and "may change" in shown["identity_note"]
    assert client.get(f"/api/sources/be562/{registered['source_id']}").json()["identity"] == "registered"
    # Reference-level rule used by every exporter: either the id or the version marks it.
    assert is_provisional_ref({"source_id": unregistered["source_id"], "version_id": "disk-0123456789ab"})
    assert is_provisional_ref({"source_id": "src-lecture-01-slides", "version_id": "disk-0123456789ab"}) and not is_provisional_ref({"source_id": "src-lecture-01-slides", "version_id": "v1-78f85d4c0657"})
    # Every exported link states which kind of identity its ends have.
    for course_id in settings.courses:
        runtime.preparation.prepare_course(course_id)
        for link in AnnotationStore(settings).export_alignment(course_id)["links"]:
            assert link["identity"] == ("provisional" if is_provisional_ref(link["from"]) or is_provisional_ref(link["to"]) else "registered")
    exported = [link for course_id in settings.courses for link in AnnotationStore(settings).export_alignment(course_id)["links"]]
    assert {link["identity"] for link in exported} == {"provisional", "registered"}  # the synthetic courses contain both kinds
    # Course-owned records: no attempt file anywhere carries a provisional id.
    for binding in settings.courses.values():
        for attempt in (binding.root / "learning" / "attempts").glob("*/*.json"):
            text = attempt.read_text(encoding="utf-8")
            assert "unreg-" not in text and '"disk-' not in text, attempt
