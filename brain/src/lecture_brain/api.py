"""Loopback-only operator/status surface and same-PC transport (FastAPI).

This is not a remote API and not a canonical-writer endpoint. It binds to 127.0.0.1, rejects any
non-loopback Host/Origin (DNS-rebinding guard) and offers:

* read projections for the local browser (the same JSON a remote client reads from Drive views);
* a file-shaped transport that mirrors the Drive inbox: bundle files are written exclusively,
  the manifest last, and the supervisor re-verifies signature, pairing and bytes before admitting;
* operator actions that must happen at the Brain PC: reviewing a device fingerprint, pausing,
  reconciling, previewing a bounded repair, exporting.

There is no shell, no arbitrary file read, no credential handling and no way for request content
to choose a root, thread, executable or permission.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import base64
import functools
import importlib
import json
import os
import re
import secrets
import subprocess
import time
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

from . import __version__ as APP_VERSION
from . import concept_graph, inferred_anchors, slide_identity, timing_links
from . import contracts as c
from .acceptance import run_acceptance
from .fsutil import ExclusiveConflict, publish_exclusive
from .journal import JournalError
from .native.fixture_tutor import MODES
from .native.probe import probe_native
from .ownerio.inventory import PROVISIONAL_NOTE, build_inventory, identity_status
from .ownerio.inventory import request_memo as inventory_request_memo
from .preparation import TOOL_VERSION as PREPARATION_TOOL_VERSION
from .projections import Projector
from .runtime import Runtime
from .transport.bundles import MANIFEST, SIGNATURE, read_manifest
from .transport.pairing import PairingError

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
_REQUEST_DIR = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,100}")
MAX_UPLOAD_BYTES = 32 * 1024 * 1024


_AUTHORITY = re.compile(r"(?P<host>\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(?::(?P<port>[0-9]{1,5}))?")


def _host_ok(value: str | None, extra: set[str]) -> bool:
    """Exactly a loopback name with an optional numeric port. Anything merely starting with one is refused."""
    match = _AUTHORITY.fullmatch(value or "")
    if not match:
        return False
    host = match["host"].lower()
    return host in LOOPBACK_HOSTS or value in extra or host in extra


def _same_origin(origin: str, host: str | None, extra: set[str]) -> bool:
    """The page that sends a request must be this app's own page: same host and same port."""
    scheme, _, authority = origin.partition("://")
    if scheme not in {"http", "https"} or not _host_ok(authority, extra):
        return False
    return authority.lower() == (host or "").lower() or authority in extra or authority.rsplit(":", 1)[0] in extra


class LoopbackOnly(BaseHTTPMiddleware):
    def __init__(self, app, extra_hosts: set[str]):
        super().__init__(app)
        self._extra = extra_hosts

    async def dispatch(self, request: Request, call_next):
        if not _host_ok(request.headers.get("host"), self._extra):
            return JSONResponse({"detail": "This surface is loopback-only."}, status_code=403)
        # Being on loopback is not being the user: another local page, a sandboxed document or another site must not
        # drive this surface or read private evidence from it.
        origin = request.headers.get("origin")
        if origin is not None and not _same_origin(origin, request.headers.get("host"), self._extra):
            return JSONResponse({"detail": "Cross-origin requests are not accepted."}, status_code=403)
        if request.url.path.startswith("/api/") and request.headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "none"}:
            return JSONResponse({"detail": "Cross-site requests are not accepted."}, status_code=403)
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"  # data, course bytes and errors are never kept by a browser, whatever a handler set
        else:
            response.headers.setdefault("Cache-Control", "no-store")  # the built app's own files state their own policy (see spa below)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


def create_app(runtime: Runtime, *, extra_hosts: set[str] | None = None, static_dir: Path | None = None) -> FastAPI:
    settings = runtime.settings
    app = FastAPI(title="Lecture Learning Brain (loopback)", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(LoopbackOnly, extra_hosts=extra_hosts or set())
    reveals: dict[str, float] = {}
    projector: Projector = runtime.projector

    def course(course_id: str):
        binding = settings.courses.get(course_id)
        if binding is None:
            raise HTTPException(404, "Unknown course")
        if not binding.usable:
            raise HTTPException(409, binding.problem or "Course binding is not usable")
        return binding

    def locked(fn):
        # One request lists each course folder once (it is the slowest step on a synced drive); nothing outlives the request.
        with inventory_request_memo():
            return runtime.with_lock(fn)

    # ---- views -----------------------------------------------------------------------------------
    @app.get("/api/workspace")
    def workspace():
        view = locked(projector.workspace_view)
        view["brain"] = runtime.coordinator.brain_public()
        view["supervisor"] = {"last_tick_at": (runtime.last_tick or {}).get("at"), **runtime.pending_counts()}
        return view

    @app.get("/api/courses/{course_id}")
    def course_view(course_id: str):
        course(course_id)
        return locked(lambda: projector.course_view(course_id))

    @app.get("/api/courses/{course_id}/lectures/{lecture_id}")
    def lecture_view(course_id: str, lecture_id: str, deck: str | None = Query(None, max_length=200)):
        course(course_id)
        view = locked(lambda: projector.lecture_view(course_id, lecture_id, deck=deck))
        if view is None:
            raise HTTPException(404, "Unknown lecture unit")
        return view

    @app.get("/api/courses/{course_id}/questions")
    def question_bank(course_id: str, collection: str | None = Query(None, max_length=80), lecture: str | None = Query(None, max_length=80), q: str | None = Query(None, max_length=200),
                      origin: str | None = Query(None, max_length=40), anchor: str | None = Query(None, pattern="^(slide_named|no_slide|unresolved)$"),
                      offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)):
        course(course_id)
        return locked(lambda: projector.questions_view(course_id, collection=collection, lecture_id=lecture, text=q, origin=origin, anchor=anchor, offset=offset, limit=limit))

    @app.get("/api/courses/{course_id}/questions/{question_id}")
    def question_view(course_id: str, question_id: str):
        course(course_id)
        view = locked(lambda: projector.question_view(course_id, question_id))
        if view is None:
            raise HTTPException(404, "Unknown question")
        return view

    @app.get("/api/courses/{course_id}/concepts")
    def concepts(course_id: str):
        course(course_id)
        return locked(lambda: projector.concepts_view(course_id))

    @app.get("/api/courses/{course_id}/concepts/{node_id}")
    def concept_neighborhood(course_id: str, node_id: str, depth: int = 2):
        course(course_id)
        view = locked(lambda: projector.concepts_view(course_id))
        hood = Projector.neighborhood(view, node_id, depth=max(1, min(depth, 4)), limit=80)
        if not hood["nodes"]:
            raise HTTPException(404, "Unknown concept or skill")
        return hood

    @app.get("/api/courses/{course_id}/outline")
    def outline(course_id: str, scope: str = Query("course", max_length=120, pattern=r"^(course|lecture:[A-Za-z0-9._-]+|slide:[A-Za-z0-9._-]+:[0-9]{1,5})$"),
                parent: str | None = Query(None, max_length=1200), limit: int = Query(200, ge=1, le=200)):
        course(course_id)
        try:
            return locked(lambda: projector.outline_view(course_id, scope=scope, parent=parent, limit=limit))
        except ValueError:
            raise HTTPException(404, "Unknown scope") from None

    @app.get("/api/courses/{course_id}/outline/node")
    def outline_node(course_id: str, id: str = Query(..., max_length=300)):
        course(course_id)
        view = locked(lambda: projector.outline_node(course_id, id))
        if view is None:
            raise HTTPException(404, "Unknown catalog object")
        return view

    @app.get("/api/courses/{course_id}/progress")
    def progress(course_id: str):
        course(course_id)
        return locked(lambda: projector.gaps_view(course_id))

    @app.get("/api/courses/{course_id}/history")
    def history(course_id: str):
        course(course_id)
        return locked(lambda: projector.history_view(course_id))

    @app.get("/api/courses/{course_id}/review")
    def review(course_id: str):
        course(course_id)
        return locked(lambda: projector.review_view(course_id))

    @app.get("/api/courses/{course_id}/search-index")
    def search_index(course_id: str):
        course(course_id)
        return locked(lambda: projector.search_index(course_id))

    @app.get("/api/courses/{course_id}/resume")
    def resume_state(course_id: str):
        course(course_id)
        return locked(lambda: runtime.coordinator.resume.state(course_id))

    @app.get("/api/courses/{course_id}/resume/drafts/{sha256}")
    def resume_draft(course_id: str, sha256: str):
        course(course_id)
        data = runtime.coordinator.resume.read_draft(course_id, sha256) if len(sha256) == 64 and sha256.isalnum() else None
        if data is None:
            raise HTTPException(404, "Draft bytes are not available on the Brain")
        return Response(data, media_type="text/plain; charset=utf-8")

    @app.post("/api/courses/{course_id}/resume/resolve")
    async def resume_resolve(course_id: str, request: Request):
        """Operator choice between competing checkpoints. The set-aside draft is kept, not deleted."""
        course(course_id)
        body = await request.json()
        state = runtime.coordinator.resume.state(course_id)
        heads = {h["checkpoint_id"] for h in (state["conflict"] or {}).get("heads", [])}
        chosen, aside = body.get("chosen"), list(body.get("set_aside") or [])
        if chosen not in heads or not aside or not set(aside) <= heads - {chosen}:
            raise HTTPException(400, "Choose one of the competing checkpoints and name the others to set aside")
        runtime.coordinator.resume.resolve(course_id, chosen_checkpoint_id=chosen, set_aside=aside, resolution_id=f"res-{secrets.token_hex(6)}", at=runtime.now())
        return runtime.coordinator.resume.state(course_id)

    @app.get("/api/courses/{course_id}/notes")
    def notes(course_id: str):
        course(course_id)
        directory = settings.app_area(course_id) / "notes"
        out = []
        for path in sorted(directory.glob("*.json")) if directory.is_dir() else []:
            try:
                record = c.parse_json(path.read_bytes())
            except c.ContractError:
                continue
            out.append({"event_id": record["event_id"], "created_at": record["created_at"], "text": record["command"]["text"], "sources": record["command"]["sources"]})
        return {"course_id": course_id, "notes": sorted(out, key=lambda n: n["created_at"], reverse=True), "note": "Notes are your own authored work, not learning evidence."}

    @app.get("/api/coverage")
    def coverage():
        return locked(runtime.preparation.coverage)

    # ---- source bytes (resolved by id; never by client-supplied path) ------------------------------------
    def _item(course_id: str, source_id: str) -> dict:
        inventory = build_inventory(course(course_id))
        for lecture in inventory["lectures"]:
            for item in [*lecture["decks"], *lecture["extra_materials"]]:
                if item["source_id"] == source_id:
                    return item
        for session in inventory["sessions"]:
            for item in session["items"]:
                if item["source_id"] == source_id:
                    return item
        for item in inventory["other_sources"]:
            if item["source_id"] == source_id:
                return item
        raise HTTPException(404, "Unknown source")

    @app.get("/api/sources/{course_id}/{source_id}/content")
    def source_content(course_id: str, source_id: str, reveal: str | None = None):
        item = _item(course_id, source_id)
        if item["disclosure"] == "restricted_solution" and (reveal is None or reveals.get(reveal, 0) < time.time()):
            raise HTTPException(403, "This is answer material. It opens only after a deliberate, recorded reveal.")
        if not item["path"]:
            raise HTTPException(404, "This source has no file (not supplied or unavailable).")
        try:
            path = c.resolve_inside(settings.course(course_id).root, item["path"])
        except c.ContractError as exc:
            raise HTTPException(404, "This source is not a file inside the course folder.") from exc
        if not path.is_file() or path.stat().st_size == 0:
            raise HTTPException(404, "The file is missing or empty.")
        return FileResponse(path, media_type=item["media_type"] or "application/octet-stream", headers={"Content-Disposition": "inline", "Content-Security-Policy": "sandbox"})

    @app.get("/api/sources/{course_id}/{source_id}")
    def source_detail(course_id: str, source_id: str):
        item = _item(course_id, source_id)
        detail = {k: item[k] for k in ("source_id", "version_id", "sha256", "kind", "kind_basis", "role", "filename", "media_type", "bytes", "state", "registration", "rendition", "disclosure",
                                       "source_date", "historical_versions")}
        detail["identity"] = identity_status(item)
        detail["identity_note"] = PROVISIONAL_NOTE if detail["identity"] == "provisional" else None
        if detail["identity"] == "provisional" and item.get("path") and item["state"] == "present_unindexed":
            detail["version_id"], detail["sha256"] = runtime.preparation.identity_of(course_id, item)  # shown, and labelled provisional
        return detail

    @app.post("/api/reveal")
    async def reveal(request: Request):
        body = await request.json()
        item = _item(body["course_id"], body["source_id"])
        if item["disclosure"] != "restricted_solution":
            raise HTTPException(400, "This source is not restricted.")
        token = secrets.token_urlsafe(16)
        reveals[token] = time.time() + 600
        runtime.journal.add_receipt(kind="reveal", job_id=None, ref=item["source_id"], payload={"course_id": body["course_id"], "source_id": item["source_id"], "at": runtime.now(),
                                                                                                "note": "Learner deliberately revealed answer material; later answers are not unaided."})
        return {"token": token, "expires_in_seconds": 600, "exposure": "seen_solution", "note": "Recorded. Answers you submit after this are marked as given with the solution seen."}

    @app.get("/api/files/{course_id}/{path:path}")
    def app_file(course_id: str, path: str):
        course(course_id)
        if not path.startswith(".agent/learning-app/renditions/") or not c.safe_relative(path):
            raise HTTPException(403, "Only generated renditions are served here.")
        target = c.resolve_inside(settings.write_root(course_id), path)
        if not target.is_file():
            raise HTTPException(404, "Not found")
        return FileResponse(target, media_type="application/pdf", headers={"Content-Security-Policy": "sandbox"})

    # ---- same-PC transport (mirrors the Drive inbox) ----------------------------------------------------
    @app.put("/api/transport/{course_id}/inbox/{request_id}/{path:path}")
    async def put_bundle_file(course_id: str, request_id: str, path: str, request: Request):
        course(course_id)
        if not _REQUEST_DIR.fullmatch(request_id) or not c.safe_relative(request_id) or not c.safe_relative(path):
            raise HTTPException(400, "Invalid request id or path")
        data = await request.body()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File too large for this transport")
        target = c.resolve_inside(settings.app_area(course_id) / "inbox" / request_id, path)
        try:
            outcome = publish_exclusive(target, data)
        except ExclusiveConflict as exc:
            raise HTTPException(409, "A different file already exists under this name; submitted bundles are immutable.") from exc
        if path == MANIFEST:
            runtime.nudge()
        return {"stored": outcome, "sha256": c.sha256_hex(data), "bytes": len(data)}

    @app.get("/api/results/{course_id}/{request_id}")
    def result_bundle(course_id: str, request_id: str):
        course(course_id)
        base = settings.app_area(course_id) / "outbox" / request_id
        generations = sorted((int(p.name[1:]) for p in base.glob("g*") if p.name[1:].isdigit() and (p / MANIFEST).is_file()), reverse=True) if base.is_dir() else []
        job = runtime.journal.job_for_request(request_id)
        status = {"request_id": request_id, "job": ({"state": str(job["state"]), "reason": job["waiting_reason"], "generation": job["generation"], "cancel_requested": job["cancel_requested"]} if job else None)}
        if not generations:
            return dict(status, result=None)
        directory = base / f"g{generations[0]}"
        manifest_bytes, manifest = read_manifest(directory)
        files = {f["path"]: base64.b64encode((directory / f["path"]).read_bytes()).decode("ascii") for f in manifest["files"]}
        return dict(status, result={"generation": generations[0], "manifest_b64": base64.b64encode(manifest_bytes).decode("ascii"),
                                    "signature": json.loads((directory / SIGNATURE).read_text(encoding="utf-8")), "files_b64": files,
                                    "is_current_generation": bool(job) and job["generation"] == generations[0]})

    # ---- pairing (operator at the Brain PC) ---------------------------------------------------------------
    @app.post("/api/pairing/request")
    async def pairing_request(request: Request):
        body = await request.json()
        try:
            device = runtime.pairing.request(device_id=body["device_id"], label=body.get("label") or "Unnamed device", public_key_spki_b64=body["public_key_spki_b64"],
                                             courses=body.get("courses") or sorted(settings.courses), actions=body.get("actions"))
        except (PairingError, ValueError, KeyError) as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"device": device, "brain": runtime.coordinator.brain_public(), "binding_revision": settings.binding_revision,
                "note": "Pending. Compare the fingerprint shown on this device with the one shown on the Brain PC before approving."}

    @app.post("/api/pairing/{key_id}/approve")
    async def pairing_approve(key_id: str, request: Request):
        body = await request.json()
        try:
            return {"device": runtime.pairing.approve(key_id, reviewed_fingerprint=body.get("reviewed_fingerprint", "")), "brain": runtime.coordinator.brain_public()}
        except PairingError as exc:
            raise HTTPException(403, str(exc)) from exc

    @app.post("/api/pairing/{key_id}/revoke")
    def pairing_revoke(key_id: str):
        try:
            return {"device": runtime.pairing.revoke(key_id), "note": "Revoked for future requests. Work the Brain already accepted may still finish; cancel it separately if you want."}
        except PairingError as exc:
            raise HTTPException(404, str(exc)) from exc

    # ---- activity ----------------------------------------------------------------------------------------
    @app.get("/api/activity")
    def activity():
        view = locked(projector.activity_view)
        view["pending_bundles"] = (runtime.last_tick or {}).get("scan", {}).get("pending", [])
        return view

    @app.get("/api/activity/{request_id}")
    def activity_detail(request_id: str):
        job = runtime.journal.job_for_request(request_id)
        if job is None:
            raise HTTPException(404, "No admitted request with this id")
        entry = next((j for j in locked(projector.activity_view)["jobs"] if j["request_id"] == request_id), None)
        return {"job": entry, "events": runtime.journal.events(job["job_id"])[-40:],
                "receipts": [{"kind": r["kind"], "ref": r["ref"], "generation": r["generation"], "created_at": r["created_at"]} for r in runtime.journal.receipts(job["job_id"])]}

    @app.post("/api/activity/{request_id}/reconcile")
    def reconcile(request_id: str):
        job = runtime.journal.job_for_request(request_id)
        if job is None:
            raise HTTPException(404, "No admitted request with this id")
        try:
            return {"state": str(locked(lambda: runtime.coordinator.reconcile(job["job_id"])))}
        except JournalError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/api/activity/{request_id}/retry")
    def retry(request_id: str):
        job = runtime.journal.job_for_request(request_id)
        if job is None:
            raise HTTPException(404, "No admitted request with this id")
        state = locked(lambda: runtime.coordinator.retry(job["job_id"]))
        runtime.nudge()
        return {"state": str(state), "note": "The same learner input will be dispatched again under a new dispatch identity; an older result can no longer publish."}

    # ---- settings / operator -----------------------------------------------------------------------------
    @app.get("/api/settings")
    def settings_view():
        policy = settings.policy
        return {"profile": settings.profile, "fixture_label": settings.fixture_label, "binding_revision": settings.binding_revision,
                "capabilities": runtime.maintenance.capabilities(runtime.adapter), "brain": runtime.coordinator.brain_public(), "devices": runtime.pairing.devices(),
                "courses": [{"course_id": b.course_id, "display_name": b.display_name, "status": b.status, "problem": b.problem, "thread_key": b.thread_key,
                             "native_thread_bound": bool(b.native_thread_id)} for b in settings.courses.values()],
                "limits": {k: policy[k] for k in ("additional_paid_inference_budget_usd", "max_native_turns_total", "max_background_processing_jobs", "interactive_turn_budget_seconds",
                                                  "quick_answer_default_max_words", "diagnostic_default_followups", "review_default_max_items", "max_input_characters", "active_rescan_seconds", "idle_rescan_seconds")},
                "retention": runtime.retention.classes(), "fixture_modes": list(MODES) if settings.profile == "fixture" else None,
                "fixture_mode": runtime.journal.get_value("fixture-native-mode", "normal") if settings.profile == "fixture" else None}

    @app.post("/api/supervisor/{action}")
    def supervisor(action: str):
        if action == "pause":
            runtime.maintenance.pause("Paused by you in Settings")
        elif action == "resume":
            runtime.maintenance.resume()
            runtime.nudge()
        elif action == "tick":
            return runtime.tick()
        else:
            raise HTTPException(404, "Unknown supervisor action")
        return {"paused": bool(runtime.journal.get_value("supervisor-paused", False))}

    @app.post("/api/fixture/native-mode")
    async def fixture_mode(request: Request):
        if settings.profile != "fixture":
            raise HTTPException(404, "Fixture controls exist only in the fixture profile")
        mode = (await request.json()).get("mode")
        if mode not in MODES:
            raise HTTPException(400, "Unknown fixture mode")
        runtime.journal.set_value("fixture-native-mode", mode)
        return {"mode": mode}

    @app.post("/api/probe-native")
    def probe():
        return probe_native(settings, execute=False)  # inspection only from the UI; the executing proof is a deliberate CLI action

    @app.get("/api/maintenance/issues")
    def issues():
        return {"issues": locked(runtime.maintenance.issues)}

    @app.get("/api/maintenance/preview")
    def repair_preview(issue_id: str):
        return locked(lambda: runtime.maintenance.repair_preview(issue_id))

    @app.post("/api/maintenance/apply")
    async def repair_apply(request: Request):
        issue_id = (await request.json()).get("issue_id", "")
        return locked(lambda: runtime.maintenance.repair_apply(issue_id))

    @app.post("/api/courses/{course_id}/questions/{question_id}/verify-rendition")
    def verify_rendition(course_id: str, question_id: str):
        """Compare a question's related copy with its original. Reads both files; keeps the outcome in the app's own state."""
        course(course_id)
        return locked(lambda: projector.verify_rendition(course_id, question_id))

    @app.post("/api/prepare/{course_id}")
    def prepare(course_id: str):
        course(course_id)
        report = locked(lambda: runtime.preparation.prepare_course(course_id, max_units=8))
        return report

    @app.post("/api/export")
    async def export(request: Request):
        ids = (await request.json()).get("courses") or []
        if not ids or any(i not in settings.courses for i in ids):
            raise HTTPException(400, "Choose one or more bound courses")
        result = locked(lambda: runtime.retention.build_export(ids))
        return {k: result[k] for k in ("export_id", "path", "files", "bytes")} | {"excluded": result["manifest"]["excluded"]}

    @app.get("/api/export/preview")
    def export_preview(courses: str):
        ids = [i for i in courses.split(",") if i]
        if not ids or any(i not in settings.courses for i in ids):
            raise HTTPException(400, "Choose one or more bound courses")
        return locked(lambda: runtime.retention.export_preview(ids))

    @app.get("/api/cleanup/{course_id}/preview")
    def cleanup_preview(course_id: str):
        course(course_id)
        return locked(lambda: runtime.retention.cleanup_preview(course_id))

    @app.post("/api/cleanup/{course_id}/apply")
    async def cleanup_apply(course_id: str, request: Request):
        course(course_id)
        preview_id = (await request.json()).get("preview_id", "")
        return runtime.cleanup_apply(course_id, preview_id)

    @app.post("/api/evidence-deletion")
    async def evidence_deletion(request: Request):
        body = await request.json()
        course(body["course_id"])
        return runtime.retention.request_evidence_deletion(body["course_id"], body["path"])

    @app.post("/api/acceptance/run")
    def acceptance():
        return locked(lambda: run_acceptance(settings, runtime.journal, reports_dir=settings.state_dir / "reports", preparation=runtime.preparation))

    # ---- amendment R2 read side: each module registers its own routes (docs/engineering/r2-read-api.md, section 4) ----
    concept_graph.register(app, runtime, locked)
    inferred_anchors.register(app, runtime, locked)
    slide_identity.register(app, runtime, locked)
    timing_links.register(app, runtime, locked)

    # ---- build identity: which code, profile, built app and preparation state this process serves -------------------
    # The code identity is resolved once, here, at process start; the built app and the preparation state are read per request.
    served = static_dir if static_dir is not None and (static_dir / "index.html").is_file() else None
    identity = {"app_version": APP_VERSION, **_checkout(settings.repo), "pid": os.getpid(), "process_started_at": PROCESS_STARTED_AT, "process_started_basis": PROCESS_STARTED_BASIS,
                "profile": settings.profile, "preparation_tool_version": PREPARATION_TOOL_VERSION, "source_map_version": _source_map_version()}

    @app.get("/api/health")
    def health(request: Request):
        return {"ok": True, "profile": settings.profile, "schema_revision": runtime.journal.schema_revision(), "paused": bool(runtime.journal.get_value("supervisor-paused", False)),
                "build": {**identity, "port": _listening_port(request), **static_identity(served, settings.repo), "courses": course_identities(settings)}}

    if served is not None:
        index = served / "index.html"
        @app.get("/{full_path:path}")
        def spa(full_path: str):
            candidate = served / full_path
            if full_path and c.safe_relative(full_path) and candidate.is_file() and not _same_file(candidate, index):
                # Explicit types: the platform registry may map .js/.mjs to text/plain, which browsers refuse for modules.
                # A file the bundler emitted under a content-hashed name never changes its bytes, so the browser may keep it
                # - once it has settled: one written a moment ago may still be being written by a build. Every other file,
                # whatever its name looks like, is asked for again each time.
                keep = full_path in _bundled_names(served) and time.time() - candidate.stat().st_mtime > _SETTLED_SECONDS
                return FileResponse(candidate, media_type=_STATIC_TYPES.get(candidate.suffix.lower()), headers={"Cache-Control": "max-age=31536000, immutable" if keep else "no-cache"})
            if full_path.startswith("api/"):
                raise HTTPException(404, "Unknown API route")
            # The page, under any spelling of its name, names the current build's files: never reuse it without asking, so a
            # rebuilt app is picked up on reload.
            return FileResponse(index, headers={"Content-Security-Policy": CSP, "Cache-Control": "no-cache"})

    return app


_STATIC_TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".map": "application/json",
                 ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".wasm": "application/wasm", ".ico": "image/x-icon"}

CSP = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; "
       "connect-src 'self' https://www.googleapis.com https://accounts.google.com; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'none'")


# ---- build identity (GET /api/health -> "build") ---------------------------------------------------------------------
# Names, ids and digests only: no path outside the repository, no account name and no course text leaves this module.
def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


MODULE_LOADED_AT = time.time()


def process_start() -> tuple[float, str]:
    """When this process began, and how that is known: ``os_process_creation`` (what the operating system recorded, so it
    can be matched against a process listing) or, where that cannot be asked, ``module_import`` (when this module was
    loaded, which is later by however long start-up took)."""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.GetCurrentProcess.restype = wintypes.HANDLE
            kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE, *[ctypes.POINTER(wintypes.FILETIME)] * 4]
            kernel32.GetProcessTimes.restype = wintypes.BOOL
            created, exited, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
            if kernel32.GetProcessTimes(kernel32.GetCurrentProcess(), ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)):
                seconds = ((created.dwHighDateTime << 32) | created.dwLowDateTime) / 10_000_000 - 11_644_473_600  # 100 ns ticks since 1601 -> Unix time
                if 0 < seconds <= MODULE_LOADED_AT:
                    return seconds, "os_process_creation"
        except Exception:  # noqa: BLE001 - not being able to ask is an answer ("module_import"), never a failure to start
            pass
    return MODULE_LOADED_AT, "module_import"


_STARTED = process_start()
PROCESS_STARTED_AT, PROCESS_STARTED_BASIS = _iso(_STARTED[0]), _STARTED[1]
_SETTLED_SECONDS = 10.0
_HASHED_NAME = re.compile(r"(?:[^/]+/)*[^/]+-[A-Za-z0-9_-]{8}(?:\.[A-Za-z0-9]+)+")  # the bundler's name-<content hash>.ext
_COMMIT = re.compile(r"[0-9a-f]{40}(?:[0-9a-f]{24})?")
_BUILT_AT = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")
_VERSION_DIR = re.compile(r"[0-9a-f]{16}")  # the stored source-map layout: source-map/<source id>/<sha256 prefix>/map-o<revision>[-c<companion>].json
_MAP_FILE = re.compile(r"map-o(\d{4})(?:-c[0-9a-f]{8})?\.json")
BUILD_STAMP = "ll-build"  # <meta name="ll-build" content="commit=<id>; dirty=<true|false>; built_at=<UTC time>">, written by web/vite.config.ts
_FACTS: dict[str, tuple[tuple[int, int], Any]] = {}
_MAX_FACT_BYTES = 32 * 1024 * 1024


def _listening_port(request: Request) -> int | None:
    """The port this Brain accepted the request on (the server's own socket, not the address the page was opened with)."""
    server = request.scope.get("server")
    return server[1] if isinstance(server, (list, tuple)) and len(server) == 2 and isinstance(server[1], int) else None


def _same_file(a: Path, b: Path) -> bool:
    try:
        return os.path.samefile(a, b)
    except OSError:
        return True  # cannot tell: answer with the page and its policy rather than with a bare file


def _fact(path: Path, read: Callable[[bytes], Any]) -> Any:
    """What ``read`` makes of one small stored file, remembered until the file's size or time changes.
    None when the file is absent, too large or unreadable."""
    try:
        stat = path.stat()
        key = (stat.st_mtime_ns, stat.st_size)
        known = _FACTS.get(str(path))
        if known is not None and known[0] == key:
            return known[1]
        if stat.st_size > _MAX_FACT_BYTES:
            return None
        value = read(path.read_bytes())
    except Exception:  # noqa: BLE001 - a stored file that cannot be read is "not established", never a failed health view
        return None
    _FACTS[str(path)] = (key, value)
    return value


def _manifest_names(data: bytes) -> frozenset[str]:
    document = json.loads(data)
    names: set[str] = set()
    for entry in document.values() if isinstance(document, dict) else ():
        if isinstance(entry, dict):
            listed = [entry.get("file"), *(entry.get("css") if isinstance(entry.get("css"), list) else []), *(entry.get("assets") if isinstance(entry.get("assets"), list) else [])]
            names.update(name for name in listed if isinstance(name, str) and _HASHED_NAME.fullmatch(name))
    return frozenset(names)


def _bundled_names(static_dir: Path) -> frozenset[str]:
    """Files the bundler itself emitted under content-hashed names: listed by its own build manifest AND named
    ``name-<8 character hash>.ext``. A file that was merely copied into the built app is not listed, whatever its name
    looks like; a listed file without a hash in its name could change under the same address. No manifest: nothing."""
    return _fact(static_dir / ".vite" / "manifest.json", _manifest_names) or frozenset()


def repository_commit(repo: Path) -> dict[str, str | None]:
    """HEAD of the checkout, read from git's own files (no git executable). Unknown stays None; nothing is guessed."""
    out: dict[str, str | None] = {"commit": None, "commit_short": None, "branch": None}
    try:
        git = repo / ".git"
        if git.is_file():  # a linked worktree: ".git" is a pointer file
            git = (repo / git.read_text(encoding="utf-8").strip().removeprefix("gitdir:").strip()).resolve()
        head = (git / "HEAD").read_text(encoding="utf-8").strip()
        value: str | None = head
        if head.startswith("ref:"):
            ref = head[4:].strip()
            if not ref.startswith("refs/") or not c.safe_relative(ref):
                return out
            out["branch"] = ref.removeprefix("refs/heads/")
            common = (git / (git / "commondir").read_text(encoding="utf-8").strip()).resolve() if (git / "commondir").is_file() else git
            loose = next((base / ref for base in (git, common) if (base / ref).is_file()), None)
            if loose is not None:
                value = loose.read_text(encoding="utf-8").strip()
            else:
                packed = (common / "packed-refs").read_text(encoding="utf-8") if (common / "packed-refs").is_file() else ""
                value = next((line.split(" ", 1)[0] for line in packed.splitlines() if line.split(" ", 1)[1:] == [ref]), None)
        if value and _COMMIT.fullmatch(value):
            out["commit"], out["commit_short"] = value, value[:7]
    except (OSError, UnicodeError):
        pass
    return out


def git_executable() -> str | None:
    """git from an absolute folder on the search path. Never the working directory (which Windows would search first)
    and never a script; None when there is none."""
    try:
        here: Path | None = Path.cwd().resolve()
    except OSError:
        here = None
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        folder = Path(entry.strip('"'))
        if not entry.strip('"') or not folder.is_absolute():
            continue
        candidate = folder / ("git.exe" if os.name == "nt" else "git")
        try:
            if candidate.is_file() and (os.name == "nt" or os.access(candidate, os.X_OK)) and folder.resolve() != here:
                return str(candidate)
        except OSError:
            continue
    return None


def repository_dirty(repo: Path) -> bool | None:
    """True/False from one bounded, read-only ``git status`` of exactly this checkout (tracked changes or new unignored
    files); None when git is absent, slow, refuses, or this is not a checkout. It takes no lock and refreshes nothing.
    Inherited ``GIT_*`` variables are not passed on and no parent folder is searched, so the answer cannot describe
    another repository."""
    git = git_executable()
    if git is None or not (repo / ".git").exists():
        return None
    environment = {key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_")}
    try:
        done = subprocess.run([git, "--no-optional-locks", "-c", "core.fsmonitor=false", "--git-dir", str(repo / ".git"), "--work-tree", str(repo), "status", "--porcelain", "--untracked-files=normal"],
                              capture_output=True, timeout=10, check=False, stdin=subprocess.DEVNULL, env=environment, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        return None
    return bool(done.stdout.strip()) if done.returncode == 0 else None


@functools.lru_cache(maxsize=8)
def _checkout(repo: Path) -> dict[str, Any]:
    """Once per process: later commits or edits in the checkout do not change which code this process already loaded."""
    return {**repository_commit(repo), "dirty": repository_dirty(repo)}


def _source_map_version() -> str | None:
    try:  # the module may not exist in this checkout, or may not load: then there is no version to report
        module = importlib.import_module(f"{__package__}.sourcemap")
    except Exception:  # noqa: BLE001
        return None
    return next((value for name in ("SOURCE_MAP_VERSION", "SOURCEMAP_VERSION", "MAP_VERSION", "VERSION") if isinstance(value := getattr(module, name, None), str)), None)


class _PageFacts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.script: list[str] = []
        self.style: list[str] = []
        self.stamp: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        found = {key: value or "" for key, value in attrs}
        rel = found.get("rel", "").lower().split()
        if tag == "script" and found.get("src"):
            self._add(self.script, found["src"])
        elif tag == "link" and found.get("href") and ("modulepreload" in rel or "stylesheet" in rel):
            self._add(self.script if "modulepreload" in rel else self.style, found["href"])
        elif tag == "meta" and found.get("name", "").lower() == BUILD_STAMP and self.stamp is None:
            self.stamp = found.get("content", "")

    @staticmethod
    def _add(names: list[str], url: str) -> None:
        name = url.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if name and name not in names:
            names.append(name)


def _page_facts(html: str) -> _PageFacts:
    parser = _PageFacts()
    parser.feed(html)
    parser.close()
    return parser


def referenced_assets(html: str) -> dict[str, list[str]]:
    """Script and stylesheet files an HTML page names, in document order (inline scripts and icons are not assets)."""
    page = _page_facts(html)
    return {"script": page.script, "style": page.style}


def web_build(stamp: str | None) -> dict[str, Any] | None:
    """What a built page states about its own origin: the commit it was built from, whether the working tree was
    modified at that moment, and when. None: the page carries no stamp (it was built before the stamp existed). A field
    that is absent or malformed stays None; nothing is filled in."""
    if stamp is None:
        return None
    fields = {key.strip(): value.strip() for key, _, value in (part.partition("=") for part in stamp.split(";"))}
    commit = fields.get("commit", "") if _COMMIT.fullmatch(fields.get("commit", "")) else None
    return {"commit": commit, "commit_short": commit[:7] if commit else None, "dirty": {"true": True, "false": False}.get(fields.get("dirty", "")),
            "built_at": fields.get("built_at") if _BUILT_AT.fullmatch(fields.get("built_at", "")) else None}


def static_identity(static_dir: Path | None, repo: Path) -> dict[str, Any]:
    """The index.html a page load receives right now: ``assets`` (the files it names), ``web_build`` (what it states about
    the build it came from) and ``static`` (where it is served from, the digest of its bytes and when it was written)."""
    static: dict[str, Any] = {"served": static_dir is not None, "directory": None, "index_modified_at": None, "index_sha256": None}
    out: dict[str, Any] = {"assets": {"script": [], "style": []}, "web_build": None, "static": static}
    if static_dir is None:
        return out
    try:
        static["directory"] = static_dir.resolve().relative_to(repo.resolve()).as_posix()
    except (ValueError, OSError):
        pass  # outside the repository: where it lies is not disclosed
    try:
        index = static_dir / "index.html"
        data, modified = index.read_bytes(), index.stat().st_mtime
    except OSError:
        return out  # e.g. briefly absent while the app is being rebuilt
    page = _page_facts(data.decode("utf-8", "replace"))
    static.update(index_modified_at=_iso(modified), index_sha256=c.sha256_hex(data))
    return {"assets": {"script": page.script, "style": page.style}, "web_build": web_build(page.stamp), "static": static}


# ---- per-course preparation identity ---------------------------------------------------------------------------------
def _folders(path: Path) -> list[Path]:
    try:
        return sorted((entry for entry in path.iterdir() if entry.is_dir()), key=lambda entry: entry.name)
    except OSError:
        return []


def _state_fact(data: bytes) -> tuple[str, str | None]:
    try:
        version = json.loads(data).get("tool_version")
    except (ValueError, AttributeError):
        version = None
    return c.sha256_hex(data), version if isinstance(version, str) and _REQUEST_DIR.fullmatch(version) else None


def _map_fact(data: bytes) -> tuple[str | None, int | None]:
    try:
        document = json.loads(data)
        revision, overrides = document.get("map_revision"), (document.get("overrides") or {}).get("revision")
    except (ValueError, AttributeError):
        return None, None
    return (revision if isinstance(revision, str) and _REQUEST_DIR.fullmatch(revision) else None), (overrides if type(overrides) is int else None)


def course_identities(settings: Any) -> dict[str, dict[str, Any]]:
    """For every bound course, what its private preparation state consists of right now.

    * ``preparation_generation``: one id over the stored preparation state of all its lecture units (it changes when any
      of them is prepared again with another result); None when nothing was ever prepared. ``prepared_lectures`` counts
      them and ``preparation_tool_versions`` names the tool versions that wrote them.
    * ``map_revisions``: per deck, the stored source maps - one entry per version of the deck's bytes (oldest written
      first), each with the revision of its newest map.
    * ``derived_generations``: per recording, the ids of the stored generated-timing generations.

    Only files in the app's own area are listed and read; no course file is opened or hashed and nothing is built, so
    this says what is STORED - the lecture view says which map or generation it is actually using for the current bytes."""
    out: dict[str, dict[str, Any]] = {}
    for course_id, binding in sorted(settings.courses.items()):
        entry: dict[str, Any] = {"preparation_generation": None, "prepared_lectures": 0, "preparation_tool_versions": [], "map_revisions": {}, "derived_generations": {}}
        out[course_id] = entry
        if binding.status == "missing_root" and not settings.writes_are_staged:
            continue  # this course has no folder: nothing is read from a placeholder location
        try:
            area = settings.app_area(course_id)
            states = [(folder.name, *fact) for folder in _folders(area / "prepared") if (fact := _fact(folder / "state.json", _state_fact)) is not None]
            if states:
                entry.update(preparation_generation=c.sha256_hex(c.dump_json([[name, digest] for name, digest, _ in states]))[:16], prepared_lectures=len(states),
                             preparation_tool_versions=sorted({version for _, _, version in states if version}))
            for source in _folders(area / "source-map"):
                versions = []
                for version in _folders(source):
                    maps = sorted((path for path in version.iterdir() if _MAP_FILE.fullmatch(path.name)), key=lambda path: (int(_MAP_FILE.fullmatch(path.name)[1]), path.stat().st_mtime_ns))
                    if _VERSION_DIR.fullmatch(version.name) and maps:
                        revision, overrides = _fact(maps[-1], _map_fact) or (None, None)
                        versions.append((maps[-1].stat().st_mtime_ns, version.name, {"source_sha256_prefix": version.name, "map_revision": revision, "overrides_revision": overrides}))
                if versions and _REQUEST_DIR.fullmatch(source.name):
                    entry["map_revisions"][source.name] = [record for _, _, record in sorted(versions, key=lambda item: item[:2])]
            for source in _folders(area / "derived"):
                generations = [folder.name for folder in _folders(source) if _REQUEST_DIR.fullmatch(folder.name) and (folder / "manifest.json").is_file()]
                if generations and _REQUEST_DIR.fullmatch(source.name):
                    entry["derived_generations"][source.name] = generations
        except OSError:
            continue  # a folder that changes while it is read: what was established so far stands
    return out
