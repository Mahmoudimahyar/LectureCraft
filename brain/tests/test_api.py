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
    assert coverage["totals"].get("not_processed", 0) == 0 and coverage["totals"]["lecture_units"] == 11
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


# ---- R1-Q1/Q5: question bank and deck choice over HTTP ------------------------------------------------
def test_question_bank_endpoint_pages_filters_and_keeps_the_true_total(client):
    first = client.get("/api/courses/be505/questions", params={"limit": 3}).json()
    assert first["total"] >= 11 and len(first["items"]) == 3 and first["next_offset"] == 3
    rest = client.get("/api/courses/be505/questions", params={"limit": 500, "offset": 3}).json()
    assert len(first["items"]) + len(rest["items"]) == first["total"] and rest["next_offset"] is None
    lecture = client.get("/api/courses/be505/questions", params={"lecture": "lecture-04"}).json()
    assert lecture["matching"] == 3 and {q["collection"] for q in lecture["items"]} == {"L04", "L04-class"}
    assert client.get("/api/courses/be505/questions", params={"q": "BE505-L01-Q04"}).json()["matching"] == 1
    assert client.get("/api/courses/be505/questions", params={"limit": 0}).status_code == 422 and client.get("/api/courses/nope/questions").status_code == 404
    # the single-question route still answers, and an id is never mistaken for the list
    assert client.get("/api/courses/be505/questions/BE505-L01-Q04").json()["anchor_state"] == "unresolved"


def test_lecture_endpoint_accepts_a_deck_of_the_same_unit_only(client):
    view = client.get("/api/courses/be505/lectures/lecture-04").json()
    assert view["deck"]["source_id"] == "src-lecture-04-slides" and len(view["questions"]["all"]) == 3
    sheet = client.get("/api/courses/be505/lectures/lecture-04", params={"deck": "src-lecture-04-in-class-questions"}).json()
    assert sheet["deck"]["source_id"] == "src-lecture-04-in-class-questions" and sheet["deck_choice"]["basis"] == "this_request" and sheet["page_count"] == 1
    other = client.get("/api/courses/be505/lectures/lecture-04", params={"deck": "src-lecture-01-slides"}).json()
    assert other["deck"]["source_id"] == "src-lecture-04-slides"  # a file of another unit is ignored


# ---- build identity: which build, profile and preparation generation is a browser looking at -------------------------
import hashlib  # noqa: E402
import importlib.util  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from pathlib import Path  # noqa: E402

from lecture_brain import api as api_module  # noqa: E402
from lecture_brain import preparation  # noqa: E402

BUILT_FROM = "c3" * 20  # the commit the synthetic bundle below says it was built from
BUILT_AT = "2026-10-05T21:50:44Z"
STAMP = f'<meta name="ll-build" content="commit={BUILT_FROM}; dirty=false; built_at={BUILT_AT}">'  # what web/vite.config.ts writes into a built index.html
INDEX_HTML = ('<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>app</title><link rel="icon" href="/favicon.ico">'
              '<script src="/theme-boot.js"></script><script type="module" crossorigin src="/assets/index-AbCd1234.js"></script>'
              '<link rel="modulepreload" crossorigin href="/assets/vendor-Qr_St-56.js"><link rel="stylesheet" crossorigin href="/assets/index-Zy_Xw-98.css">'
              + STAMP + "</head><body><div id=\"root\"></div><script>window.inline = 1;</script></body></html>")
INDEX_JS = ["theme-boot.js", "assets/index-AbCd1234.js", "assets/vendor-Qr_St-56.js"]
INDEX_CSS = ["assets/index-Zy_Xw-98.css"]
UNHASHED_LOOKALIKES = ("assets/app-settings.js", "assets/theme-fallback.css", "assets/pdf-renderer.mjs", "assets/fonts/inter-variable.woff2", "assets/logo-official.svg", "assets/data-20261005.json",
                       "assets/index-AbCd1234.js.map")  # (a source map sits beside a hashed file but is not in the bundler's list)
_ISO = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")


def _bundler_manifest(directory: Path, names: list[str]) -> None:
    """Labelled double of the bundler's own build manifest (.vite/manifest.json): the files that build emitted under content-hashed names."""
    scripts = [name for name in names if name.endswith(".js")]
    entries = {f"src/{index}.tsx": {"file": name, "isEntry": index == 0} for index, name in enumerate(scripts)}
    if scripts:
        entries["src/0.tsx"].update(css=[name for name in names if name.endswith(".css")], assets=[name for name in names if not name.endswith((".js", ".css"))])
    (directory / ".vite").mkdir(exist_ok=True)
    (directory / ".vite" / "manifest.json").write_text(json.dumps(entries), encoding="utf-8")


def _dist(directory: Path, html: str = INDEX_HTML, *, manifest: bool = True) -> Path:
    """A synthetic built app (labelled double of web/dist): an index.html, the files it names and the bundler's manifest."""
    (directory / "assets" / "fonts").mkdir(parents=True)
    (directory / "index.html").write_text(html, encoding="utf-8")
    (directory / "theme-boot.js").write_text("void 0;", encoding="utf-8")
    hashed = re.findall(r"/(assets/[^\"]+)", html)
    for name in hashed:
        (directory / name).write_text(f"/* {name} */", encoding="utf-8")
    (directory / "assets" / "plain.js").write_text("/* no content hash in this name */", encoding="utf-8")
    for name in UNHASHED_LOOKALIKES:  # copied in as they are (as from web/public): ordinary names that merely end in a dash and eight characters
        (directory / name).write_text(f"/* {name}: not emitted by the bundler */", encoding="utf-8")
    if manifest:
        _bundler_manifest(directory, hashed)
    finished = time.time() - 3600  # a build that finished an hour ago
    for path in directory.rglob("*"):
        os.utime(path, (finished, finished))
    return directory


def _no_absolute_path(dumped: str, *private: Path) -> None:
    for path in (*private, Path.home()):
        assert str(path) not in dumped and path.as_posix() not in dumped and json.dumps(str(path))[1:-1] not in dumped
    assert not re.search(r"(?<![A-Za-z])[A-Za-z]:[\\/]", dumped) and "\\\\" not in dumped  # no drive-letter or backslash path of any kind
    user = Path.home().name.lower()
    if len(user) >= 4 and not re.fullmatch(r"[0-9a-f]+", user):  # (a short or hex-looking name could occur inside a commit id by chance)
        assert user not in dumped.lower()


def test_health_keeps_its_fields_and_carries_the_build_identity_without_any_absolute_path(client, settings):
    health = client.get("/api/health").json()
    assert health["ok"] is True and health["profile"] == "fixture" and health["paused"] is False and "schema_revision" in health  # unchanged fields
    build = health["build"]
    assert set(build) == {"app_version", "commit", "commit_short", "branch", "dirty", "pid", "process_started_at", "process_started_basis", "profile", "port",
                          "preparation_tool_version", "source_map_version", "assets", "web_build", "static", "courses"}
    assert build["profile"] == settings.profile and build["preparation_tool_version"] == preparation.TOOL_VERSION
    assert isinstance(build["port"], int) and set(build["courses"]) == set(settings.courses)
    assert build["pid"] == os.getpid()  # the serving process itself (this test client runs the app in-process)
    assert build["source_map_version"] is None or isinstance(build["source_map_version"], str)
    assert build["dirty"] in (True, False, None)
    if (settings.repo / ".git").exists():  # this checkout: the identity is a full commit id and its short form
        assert re.fullmatch(r"[0-9a-f]{40}", build["commit"]) and build["commit_short"] == build["commit"][:7]
    else:
        assert build["commit"] is None and build["commit_short"] is None and build["dirty"] is None
    assert _ISO.fullmatch(build["process_started_at"])
    assert datetime.strptime(build["process_started_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)
    assert client.get("/api/health").json()["build"]["process_started_at"] == build["process_started_at"]  # the process start, not the request time
    assert build["static"] == {"served": False, "directory": None, "index_modified_at": None, "index_sha256": None}  # no built app is mounted here
    assert build["assets"] == {"script": [], "style": []} and build["web_build"] is None
    _no_absolute_path(json.dumps(health), settings.repo, settings.state_dir)


def test_index_html_is_always_revalidated_and_only_content_hashed_assets_may_be_cached(runtime, tmp_path):
    app_client = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=_dist(tmp_path / "dist")))
    for path in ("/", "/index.html", "/courses/be505/lectures/lecture-02", "/settings"):  # the page itself, however it is reached
        page = app_client.get(path)
        assert page.status_code == 200 and page.text == INDEX_HTML and page.headers["cache-control"] == "no-cache", path
        assert "default-src 'self'" in page.headers["content-security-policy"], path
    asset = app_client.get("/assets/index-AbCd1234.js")  # an asset under assets/ is served, and may be kept
    assert asset.status_code == 200 and asset.text == "/* assets/index-AbCd1234.js */" and asset.headers["content-type"].split(";")[0] == "text/javascript"
    assert "immutable" in asset.headers["cache-control"] and "max-age=" in asset.headers["cache-control"] and "no-store" not in asset.headers["cache-control"]
    assert "immutable" in app_client.get("/assets/index-Zy_Xw-98.css").headers["cache-control"]
    for path in ("/theme-boot.js", "/assets/plain.js"):  # a name without a content hash can change under the same URL
        assert app_client.get(path).headers["cache-control"] == "no-cache", path
    # A file written a moment ago may still be being written by a build in progress: it is served, but not pinned in the browser.
    fresh = tmp_path / "dist" / "assets" / "index-Fr3shNow.js"
    fresh.write_text("/* half of a bun", encoding="utf-8")
    _bundler_manifest(tmp_path / "dist", ["assets/index-Fr3shNow.js", "assets/index-Zy_Xw-98.css"])  # the new build's manifest names it
    assert app_client.get("/assets/index-Fr3shNow.js").headers["cache-control"] == "no-cache"
    os.utime(fresh, (time.time() - 60, time.time() - 60))
    assert "immutable" in app_client.get("/assets/index-Fr3shNow.js").headers["cache-control"]
    assert app_client.get("/assets/index-AbCd1234.js").headers["cache-control"] == "no-cache"  # left over from the previous build: no longer named, no longer pinned
    for path in ("/api/health", "/api/workspace", "/api/courses/be505", "/api/not-a-route"):  # data and errors are never stored by the browser
        assert app_client.get(path).headers["cache-control"] == "no-store", path
    lecture = app_client.get("/api/courses/be505/lectures/lecture-01").json()
    assert app_client.get("/api/" + lecture["display"]["content"]).headers["cache-control"] == "no-store"  # course bytes too


def test_the_identity_names_the_assets_of_the_dist_being_served_and_follows_a_rebuild(runtime, tmp_path):
    static = _dist(tmp_path / "dist")
    app_client = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=static))
    index = static / "index.html"
    build = app_client.get("/api/health").json()["build"]
    served = build["static"]
    assert served["served"] is True and build["assets"] == {"script": INDEX_JS, "style": INDEX_CSS}  # inline scripts and the icon are not assets
    assert served["index_sha256"] == hashlib.sha256(index.read_bytes()).hexdigest() == hashlib.sha256(app_client.get("/").content).hexdigest()
    assert served["index_modified_at"] == datetime.fromtimestamp(index.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert served["directory"] is None  # this dist is outside the repository: where it lies is not disclosed
    _no_absolute_path(app_client.get("/api/health").text, tmp_path, static)
    for name in INDEX_JS + INDEX_CSS:
        assert app_client.get("/" + name).status_code == 200, name
    # A rebuild replaces index.html: the next page load and the identity both show the new build, with no restart.
    rebuilt = INDEX_HTML.replace("index-AbCd1234.js", "index-Nn00Pp11.js")
    index.write_text(rebuilt, encoding="utf-8")
    after = app_client.get("/api/health").json()["build"]
    assert after["assets"]["script"] == ["theme-boot.js", "assets/index-Nn00Pp11.js", "assets/vendor-Qr_St-56.js"] and after["static"]["index_sha256"] == hashlib.sha256(rebuilt.encode()).hexdigest()
    assert app_client.get("/").text == rebuilt
    index.unlink()  # mid-rebuild the file is briefly absent: the identity says so instead of failing
    absent = app_client.get("/api/health").json()["build"]
    assert absent["static"] == {"served": True, "directory": None, "index_modified_at": None, "index_sha256": None}
    assert absent["assets"] == {"script": [], "style": []} and absent["web_build"] is None
    # A dist inside the repository is named relative to it.
    assert api_module.static_identity(runtime.settings.repo / "web" / "dist", runtime.settings.repo)["static"]["directory"] == "web/dist"
    inside = api_module.static_identity(static, tmp_path)["static"]
    assert inside["directory"] == "dist" and inside["served"] is True


def test_the_source_map_version_is_reported_when_that_module_exists_and_absent_otherwise(runtime, monkeypatch):
    double = types.ModuleType("lecture_brain.sourcemap")  # labelled double of a module that another change introduces
    double.SOURCE_MAP_VERSION = "source-map/double-7"
    monkeypatch.setitem(sys.modules, "lecture_brain.sourcemap", double)
    with_map = TestClient(create_app(runtime, extra_hosts={"testserver"})).get("/api/health").json()["build"]
    assert with_map["source_map_version"] == "source-map/double-7"
    monkeypatch.setitem(sys.modules, "lecture_brain.sourcemap", None)  # importing it now raises ImportError
    without = TestClient(create_app(runtime, extra_hosts={"testserver"})).get("/api/health")
    assert without.status_code == 200 and without.json()["build"]["source_map_version"] is None


def _git_layout(root: Path, head: str, *, loose: dict[str, str] | None = None, packed: str | None = None) -> Path:
    git = root / ".git"
    git.mkdir(parents=True)
    (git / "HEAD").write_text(head + "\n", encoding="utf-8")
    for ref, value in (loose or {}).items():
        (git / ref).parent.mkdir(parents=True, exist_ok=True)
        (git / ref).write_text(value + "\n", encoding="utf-8")
    if packed is not None:
        (git / "packed-refs").write_text(packed, encoding="utf-8")
    return root


def test_the_commit_is_read_from_git_metadata_for_every_layout_and_never_guessed(tmp_path, repo):
    a, b = "a1" * 20, "b2" * 20
    unknown = {"commit": None, "commit_short": None, "branch": None}
    on_branch = _git_layout(tmp_path / "loose", "ref: refs/heads/build/topic", loose={"refs/heads/build/topic": a})
    assert api_module.repository_commit(on_branch) == {"commit": a, "commit_short": a[:7], "branch": "build/topic"}
    packed = _git_layout(tmp_path / "packed", "ref: refs/heads/main", packed=f"# pack-refs with: peeled fully-peeled sorted \n{b} refs/heads/other\n{a} refs/heads/main\n^{b}\n")
    assert api_module.repository_commit(packed) == {"commit": a, "commit_short": a[:7], "branch": "main"}
    both = _git_layout(tmp_path / "both", "ref: refs/heads/main", loose={"refs/heads/main": b}, packed=f"{a} refs/heads/main\n")
    assert api_module.repository_commit(both)["commit"] == b  # a loose ref is newer than its packed entry
    detached = _git_layout(tmp_path / "detached", b)
    assert api_module.repository_commit(detached) == {"commit": b, "commit_short": b[:7], "branch": None}
    # A linked worktree: .git is a file pointing at its own directory, whose refs live in the common one.
    main = _git_layout(tmp_path / "main", "ref: refs/heads/main", loose={"refs/heads/main": b, "refs/heads/side": a})
    private = main / ".git" / "worktrees" / "side"
    private.mkdir(parents=True)
    (private / "HEAD").write_text("ref: refs/heads/side\n", encoding="utf-8")
    (private / "commondir").write_text("../..\n", encoding="utf-8")
    worktree = tmp_path / "side"
    worktree.mkdir()
    (worktree / ".git").write_text(f"gitdir: {private.as_posix()}\n", encoding="utf-8")
    assert api_module.repository_commit(worktree) == {"commit": a, "commit_short": a[:7], "branch": "side"}
    # Nothing to read, or something that is not a commit id: unknown, not an invention.
    assert api_module.repository_commit(tmp_path / "nowhere") == unknown
    unborn = _git_layout(tmp_path / "unborn", "ref: refs/heads/main")
    assert api_module.repository_commit(unborn) == {"commit": None, "commit_short": None, "branch": "main"}
    assert api_module.repository_commit(_git_layout(tmp_path / "garbage", "ref: refs/heads/main", loose={"refs/heads/main": "not-a-commit"}))["commit"] is None
    assert api_module.repository_commit(_git_layout(tmp_path / "escape", "ref: ../../outside", loose={"refs/heads/main": a})) == unknown
    git = shutil.which("git")
    if git is not None and (repo / ".git").exists():  # cross-check against git itself on this checkout
        assert api_module.repository_commit(repo)["commit"] == subprocess.run([git, "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


def test_dirty_comes_from_one_read_only_status_and_stays_unknown_without_a_checkout_or_git(tmp_path, monkeypatch):
    assert api_module.repository_dirty(tmp_path) is None  # not a checkout
    git = shutil.which("git")
    if git is None:
        return  # no git on this machine: every answer is "unknown", which the line above already showed
    work = tmp_path / "checkout"
    work.mkdir()
    # No inherited GIT_DIR / GIT_WORK_TREE reaches this test's own git: it acts on its temporary folder only.
    env = {**{key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_")}, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

    def run(*args: str) -> str:
        return subprocess.run([git, "-C", str(work), "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", *args],
                              capture_output=True, text=True, check=True, env=env).stdout.strip()

    run("init", "-q")
    (work / "tracked.txt").write_text("first version\n", encoding="utf-8")
    run("add", "tracked.txt")
    run("commit", "-q", "-m", "first")
    assert api_module.repository_dirty(work) is False
    assert api_module.repository_commit(work)["commit"] == run("rev-parse", "HEAD")
    index_before = (work / ".git" / "index").read_bytes()
    (work / "tracked.txt").write_text("a changed and longer version\n", encoding="utf-8")
    assert api_module.repository_dirty(work) is True
    (work / "tracked.txt").write_text("first version\n", encoding="utf-8")
    (work / "untracked.py").write_text("NEW = 1\n", encoding="utf-8")
    assert api_module.repository_dirty(work) is True  # a new module is part of what runs, so it counts
    assert (work / ".git" / "index").read_bytes() == index_before and not (work / ".git" / "index.lock").exists()  # the check wrote nothing
    empty = tmp_path / "no-programs"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))  # git not installed
    assert api_module.git_executable() is None and api_module.repository_dirty(work) is None


def _preview_identity(repo: Path):
    spec = importlib.util.spec_from_file_location("preview_identity", repo / "tools" / "preview_identity.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_preview_identity_tool_refuses_anything_but_a_loopback_origin(repo, capsys):
    tool = _preview_identity(repo)
    assert tool.loopback_base("http://127.0.0.1:8765") == tool.loopback_base("http://127.0.0.1:8765/") == "http://127.0.0.1:8765"
    assert tool.loopback_base("http://localhost:5173") == "http://localhost:5173" and tool.loopback_base("http://[::1]:8765") == "http://[::1]:8765"
    refused = ("http://example.com", "http://127.0.0.1.evil.example:8765", "http://localhost.evil.example", "https://10.0.0.5:8765", "http://192.168.1.10:8765", "http://0.0.0.0:8765",
               "http://user:pw@127.0.0.1:8765", "http://127.0.0.1:8765/api/supervisor/pause", "http://127.0.0.1:8765/?next=http://example.com", "http://127.0.0.1:8765/#x",
               "file:///C:/Windows/win.ini", "ftp://127.0.0.1", "127.0.0.1:8765", "http://127.0.0.1:99999", "http://", "")
    for url in refused:
        with pytest.raises(ValueError):
            tool.loopback_base(url)
        assert tool.main([url]) == 2, url  # refused before any request is made
    assert "loopback" in capsys.readouterr().err


def test_preview_identity_tool_reports_what_a_server_actually_serves_against_the_dist_on_disk(runtime, tmp_path, repo):
    tool = _preview_identity(repo)
    static = _dist(tmp_path / "dist")
    app_client = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=static))
    asked: list[str] = []

    def fetch(path: str):
        asked.append(path)
        response = app_client.get(path)
        return response.status_code, {k.lower(): v for k, v in response.headers.items()}, response.content

    report = tool.identify("http://127.0.0.1:8765", fetch=fetch, dist=static, repo=tmp_path)
    build = app_client.get("/api/health").json()["build"]
    assert asked[:2] == ["/", "/api/health"] and set(asked[2:]) == {"/" + name for name in INDEX_JS + INDEX_CSS}  # GETs of the page, the health view and its own assets only
    assert report["base_url"] == "http://127.0.0.1:8765" and report["reachable"] is True and report["health_has_build"] is True
    assert (report["commit"], report["commit_short"], report["dirty"], report["profile"], report["process_started_at"]) == (build["commit"], build["commit_short"], build["dirty"], "fixture", build["process_started_at"])
    assert report["pid"] == os.getpid() and report["branch"] == build["branch"]
    assert report["preparation_tool_version"] == preparation.TOOL_VERSION
    assert (report["app_version"], report["port"], report["process_started_basis"], report["courses"]) == (build["app_version"], build["port"], build["process_started_basis"], build["courses"])
    stamp = {"stamped": True, "commit": BUILT_FROM, "commit_short": BUILT_FROM[:7], "dirty": False, "built_at": BUILT_AT}
    assert report["web_build"] == stamp and report["served"]["other_references"] == 0
    assert report["served"]["script"] == INDEX_JS and report["served"]["style"] == INDEX_CSS and report["served"]["index_cache_control"] == "no-cache"
    assert report["dist_on_disk"] == {"index": "dist/index.html", "present": True, "index_sha256": hashlib.sha256(INDEX_HTML.encode()).hexdigest(),
                                      "index_modified_at": build["static"]["index_modified_at"], "script": INDEX_JS, "style": INDEX_CSS, "web_build": stamp}
    assert report["assets_equal_dist_on_disk"] is True and report["index_equal_dist_on_disk"] is True and report["asset_bytes_equal_dist_on_disk"] is True
    assert report["health_assets_equal_served"] is True
    assert [a["name"] for a in report["served"]["assets"]] == INDEX_JS + INDEX_CSS and all(a["status"] == 200 and a["same_bytes_as_dist"] is True for a in report["served"]["assets"])
    assert {a["name"]: "immutable" in a["cache_control"] for a in report["served"]["assets"]} == {name: name.startswith("assets/") for name in INDEX_JS + INDEX_CSS}
    # This synthetic bundle names a commit that is not the one the test process runs (outside a checkout the process states none).
    assert report["bundle_state"] == ("built_from_another_commit" if build["commit"] else "not_established")
    assert report["checkout"] == {"commit": None, "commit_short": None}  # the compared folder is not a checkout
    _no_absolute_path(json.dumps(report), tmp_path, repo)
    # The same server compared with a different build on disk (the dist was rebuilt after the page was served, or another folder is served).
    other = _dist(tmp_path / "other", INDEX_HTML.replace("index-AbCd1234.js", "index-Nn00Pp11.js"))
    stale = tool.identify("http://127.0.0.1:8765", fetch=fetch, dist=other, repo=tmp_path)
    assert stale["assets_equal_dist_on_disk"] is False and stale["index_equal_dist_on_disk"] is False and stale["asset_bytes_equal_dist_on_disk"] is False
    assert next(a for a in stale["served"]["assets"] if a["name"] == "assets/index-AbCd1234.js")["same_bytes_as_dist"] is None  # that file is not in the other build
    missing = tool.identify("http://127.0.0.1:8765", fetch=fetch, dist=tmp_path / "no-dist", repo=tmp_path)
    assert missing["dist_on_disk"]["present"] is False and missing["assets_equal_dist_on_disk"] is None and missing["index_equal_dist_on_disk"] is None


def test_preview_identity_tool_says_what_cannot_be_established_about_a_server_without_build_identity(tmp_path, repo):
    """Labelled double of a Brain started before /api/health carried a build: only what its responses show is reported."""
    tool = _preview_identity(repo)
    static = _dist(tmp_path / "dist")

    def old_server(path: str):
        if path == "/api/health":
            return 200, {"content-type": "application/json", "cache-control": "no-store"}, json.dumps({"ok": True, "profile": "local", "schema_revision": "r1", "paused": False}).encode()
        target = static / ("index.html" if path == "/" else path.lstrip("/"))
        return (200, {"cache-control": "no-store"}, target.read_bytes()) if target.is_file() else (404, {}, b"")

    report = tool.identify("http://127.0.0.1:8765", fetch=old_server, dist=static, repo=tmp_path)
    assert report["health_has_build"] is False and report["profile"] == "local"
    assert (report["commit"], report["commit_short"], report["dirty"], report["pid"], report["process_started_at"], report["preparation_tool_version"]) == (None, None, None, None, None, None)
    assert report["assets_equal_dist_on_disk"] is True and report["index_equal_dist_on_disk"] is True and report["asset_bytes_equal_dist_on_disk"] is True
    assert report["health_assets_equal_served"] is None and report["served"]["index_cache_control"] == "no-store"
    assert any("no build identity" in note for note in report["notes"])
    assert (report["app_version"], report["port"], report["courses"]) == (None, None, None)
    # Its page does say which commit it was built from; whether that is the commit the process runs cannot be established.
    assert report["web_build"]["commit"] == BUILT_FROM and report["bundle_state"] == "not_established" and report["bundle_commit_equals_server_commit"] is None

    def down(path: str):
        raise OSError("connection refused")

    unreachable = tool.identify("http://127.0.0.1:8765", fetch=down, dist=static, repo=tmp_path)
    assert unreachable["reachable"] is False and unreachable["commit"] is None and unreachable["served"]["script"] == [] and unreachable["assets_equal_dist_on_disk"] is None
    assert unreachable["bundle_state"] == "not_established" and unreachable["web_build"]["stamped"] is False


# ---- build identity, review round: what the first version could not tell apart ---------------------------------------
import contextlib  # noqa: E402
import http.client  # noqa: E402
import io  # noqa: E402
import socket  # noqa: E402
import threading  # noqa: E402

from fastapi.responses import Response  # noqa: E402

import lecture_brain  # noqa: E402
from lecture_brain.ownerio.inventory import build_inventory, primary_deck  # noqa: E402

_GIT_FREE = {key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_")}  # no inherited GIT_DIR / GIT_WORK_TREE reaches a test's own git


def _health_build(runtime, **kwargs) -> dict:
    return TestClient(create_app(runtime, extra_hosts={"testserver"}, **kwargs)).get("/api/health").json()["build"]


def test_api_responses_are_never_storable_even_when_a_handler_sets_its_own_cache_header(runtime, tmp_path):
    app = create_app(runtime, extra_hosts={"testserver"})

    @app.get("/api/x-review-own-cache-header")  # labelled double of a later route (or response class) that sets its own header
    def own_header():
        return Response(b"private course bytes", media_type="application/octet-stream", headers={"Cache-Control": "private, max-age=600"})

    assert TestClient(app).get("/api/x-review-own-cache-header").headers["cache-control"] == "no-store"
    # The built app's own files keep the policy the static route gives them.
    served = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=_dist(tmp_path / "dist")))
    assert served.get("/").headers["cache-control"] == "no-cache" and "immutable" in served.get("/assets/index-AbCd1234.js").headers["cache-control"]
    assert served.get("/api/health").headers["cache-control"] == "no-store" and served.get("/api/not-a-route").headers["cache-control"] == "no-store"


def test_only_files_the_bundler_emitted_are_kept_by_the_browser_whatever_their_names_look_like(runtime, tmp_path):
    static = _dist(tmp_path / "dist")
    app_client = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=static))
    for name in ("assets/index-AbCd1234.js", "assets/vendor-Qr_St-56.js", "assets/index-Zy_Xw-98.css"):  # named by the bundler's manifest
        assert "immutable" in app_client.get("/" + name).headers["cache-control"], name
    for name in (*UNHASHED_LOOKALIKES, "assets/plain.js", "theme-boot.js", ".vite/manifest.json"):  # served, and asked for again each time
        response = app_client.get("/" + name)
        assert response.status_code == 200 and response.headers["cache-control"] == "no-cache", name
    # A built app without the bundler's manifest (an older build): nothing is pinned in the browser; everything still loads.
    older = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=_dist(tmp_path / "older", manifest=False)))
    for name in ("assets/index-AbCd1234.js", "assets/index-Zy_Xw-98.css", *UNHASHED_LOOKALIKES):
        response = older.get("/" + name)
        assert response.status_code == 200 and response.headers["cache-control"] == "no-cache", name
    (tmp_path / "older" / ".vite").mkdir()
    (tmp_path / "older" / ".vite" / "manifest.json").write_text("not json", encoding="utf-8")  # unreadable: the same safe answer
    assert older.get("/assets/index-AbCd1234.js").headers["cache-control"] == "no-cache"
    # A manifest that lists a file whose name carries no content hash (a bundler configured that way): its bytes could
    # change under the same address, so it is not pinned either.
    _bundler_manifest(tmp_path / "older", ["assets/plain.js", "assets/index-AbCd1234.js"])
    assert older.get("/assets/plain.js").headers["cache-control"] == "no-cache" and "immutable" in older.get("/assets/index-AbCd1234.js").headers["cache-control"]


def test_the_app_page_carries_its_policy_under_every_spelling_of_its_name(runtime, tmp_path):
    app_client = TestClient(create_app(runtime, extra_hosts={"testserver"}, static_dir=_dist(tmp_path / "dist")))
    for path in ("/", "/index.html", "/INDEX.HTML", "/Index.html", "/index.HTML"):
        page = app_client.get(path)
        assert page.status_code == 200 and page.text == INDEX_HTML, path
        assert page.headers["cache-control"] == "no-cache" and "default-src 'self'" in page.headers.get("content-security-policy", ""), path


def test_the_served_page_states_the_commit_and_tree_state_it_was_built_from(runtime, tmp_path):
    build = _health_build(runtime, static_dir=_dist(tmp_path / "dist"))
    assert build["web_build"] == {"commit": BUILT_FROM, "commit_short": BUILT_FROM[:7], "dirty": False, "built_at": BUILT_AT}
    assert build["assets"] == {"script": INDEX_JS, "style": INDEX_CSS}
    assert set(build["static"]) == {"served", "directory", "index_modified_at", "index_sha256"}  # one name per fact: the asset names are not repeated here
    modified = _health_build(runtime, static_dir=_dist(tmp_path / "modified", INDEX_HTML.replace("dirty=false", "dirty=true")))
    assert modified["web_build"]["dirty"] is True and modified["web_build"]["commit"] == BUILT_FROM
    # What a build could not establish stays unknown: nothing is filled in.
    unknown = _health_build(runtime, static_dir=_dist(tmp_path / "unknown", INDEX_HTML.replace(STAMP, '<meta name="ll-build" content="commit=unknown; dirty=unknown; built_at=2026-10-05T21:50:44Z">')))
    assert unknown["web_build"] == {"commit": None, "commit_short": None, "dirty": None, "built_at": BUILT_AT}
    garbage = _health_build(runtime, static_dir=_dist(tmp_path / "garbage", INDEX_HTML.replace(STAMP, '<meta name="ll-build" content="commit=C:/somewhere/else; dirty=maybe; built_at=yesterday; extra">')))
    assert garbage["web_build"] == {"commit": None, "commit_short": None, "dirty": None, "built_at": None}
    # A page built before the stamp existed says nothing about its origin - and the identity says exactly that.
    assert _health_build(runtime, static_dir=_dist(tmp_path / "older", INDEX_HTML.replace(STAMP, "")))["web_build"] is None
    assert _health_build(runtime)["web_build"] is None and _health_build(runtime)["assets"] == {"script": [], "style": []}  # no built app is mounted


def test_health_states_the_app_version_and_the_port_the_brain_listens_on(runtime):
    app = create_app(runtime)
    on_port = TestClient(app, base_url="http://127.0.0.1:8123")
    assert on_port.get("/api/health").json()["build"]["port"] == 8123
    # Behind the development server the page's address differs; the port is the Brain's own listening port, not the page's.
    proxied = on_port.get("/api/health", headers={"host": "127.0.0.1:5173", "origin": "http://127.0.0.1:5173"})
    assert proxied.status_code == 200 and proxied.json()["build"]["port"] == 8123
    assert on_port.get("/api/health").json()["build"]["app_version"] == lecture_brain.__version__


def _state_file(settings, course_id: str, lecture_id: str) -> Path:
    return settings.app_area(course_id) / "prepared" / lecture_id / "state.json"


def test_each_course_states_its_preparation_generation_and_two_differently_prepared_instances_differ(runtime, settings):
    """The reviewer's case: a Brain whose private preparation state was never built and a freshly prepared one must not
    return the same identity."""
    never = _health_build(runtime)["courses"]
    assert set(never) == set(settings.courses)
    assert never["be505"] == {"preparation_generation": None, "prepared_lectures": 0, "preparation_tool_versions": [], "map_revisions": {}, "derived_generations": {}}
    outcome = runtime.preparation.prepare_course("be505")  # the app's own preparation over the synthetic fixture course
    assert outcome["processed"]
    prepared = _health_build(runtime)["courses"]
    assert prepared != never and prepared["be562"] == never["be562"]  # only the course that was prepared changed
    course = prepared["be505"]
    assert re.fullmatch(r"[0-9a-f]{16}", course["preparation_generation"]) and course["prepared_lectures"] == len(outcome["processed"]) == len(list((settings.app_area("be505") / "prepared").glob("*/state.json")))
    assert course["preparation_tool_versions"] == [preparation.TOOL_VERSION]
    assert _health_build(runtime)["courses"]["be505"] == course  # reading it again changes nothing
    assert runtime.preparation.prepare_course("be505")["processed"] == [] and _health_build(runtime)["courses"]["be505"] == course  # nothing changed, same generation
    # State left by an older tool version (or any other content) is another generation, and the older version is named.
    state = _state_file(settings, "be505", outcome["processed"][0])
    document = json.loads(state.read_text(encoding="utf-8"))
    state.write_text(json.dumps(dict(document, tool_version="prep-0-older")), encoding="utf-8")
    stale = _health_build(runtime)["courses"]["be505"]
    assert stale["preparation_generation"] != course["preparation_generation"] and stale["prepared_lectures"] == course["prepared_lectures"]
    assert stale["preparation_tool_versions"] == sorted({preparation.TOOL_VERSION, "prep-0-older"} if course["prepared_lectures"] > 1 else {"prep-0-older"})
    state.write_text("{ not json", encoding="utf-8")  # unreadable state is counted by its bytes, never a reason for health to fail
    broken = TestClient(create_app(runtime, extra_hosts={"testserver"})).get("/api/health")
    assert broken.status_code == 200 and broken.json()["build"]["courses"]["be505"]["preparation_generation"] not in {None, stale["preparation_generation"]}
    _no_absolute_path(broken.text, settings.repo, settings.state_dir, settings.course("be505").root)


def test_each_course_lists_its_stored_source_map_revisions_and_derived_generations(runtime, settings):
    area = settings.app_area("be505")
    # Labelled doubles of stored files, in the layout the source-map module and the derived store document.
    first, second = area / "source-map" / "src-lecture-01-slides" / ("1a" * 8), area / "source-map" / "src-lecture-01-slides" / ("2b" * 8)
    for directory, files in ((first, {"map-o0000.json": ("aaaa000011112222", 0), "map-o0001.json": ("bbbb000011112222", 1)}), (second, {"map-o0000-c0123abcd.json": ("cccc000011112222", 0)})):
        directory.mkdir(parents=True)
        for index, (name, (revision, overrides)) in enumerate(files.items()):
            (directory / name).write_text(json.dumps({"contract": "source-map/1", "map_revision": revision, "source": {"source_id": "src-lecture-01-slides"}, "overrides": {"revision": overrides},
                                                      "other_source_versions": [{"map_revision": "ffff000011112222"}]}), encoding="utf-8")
    written = time.time() - 600
    os.utime(first / "map-o0001.json", (written, written))  # the map of the first bytes was written before the map of the second bytes
    (first / "notes.txt").write_text("not a map", encoding="utf-8")
    (area / "source-map" / "src-lecture-01-slides" / "overrides").mkdir()  # not a version folder
    damaged = area / "source-map" / "src-damaged" / ("3c" * 8)
    damaged.mkdir(parents=True)
    (damaged / "map-o0000.json").write_text("{ not json", encoding="utf-8")
    store = area / "derived" / "src-lecture-01-recording"
    (store / "gen-b").mkdir(parents=True)
    (store / "gen-a").mkdir()
    (store / "gen-unfinished").mkdir()  # an import that did not finish has no manifest: it is not a generation
    for name in ("gen-a", "gen-b"):
        (store / name / "manifest.json").write_text("{}", encoding="utf-8")
    course = _health_build(runtime)["courses"]["be505"]
    assert course["map_revisions"] == {"src-lecture-01-slides": [{"source_sha256_prefix": "1a" * 8, "map_revision": "bbbb000011112222", "overrides_revision": 1},
                                                                 {"source_sha256_prefix": "2b" * 8, "map_revision": "cccc000011112222", "overrides_revision": 0}],
                                       "src-damaged": [{"source_sha256_prefix": "3c" * 8, "map_revision": None, "overrides_revision": None}]}  # stored but unreadable: listed, nothing stated
    assert course["derived_generations"] == {"src-lecture-01-recording": ["gen-a", "gen-b"]}
    assert _health_build(runtime)["courses"]["be562"]["map_revisions"] == {}


def test_the_reported_map_revision_is_the_one_the_source_map_module_stored(runtime, settings):
    sourcemap = pytest.importorskip("lecture_brain.sourcemap", reason="the source-map module is not part of this checkout: the stored-layout double above is the only check")
    lecture = next(l for l in build_inventory(settings.course("be505"))["lectures"] if primary_deck(l) is not None)
    deck = primary_deck(lecture)
    built = sourcemap.load_or_build(settings, "be505", deck, lecture=lecture)
    assert built["inspection"]["status"] != "unavailable"
    stored = _health_build(runtime)["courses"]["be505"]["map_revisions"]
    assert [entry["map_revision"] for entry in stored[deck["source_id"]]] == [built["map_revision"]]
    assert stored[deck["source_id"]][0]["source_sha256_prefix"] == built["source"]["sha256"][:16]
    assert _health_build(runtime)["source_map_version"] == sourcemap.SOURCE_MAP_VERSION


def test_the_code_identity_is_fixed_at_process_start_and_the_start_is_the_process_creation(runtime, tmp_path, monkeypatch):
    a, b = "a1" * 20, "b2" * 20
    checkout = _git_layout(tmp_path / "moving", "ref: refs/heads/main", loose={"refs/heads/main": a})
    monkeypatch.setattr(runtime.settings, "repo", checkout)
    started = _health_build(runtime)
    assert started["commit"] == a
    (checkout / ".git" / "refs" / "heads" / "main").write_text(b + "\n", encoding="utf-8")  # a commit made while the process runs
    assert api_module.repository_commit(checkout)["commit"] == b
    later = _health_build(runtime)
    assert later["commit"] == a and later["commit_short"] == a[:7]  # the code this process loaded, not the checkout's newer HEAD
    # The start is the operating system's creation time of this process where it says so (stated), else the module's load time (stated).
    seconds, basis = api_module.process_start()
    assert basis in {"os_process_creation", "module_import"} and started["process_started_basis"] == basis
    assert started["process_started_at"] == api_module._iso(seconds) == later["process_started_at"]
    if os.name == "nt":
        assert basis == "os_process_creation" and seconds < api_module.MODULE_LOADED_AT  # the process existed before this module was imported
    assert seconds <= api_module.MODULE_LOADED_AT <= time.time()


def test_the_dirty_check_ignores_inherited_git_variables_and_a_git_in_the_working_directory(tmp_path, monkeypatch):
    git = shutil.which("git")
    if git is None:
        pytest.skip("git is not installed: the dirty state is 'unknown' on this machine, which another test shows")

    def checkout(name: str) -> Path:
        work = tmp_path / name
        work.mkdir()
        for args in (("init", "-q"), ("add", "tracked.txt"), ("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "first")):
            if args[0] == "add":
                (work / "tracked.txt").write_text("first version\n", encoding="utf-8")
            subprocess.run([git, "-C", str(work), *args], capture_output=True, text=True, check=True, env={**_GIT_FREE, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"})
        return work

    clean, other = checkout("clean"), checkout("other")
    (other / "tracked.txt").write_text("changed in the other repository\n", encoding="utf-8")
    assert api_module.repository_dirty(clean) is False and api_module.repository_dirty(other) is True
    # A wrapper or hook exported these: the answer must still describe the checkout that was asked about.
    monkeypatch.setenv("GIT_DIR", str(other / ".git"))
    monkeypatch.setenv("GIT_WORK_TREE", str(other))
    monkeypatch.setenv("GIT_INDEX_FILE", str(other / ".git" / "index"))
    assert api_module.repository_dirty(clean) is False
    monkeypatch.delenv("GIT_DIR")
    monkeypatch.delenv("GIT_WORK_TREE")
    monkeypatch.delenv("GIT_INDEX_FILE")
    # A file named like git in the directory the Brain was started from is never what gets run.
    trap = tmp_path / "started-here"
    trap.mkdir()
    for name in ("git.exe", "git"):
        (trap / name).write_bytes(b"not a program")
    monkeypatch.chdir(trap)
    assert api_module.repository_dirty(clean) is False and api_module.repository_dirty(other) is True
    found = api_module.git_executable()
    assert found is not None and Path(found).is_absolute() and Path(found).resolve().parent != trap.resolve()
    monkeypatch.setenv("PATH", str(trap))  # only the working directory is on the search path: no git is used at all
    assert api_module.git_executable() is None and api_module.repository_dirty(clean) is None


def _stamped_server(static: Path, health: dict):
    """Labelled double of a Brain: serves the files of ``static`` and the given health document."""

    def fetch(path: str):
        if path == "/api/health":
            return 200, {"content-type": "application/json", "cache-control": "no-store"}, json.dumps(health).encode()
        target = static / ("index.html" if path == "/" else path.lstrip("/"))
        return (200, {"cache-control": "no-cache"}, target.read_bytes()) if target.is_file() else (404, {}, b"")

    return fetch


def _health_document(commit: str, *, dirty: bool | None = False) -> dict:
    return {"ok": True, "profile": "fixture", "schema_revision": "r1", "paused": False,
            "build": {"app_version": "0.0.0-double", "commit": commit, "commit_short": commit[:7], "branch": "main", "dirty": dirty, "pid": 4242, "process_started_at": "2026-10-05T22:35:43Z",
                      "process_started_basis": "os_process_creation", "profile": "fixture", "port": 8765, "preparation_tool_version": "prep-5", "source_map_version": "source-map/1",
                      "assets": {"script": INDEX_JS, "style": INDEX_CSS}, "web_build": None, "static": {"served": True, "directory": "web/dist", "index_modified_at": None, "index_sha256": None},
                      "courses": {"be505": {"preparation_generation": "0123456789abcdef", "prepared_lectures": 2, "preparation_tool_versions": ["prep-5"], "map_revisions": {}, "derived_generations": {}}}}}


def test_preview_identity_tool_says_which_commit_the_served_bundle_was_built_from_and_flags_a_stale_one(tmp_path, repo):
    """The reviewer's case: a commit was made and the web app was not rebuilt. The Brain then runs the new commit while it
    serves the old bundle, and comparing asset names with the dist on disk cannot show it (they are the same old files)."""
    tool = _preview_identity(repo)
    newer = "d4" * 20
    checkout = _git_layout(tmp_path / "checkout", "ref: refs/heads/main", loose={"refs/heads/main": newer})
    static = _dist(checkout / "web" / "dist")  # stamped: built from BUILT_FROM, clean tree
    stale = tool.identify("http://127.0.0.1:8765", fetch=_stamped_server(static, _health_document(newer)), repo=checkout)
    assert stale["assets_equal_dist_on_disk"] is True and stale["asset_bytes_equal_dist_on_disk"] is True  # (what the first version stopped at)
    assert stale["commit"] == newer and stale["web_build"] == {"stamped": True, "commit": BUILT_FROM, "commit_short": BUILT_FROM[:7], "dirty": False, "built_at": BUILT_AT}
    assert stale["bundle_state"] == "built_from_another_commit" and stale["bundle_commit_equals_server_commit"] is False and stale["bundle_commit_equals_checkout_head"] is False
    assert stale["checkout"] == {"commit": newer, "commit_short": newer[:7]} and stale["server_commit_equals_checkout_head"] is True
    assert any("rebuil" in note.lower() and BUILT_FROM[:7] in note and newer[:7] in note for note in stale["notes"])
    assert stale["dist_on_disk"]["web_build"] == stale["web_build"]
    # The same bundle served by a Brain that runs the commit it was built from.
    current = tool.identify("http://127.0.0.1:8765", fetch=_stamped_server(static, _health_document(BUILT_FROM)), repo=checkout)
    assert current["bundle_state"] == "built_from_server_commit" and current["bundle_commit_equals_server_commit"] is True and current["server_commit_equals_checkout_head"] is False
    assert (current["app_version"], current["port"], current["process_started_basis"]) == ("0.0.0-double", 8765, "os_process_creation")
    assert current["courses"]["be505"]["preparation_generation"] == "0123456789abcdef" and current["health_assets_equal_served"] is True
    # Built from a modified tree: the commit id alone does not describe the bundle.
    modified = _dist(tmp_path / "modified", INDEX_HTML.replace("dirty=false", "dirty=true"))
    report = tool.identify("http://127.0.0.1:8765", fetch=_stamped_server(modified, _health_document(BUILT_FROM)), dist=modified, repo=checkout)
    assert report["bundle_state"] == "built_from_modified_tree" and report["web_build"]["dirty"] is True and any("modified" in note for note in report["notes"])
    undetermined = _dist(tmp_path / "undetermined", INDEX_HTML.replace("dirty=false", "dirty=unknown"))
    assert tool.identify("http://127.0.0.1:8765", fetch=_stamped_server(undetermined, _health_document(BUILT_FROM)), dist=undetermined, repo=checkout)["bundle_state"] == "built_from_server_commit_tree_state_unknown"
    # A page built before the stamp existed: never reported as matching anything.
    older = _dist(tmp_path / "older", INDEX_HTML.replace(STAMP, ""))
    unstamped = tool.identify("http://127.0.0.1:8765", fetch=_stamped_server(older, _health_document(newer)), dist=older, repo=checkout)
    assert unstamped["web_build"] == {"stamped": False, "commit": None, "commit_short": None, "dirty": None, "built_at": None}
    assert unstamped["bundle_state"] == "not_established" and unstamped["bundle_commit_equals_server_commit"] is None and unstamped["bundle_commit_equals_checkout_head"] is None
    assert any("no build stamp" in note for note in unstamped["notes"])
    # A Brain whose health view states the first version's field names (static.js / static.css) is still read.
    first_version = _health_document(BUILT_FROM)
    first_version["build"]["static"].update(js=INDEX_JS, css=INDEX_CSS)
    del first_version["build"]["assets"]
    assert tool.identify("http://127.0.0.1:8765", fetch=_stamped_server(static, first_version), repo=checkout)["health_assets_equal_served"] is True
    _no_absolute_path(json.dumps([stale, current, report, unstamped]), tmp_path, repo)


def _run_tool(tool, *argv: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = tool.main(list(argv))
    return code, out.getvalue(), err.getvalue()


def test_preview_identity_tool_prints_one_json_object_for_any_unreadable_loopback_target(tmp_path, repo, monkeypatch):
    tool = _preview_identity(repo)
    static = _dist(tmp_path / "dist")
    # A loopback port that does not speak HTTP (a real socket, owned by this test, on a free port).
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(4)
    port = listener.getsockname()[1]

    def not_http() -> None:
        while True:
            try:
                connection, _ = listener.accept()
            except OSError:
                return
            with connection:
                connection.sendall(b"SSH-2.0-not-a-web-server\r\n")

    threading.Thread(target=not_http, daemon=True).start()
    try:
        code, out, err = _run_tool(tool, f"http://127.0.0.1:{port}", "--dist", str(static))
    finally:
        listener.close()
    report = json.loads(out)
    assert code == 1 and report["reachable"] is False and report["commit"] is None and "Traceback" not in err and err == ""
    assert any("could not be read" in note for note in report["notes"])
    _no_absolute_path(out, tmp_path, repo)
    # Failures of the transport that are not OSError: each is one JSON object and exit code 1, never a traceback.
    for error in (http.client.BadStatusLine("SSH-2.0"), http.client.InvalidURL("URL can't contain control characters"), http.client.IncompleteRead(b""),
                  UnicodeEncodeError("ascii", "/\u00e9", 1, 2, "ordinal not in range"), RuntimeError(str(tmp_path / "secret-location"))):
        def failing(path: str, error=error):
            raise error

        monkeypatch.setattr(tool, "http_fetch", lambda base, **kwargs: failing)
        code, out, err = _run_tool(tool, "http://127.0.0.1:8765", "--dist", str(static))
        report = json.loads(out)
        assert code == 1 and report["reachable"] is False and err == "", type(error).__name__
        assert any(type(error).__name__ in note for note in report["notes"]), type(error).__name__
        _no_absolute_path(out, tmp_path, repo)

    # The page answers, one of its files does not: the rest is still reported.
    def half(path: str):
        if path == "/assets/index-AbCd1234.js":
            raise http.client.IncompleteRead(b"half")
        return _stamped_server(static, _health_document(BUILT_FROM))(path)

    partial = tool.identify("http://127.0.0.1:8765", fetch=half, dist=static, repo=tmp_path)
    assert partial["reachable"] is True and partial["asset_bytes_equal_dist_on_disk"] is False
    assert next(a for a in partial["served"]["assets"] if a["name"] == "assets/index-AbCd1234.js")["status"] is None


def test_preview_identity_tool_never_fetches_or_reads_a_name_that_is_not_a_plain_file_of_the_built_app(tmp_path, repo):
    tool = _preview_identity(repo)
    outside = tmp_path / "outside.txt"
    outside.write_text("a file that is not part of the built app", encoding="utf-8")
    static = tmp_path / "web" / "dist"
    references = ['..\\..\\outside.txt', outside.as_posix(), str(outside), "/../../outside.txt", "assets/../../../outside.txt", "https://cdn.example/lib.js", "//cdn.example/lib.js",
                  "assets/sp ace.js", "assets/t\tab.js", "assets/caf\u00e9.js", "assets/%2e%2e/x.js", "assets/con.js", "data:text/javascript,void 0"]
    html = INDEX_HTML.replace("</head>", "".join(f'<script src="{reference}"></script>' for reference in references) + '<link rel="stylesheet" href="..\\..\\outside.txt"></head>')
    _dist(static, html)
    asked: list[str] = []

    def fetch(path: str):
        asked.append(path)
        if path == "/api/health":
            return 200, {}, json.dumps(_health_document(BUILT_FROM)).encode()
        target = static / ("index.html" if path == "/" else path.lstrip("/"))
        return 200, {}, target.read_bytes() if target.is_file() else outside.read_bytes()  # whatever is asked, this server answers with bytes

    report = tool.identify("http://127.0.0.1:8765", fetch=fetch, dist=static, repo=tmp_path)
    assert sorted(asked) == sorted(["/", "/api/health", *("/" + name for name in INDEX_JS + INDEX_CSS)])  # nothing else was requested
    assert report["served"]["script"] == INDEX_JS and report["served"]["style"] == INDEX_CSS
    assert report["served"]["other_references"] == len(references) + 1 and [a["name"] for a in report["served"]["assets"]] == INDEX_JS + INDEX_CSS
    assert all(a["same_bytes_as_dist"] is True for a in report["served"]["assets"]) and report["assets_equal_dist_on_disk"] is True
    assert any("not plain files of the built app" in note for note in report["notes"])
    dumped = json.dumps(report)
    assert "outside" not in dumped and "cdn.example" not in dumped  # such a name is counted, not repeated
    _no_absolute_path(dumped, tmp_path, repo)
    # The same page compared with a build on disk that does not carry those references is not "equal".
    assert tool.identify("http://127.0.0.1:8765", fetch=fetch, dist=_dist(tmp_path / "plain"), repo=tmp_path)["assets_equal_dist_on_disk"] is False
