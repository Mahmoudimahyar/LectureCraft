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

from pathlib import Path
import base64
import json
import re
import secrets
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

from . import contracts as c
from .acceptance import run_acceptance
from .fsutil import ExclusiveConflict, publish_exclusive
from .journal import JournalError
from .native.fixture_tutor import MODES
from .native.probe import probe_native
from .ownerio.inventory import PROVISIONAL_NOTE, build_inventory, identity_status
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
        response.headers["Cache-Control"] = "no-store"
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

    @app.get("/api/health")
    def health():
        return {"ok": True, "profile": settings.profile, "schema_revision": runtime.journal.schema_revision(), "paused": bool(runtime.journal.get_value("supervisor-paused", False))}

    if static_dir is not None and (static_dir / "index.html").is_file():
        index = static_dir / "index.html"
        @app.get("/{full_path:path}")
        def spa(full_path: str):
            candidate = static_dir / full_path
            if full_path and c.safe_relative(full_path) and candidate.is_file():
                # Explicit types: the platform registry may map .js/.mjs to text/plain, which browsers refuse for modules.
                return FileResponse(candidate, media_type=_STATIC_TYPES.get(candidate.suffix.lower()))
            if full_path.startswith("api/"):
                raise HTTPException(404, "Unknown API route")
            return FileResponse(index, headers={"Content-Security-Policy": CSP})

    return app


_STATIC_TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".map": "application/json",
                 ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".wasm": "application/wasm", ".ico": "image/x-icon"}

CSP = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; "
       "connect-src 'self' https://www.googleapis.com https://accounts.google.com; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'none'")
