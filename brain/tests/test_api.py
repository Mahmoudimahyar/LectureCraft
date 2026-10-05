"""Loopback API: read views, file-shaped transport, operator actions and its hard boundaries."""
from __future__ import annotations

import base64
import json

import pytest
from fastapi.testclient import TestClient

from lecture_brain import contracts as c
from lecture_brain.api import create_app
from lecture_brain.runtime import Runtime
from lecture_brain.transport import signing

from helpers import Device, question_message, source_ref


@pytest.fixture()
def runtime(settings, clock):
    rt = Runtime(settings, clock=clock)
    rt.startup()
    yield rt
    rt.journal.close()


@pytest.fixture()
def client(runtime):
    return TestClient(create_app(runtime, extra_hosts={"testserver"}))


def _pair(client) -> tuple[Device, dict]:
    device = Device("device-browser")
    pending = client.post("/api/pairing/request", json={"device_id": device.device_id, "label": "Browser", "public_key_spki_b64": device.spki_b64}).json()
    assert pending["device"]["state"] == "pending" and pending["device"]["fingerprint"] == device.fingerprint
    approved = client.post(f"/api/pairing/{device.key_id}/approve", json={"reviewed_fingerprint": device.fingerprint}).json()
    return device, approved


def _upload_ask(client, settings, device, request_id="req-api-1", text="What does the origin do?"):
    payload = question_message(settings, request_id, text, [source_ref(settings.course("be505").root)])
    payload_bytes = c.dump_json(payload)
    request = {"contract": "ll.request/1", "request_id": request_id, "logical_input_id": f"input-{request_id}", "device_id": device.device_id, "sequence": 1,
               "scope": {"course_id": "be505", "term": "2026-fall"}, "thread_key": "tutor-be505", "binding_revision": settings.binding_revision, "parent_request_id": None,
               "action": "ask", "depth": "quick", "submitted_at": "2026-10-04T10:00:01Z", "payload": c.artifact_for_bytes(payload_bytes, "payload.json", "application/json"), "expires_at": None}
    files = {"request.json": c.dump_json(request), "payload.json": payload_bytes}
    manifest = {"contract": "ll.bundle/1", "bundle_id": f"bundle-{request_id}", "kind": "request", "scope": request["scope"], "created_at": "2026-10-04T10:00:02Z",
                "signer_key_id": device.key_id, "record_path": "request.json", "files": [c.artifact_for_bytes(data, name, "application/json") for name, data in sorted(files.items())],
                "predecessor_manifest": None}
    manifest_bytes = c.dump_json(manifest)
    for name, data in files.items():
        assert client.put(f"/api/transport/be505/inbox/{request_id}/{name}", content=data).status_code == 200
    assert client.put(f"/api/transport/be505/inbox/{request_id}/ready.sig.json", content=c.dump_json(signing.sign_manifest(device.private_key, manifest_bytes, key_id=device.key_id))).status_code == 200
    assert client.put(f"/api/transport/be505/inbox/{request_id}/ready.json", content=manifest_bytes).status_code == 200
    return request_id


def test_non_loopback_hosts_and_foreign_origins_are_refused(runtime):
    strict = TestClient(create_app(runtime))  # no test host allowance
    assert strict.get("/api/health").status_code == 403
    assert strict.get("/api/health", headers={"host": "127.0.0.1:8765"}).status_code == 200
    assert strict.get("/api/health", headers={"host": "evil.example:8765"}).status_code == 403
    assert strict.get("/api/health", headers={"host": "localhost:8765", "origin": "https://evil.example"}).status_code == 403
    # The development server forwards its own Host unchanged, so its pages are same-origin; a page on another local port is not.
    assert strict.get("/api/health", headers={"host": "127.0.0.1:5173", "origin": "http://127.0.0.1:5173"}).status_code == 200
    assert strict.get("/api/health", headers={"host": "localhost:8765", "origin": "http://127.0.0.1:5173"}).status_code == 403


def test_views_are_served_and_unknown_ids_are_404_not_guessed(client):
    workspace = client.get("/api/workspace").json()
    assert len(workspace["courses"]) == 5 and workspace["capabilities"]["native"]["status"] == "fixture_double" and workspace["brain"]["fingerprint"]
    assert client.get("/api/courses/be505").json()["lectures"][0]["lecture_id"] == "lecture-01"
    unprepared = client.get("/api/courses/be505/lectures/lecture-01").json()  # the queued preparation has not run yet: slides are still navigable
    assert unprepared["page_count"] == 4 and {s["text_status"] for s in unprepared["slides"]} == {"not_prepared"} and unprepared["slides"][1]["occurrences"]
    assert client.get("/api/courses/be505/lectures/nope").status_code == 404 and client.get("/api/courses/zz999").status_code == 404
    assert client.get("/api/courses/be505/concepts/be505.concept.promoter").json()["center"] == "be505.concept.promoter"
    assert client.get("/api/courses/be505/progress").json()["summary"]["skills"] == 5
    assert client.get("/api/courses/be505/review").json()["available_questions"] and client.get("/api/activity").json()["jobs"]


def test_source_bytes_resolve_by_id_with_range_support_and_answer_keys_need_a_recorded_reveal(client):
    course = client.get("/api/courses/be505").json()
    lecture = client.get("/api/courses/be505/lectures/lecture-01").json()
    pdf = client.get("/api/" + lecture["display"]["content"])
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and pdf.headers["content-type"] == "application/pdf"
    audio = client.get("/api/" + lecture["recordings"][0]["content"], headers={"range": "bytes=0-99"})
    assert audio.status_code == 206 and len(audio.content) == 100 and audio.headers["content-range"].startswith("bytes 0-99/")
    solutions = next(s for s in course["other_sources"] if s["disclosure"] == "restricted_solution")
    assert client.get(f"/api/sources/be505/{solutions['source_id']}/content").status_code == 403
    reveal = client.post("/api/reveal", json={"course_id": "be505", "source_id": solutions["source_id"]}).json()
    assert reveal["exposure"] == "seen_solution"
    assert client.get(f"/api/sources/be505/{solutions['source_id']}/content?reveal={reveal['token']}").content.startswith(b"%PDF")
    missing = next(s for s in course["other_sources"] if s["state"] == "registered_unavailable")
    assert client.get(f"/api/sources/be505/{missing['source_id']}/content").status_code == 404
    assert client.get("/api/sources/be505/..%2F..%2Fplanning%2Fgrades.yaml/content").status_code == 404
    assert client.get("/api/files/be505/learning/attempts/2026-09/be505-20260905-l01-q01-teachback-01.json").status_code == 403


def test_pairing_upload_tick_and_signed_result_roundtrip(client, runtime, settings):
    device, approved = _pair(client)
    assert approved["device"]["state"] == "paired"
    request_id = _upload_ask(client, settings, device)
    pending = client.get(f"/api/results/be505/{request_id}").json()
    assert pending["result"] is None and pending["job"] is None  # uploaded is not yet "received by Brain"
    summary = client.post("/api/supervisor/tick").json()
    assert any(r["request_id"] == request_id and r["state"] == "SUCCEEDED" for r in summary["ran"])
    body = client.get(f"/api/results/be505/{request_id}").json()
    result = body["result"]
    manifest_bytes = base64.b64decode(result["manifest_b64"])
    brain_key = signing.load_public_key_spki_b64(approved["brain"]["public_key_spki_b64"])
    assert signing.verify_manifest(brain_key, manifest_bytes, result["signature"]) is True  # the client can verify against the paired Brain key
    manifest = json.loads(manifest_bytes)
    for entry in manifest["files"]:
        assert c.sha256_hex(base64.b64decode(result["files_b64"][entry["path"]])) == entry["sha256"]
    message = json.loads(base64.b64decode(result["files_b64"]["message.json"]))
    assert message["assessment_disposition"] == "not_assessed" and "Fixture tutor" in message["text"] and result["is_current_generation"] is True
    detail = client.get(f"/api/activity/{request_id}").json()
    assert detail["job"]["phases"]["publication"] == "Not assessed in this exchange" and detail["job"]["phases"]["answer"] == "Available"


def test_transport_is_immutable_and_unpaired_uploads_are_never_admitted(client, runtime, settings):
    stranger = Device("device-stranger")
    _upload_ask(client, settings, stranger, "req-stranger")
    client.post("/api/supervisor/tick")
    activity = client.get("/api/activity").json()
    assert not any(j["request_id"] == "req-stranger" for j in activity["jobs"])
    assert activity["rejections"][0]["status"] == "unauthorized"
    assert client.put("/api/transport/be505/inbox/req-stranger/payload.json", content=b"{}").status_code == 409  # no overwrite of submitted bytes
    assert client.put("/api/transport/be505/inbox/req-x/..%2F..%2Fescape.json", content=b"{}").status_code in {400, 404}
    assert client.put("/api/transport/be505/inbox/bad:id/payload.json", content=b"{}").status_code == 400
    assert client.put("/api/transport/zz999/inbox/req-x/payload.json", content=b"{}").status_code == 404


def test_operator_controls_pause_fixture_modes_and_repair_preview(client, runtime, settings):
    device, _ = _pair(client)
    assert client.post("/api/supervisor/pause").json() == {"paused": True}
    _upload_ask(client, settings, device, "req-paused")
    client.post("/api/supervisor/tick")
    assert client.get("/api/activity/req-paused").json()["job"]["state"] == "READY"
    assert client.post("/api/supervisor/resume").json() == {"paused": False}
    assert client.post("/api/fixture/native-mode", json={"mode": "completion_unknown"}).json() == {"mode": "completion_unknown"}
    client.post("/api/supervisor/tick")
    job = client.get("/api/activity/req-paused").json()["job"]
    assert job["state"] == "UNCERTAIN_COMPLETION" and {"check_status", "retry", "cancel"} <= set(job["actions"]) and job["phases"]["native"] == "Completion unknown"
    issues = client.get("/api/maintenance/issues").json()["issues"]
    issue = next(i for i in issues if i["kind"] == "uncertain_native_outcome")
    assert client.get("/api/maintenance/preview", params={"issue_id": issue["issue_id"]}).json()["allowed"] is True
    client.post("/api/fixture/native-mode", json={"mode": "normal"})
    assert client.post("/api/activity/req-paused/reconcile").json() == {"state": "SUCCEEDED"}
    assert client.post("/api/fixture/native-mode", json={"mode": "be-a-real-tutor"}).status_code == 400
    settings_view = client.get("/api/settings").json()
    assert settings_view["limits"]["additional_paid_inference_budget_usd"] == 0 and settings_view["devices"][0]["state"] == "paired"
    # No key material or credential-like field is exposed. (Checked exactly: a random base64 PUBLIC key may contain any
    # three-letter sequence, so a substring search for "pem" over the whole view is not a meaningful test.)
    dumped = json.dumps(settings_view)
    key_file = next(settings.state_dir.rglob("brain-signing-key.pem"))
    secret_lines = [line for line in key_file.read_text(encoding="ascii").splitlines() if line and not line.startswith("-----")]
    assert secret_lines and not any(line in dumped for line in secret_lines)
    assert "PRIVATE KEY" not in dumped and "-----BEGIN" not in dumped

    def field_names(value):
        if isinstance(value, dict):
            for key, inner in value.items():
                yield key
                yield from field_names(inner)
        elif isinstance(value, list):
            for inner in value:
                yield from field_names(inner)

    assert not [name for name in field_names(settings_view) if any(word in name.lower() for word in ("private", "secret", "token", "password", "cookie"))]


def test_startup_queues_preparation_from_updater_receipts_and_the_loop_runs_it(client, runtime):
    assert runtime.journal.counts()["jobs"] == 5  # one inventory-refresh per course, from the published index digests
    for _ in range(3):
        client.post("/api/supervisor/tick")
    coverage = client.get("/api/coverage").json()
    assert coverage["totals"].get("not_processed", 0) == 0 and coverage["totals"]["lecture_units"] == 10
    l2 = client.get("/api/courses/be505/lectures/lecture-02").json()
    assert any(o["review_state"] == "suggested" for s in l2["slides"] for o in s["occurrences"])
    assert runtime.adapter.calls == 0  # preparation never calls the tutor


def test_acceptance_and_probe_endpoints_report_honestly(client):
    assert client.post("/api/acceptance/run").json()["overall"] != "READY"
    probe = client.post("/api/probe-native").json()
    assert probe["status"] == "INSPECT_ONLY" and probe["checks"]["executable_present"] == "FAIL"


def test_built_app_is_served_with_browser_safe_types_and_policy(runtime, tmp_path):
    """Module scripts and workers must not be served as text/plain (Windows maps .mjs/.js unpredictably)."""
    static = tmp_path / "dist"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html><title>app</title>", encoding="utf-8")
    (static / "assets" / "pdf.worker.min-abc.mjs").write_text("export {};", encoding="utf-8")
    (static / "assets" / "index-abc.js").write_text("export {};", encoding="utf-8")
    (static / "theme-boot.js").write_text("void 0;", encoding="utf-8")
    app_client = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=static))
    for path in ("/assets/pdf.worker.min-abc.mjs", "/assets/index-abc.js", "/theme-boot.js"):
        response = app_client.get(path)
        assert response.status_code == 200 and response.headers["content-type"].split(";")[0] == "text/javascript", path
        assert response.headers["x-content-type-options"] == "nosniff"
    page = app_client.get("/courses/be505/lectures/lecture-02")  # client-side route falls back to the app shell
    assert page.status_code == 200 and "font-src 'self' data:" in page.headers["content-security-policy"]
    assert app_client.get("/api/not-a-route").status_code == 404


def test_cleanup_of_rebuildable_data_queues_its_rebuild_so_nothing_stays_unprocessed(client, runtime):
    """Removing prepared slide text must not silently leave lectures unsearchable: the rebuild is queued and runs."""
    for _ in range(6):
        client.post("/api/supervisor/tick")
    slides = lambda: [e for e in client.get("/api/courses/be505/search-index").json()["entries"] if e["type"] == "slide"]  # noqa: E731
    assert slides(), "slide text is searchable after the first preparation"
    preview = client.get("/api/cleanup/be505/preview").json()
    assert any(i["path"].endswith("/prepared") for i in preview["removable"])
    receipt = client.post("/api/cleanup/be505/apply", json={"preview_id": preview["preview_id"]}).json()
    assert receipt["status"] == "done"
    assert receipt["rebuild"] == {"queued": True, "note": "Preparation was queued again and runs in bounded background batches; until it finishes, removed slide text is listed as not yet searchable."}
    assert not slides() and client.get("/api/courses/be505/search-index").json()["unindexed"]  # honest in the meantime
    for _ in range(6):
        client.post("/api/supervisor/tick")
    assert slides(), "the queued rebuild restored the slide text"
    coverage = client.get("/api/coverage").json()["courses"]["be505"]["lectures"]
    assert all(l["disposition"] != "not_processed" for l in coverage)
    # A cleanup that removed nothing rebuildable queues nothing.
    again = client.get("/api/cleanup/be562/preview").json()
    if not any(i["path"].endswith("/prepared") for i in again["removable"]):
        quiet = client.post("/api/cleanup/be562/apply", json={"preview_id": again["preview_id"]}).json()
        assert quiet["rebuild"]["queued"] is False
