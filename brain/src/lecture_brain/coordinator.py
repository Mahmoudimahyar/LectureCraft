"""Coordinator: join verified admission, the native adapter and the owning writers (LL021).

One bounded step at a time: scan → admit → claim → capture → (one native turn) → stage → owner
commit → signed result bundle. Facts stay separate: captured, received, answered, saved, view
current. The coordinator is deterministic; the reasoning runtime is called only for an admitted
job that needs it, and never while idle.

Invariants enforced here:
* learner input is frozen and read back before any inference (it survives every later failure);
* one native turn at a time, one per thread; a dispatch is journaled before it is sent;
* an unknown native outcome is reconciled, never re-sent automatically;
* cancelled/superseded generations cannot publish as current — a late result is kept as late;
* one accepted learner attempt per logical input; a regrade is a revision, not a new attempt;
* help (ask) yields ``kind:none / not_requested`` — never a fabricated attempt.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import time
from typing import Any, Callable

from . import contracts as c
from .annotations import AnnotationError, AnnotationStore
from .capture import CaptureConflict, CaptureError, CaptureStore
from .config import Settings
from .fsutil import publish_exclusive
from .journal import Journal, JobState as S, StaleLease
from .native import NativeAdapter, NativeBlocked, NativeObservation, NativeSubmission, resolve_target
from .ownerio.attempts import read_attempt_records
from .resume import ResumeError, ResumeStore
from .review import ReviewError, ReviewStore, rating_from_observations
from .transport import signing
from .transport.bundles import read_manifest, write_bundle
from .transport.inbox import InboxScanner
from .transport.pairing import PairingRegistry
from .tutoring.context import family_for, select_context, question_version_for
from .tutoring.outputs import TutorOutput, parse_tutor_output
from .tutoring.prompts import build_prompt
from .writer import WriterFacade
from .writer import candidate as cand

_LOCATOR = re.compile(r"^Lecture Learning capture (?P<path>\S+) sha256:(?P<sha>[a-f0-9]{64}) bytes:(?P<bytes>\d+) turn:(?P<turn>\S+)$")
NATIVE_ACTIONS = {"ask", "explain", "practice", "review_answer", "diagnose", "correct_assessment"}


class _Pause(Exception):
    """Leave the job in a paused/terminal state with a user-visible reason (no result bundle)."""

    def __init__(self, state: S, reason: str):
        super().__init__(reason)
        self.state = state
        self.reason = reason


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _short(text: str, n: int = 16) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:n]


class Coordinator:
    def __init__(self, settings: Settings, *, journal: Journal, pairing: PairingRegistry, adapter: NativeAdapter, clock: Callable[[], float] = time.time,
                 owner: str = "brain-supervisor", on_change: Callable[[str], None] | None = None):
        self.settings, self.journal, self.pairing, self.adapter = settings, journal, pairing, adapter
        self._clock, self._owner, self._on_change = clock, owner, on_change
        self.capture = CaptureStore(settings)
        self.writer = WriterFacade(settings, self.capture)
        self.annotations = AnnotationStore(settings)
        self.reviews = ReviewStore(settings)
        self.resume = ResumeStore(settings)
        self.scanner = InboxScanner(settings, journal, pairing, now=self.now)
        self.internal_handlers: dict[str, Callable[[dict], Any]] = {}
        self._brain_key = signing.load_or_create_brain_key(settings.keys_dir)
        self.brain_key_id = signing.key_id_for(self._brain_key.public_key(), "brain")

    # ---- time / identity -----------------------------------------------------------------------
    def now(self) -> str:
        return iso(self._clock())

    def now_offset(self) -> str:
        return datetime.fromtimestamp(self._clock(), timezone.utc).isoformat(timespec="seconds")

    def brain_public(self) -> dict:
        public = self._brain_key.public_key()
        return {"key_id": self.brain_key_id, "public_key_spki_b64": signing.public_key_spki_b64(public), "fingerprint": signing.fingerprint(public)}

    def paused(self) -> bool:
        return bool(self.journal.get_value("supervisor-paused", False))

    # ---- main loop -----------------------------------------------------------------------------
    def tick(self, max_jobs: int = 8) -> dict[str, Any]:
        """One bounded supervisor round. Returns what happened; makes no native call when nothing is runnable."""
        summary: dict[str, Any] = {"reaped": self.journal.reap_expired_leases(), "scan": self.scanner.scan(), "ran": []}
        if self.paused():
            summary["paused"] = True
            return summary
        # Jobs run strictly one after another in this process, so at most one native turn is ever in flight
        # (policy max_native_turns_total = 1) and at most one owner commit per course at a time.
        for _ in range(max_jobs):
            job = self.journal.claim(self._owner, lease_seconds=float(self.settings.policy["interactive_turn_budget_seconds"]) + 60)
            if job is None:
                break
            summary["ran"].append({"job_id": job["job_id"], "request_id": job["request_id"], "state": str(self._run(job))})
        return summary

    def _run(self, job: dict) -> S:
        if job["request_id"] is None:
            return self._run_internal(job)
        try:
            return self._execute(job, prior=None)
        except StaleLease:
            return self.journal.job(job["job_id"])["state"]

    def _run_internal(self, job: dict) -> S:
        """Supervisor-originated bounded work (preparation, projections). No learner input, no native turn."""
        handler = self.internal_handlers.get(job["detail"].get("kind"))
        if handler is None:
            return self._settle(job, job["lease_token"], S.WAITING_SOURCE, "No handler is installed for this internal task; it stays visible instead of being marked done.")
        try:
            note = handler(job)
        except Exception as exc:  # noqa: BLE001 - one failing background step must not stop the supervisor
            return self._settle(job, job["lease_token"], S.FAILED_FINAL, f"Background step failed: {exc}"[:500])
        self.journal.add_receipt(kind="internal", job_id=job["job_id"], generation=job["generation"], payload={"result": note})
        return self._settle(job, job["lease_token"], S.SUCCEEDED)

    # ---- bundle access -------------------------------------------------------------------------
    def _bundle(self, job: dict) -> tuple[dict, Any, Path, bytes]:
        admission = self.journal.admission(job["request_id"])
        directory = self.settings.write_root(job["course_id"]) / admission["bundle_ref"]
        loaded = read_manifest(directory)
        if loaded is None or c.sha256_hex(loaded[0]) != admission["manifest_sha256"]:
            raise _Pause(S.FAILED_FINAL, "The admitted request bundle is no longer present with the admitted bytes.")
        manifest = loaded[1]
        if c.verify_files(directory, manifest):
            raise _Pause(S.FAILED_FINAL, "The admitted request bundle changed after admission.")
        request = c.parse_json((directory / manifest["record_path"]).read_bytes())
        payload_bytes = (directory / request["payload"]["path"]).read_bytes()
        return request, c.parse_json(payload_bytes), directory, payload_bytes

    # ---- result publication ---------------------------------------------------------------------
    def _publish_result(self, job: dict, request: dict, generation: int, records: dict[str, dict | None], extra: dict | None = None) -> dict | None:
        """Write the signed result bundle for the current generation, or keep a late result as late."""
        files = {f"{name}.json": c.dump_json(record) for name, record in records.items() if record is not None}
        if extra:
            files["detail.json"] = c.dump_json(extra)
        base = self.settings.app_area(job["course_id"]) / "outbox" / request["request_id"]
        if not self.journal.is_current_generation(job["job_id"], generation):
            for name, data in files.items():
                publish_exclusive(base / f"late-g{generation}" / name, data)
            self.journal.add_receipt(kind="late-result", job_id=job["job_id"], generation=generation, ref=f"late-g{generation}",
                                     payload={"note": "Result arrived for a cancelled or superseded generation; kept, not published as current."})
            return None
        if (base / f"g{generation}" / "ready.json").is_file():  # already published for this generation (resumed after an interruption)
            manifest_bytes, manifest = read_manifest(base / f"g{generation}")
            return {"manifest": manifest, "manifest_sha256": c.sha256_hex(manifest_bytes)}
        admission = self.journal.admission(request["request_id"])
        info = write_bundle(base / f"g{generation}", kind="result", bundle_id=f"result-{_short(request['request_id'] + str(generation), 24)}", scope=request["scope"],
                            record_path="publication.json", files=files, signer_key_id=self.brain_key_id, private_key=self._brain_key, created_at=self.now(),
                            predecessor_manifest=admission["manifest_sha256"])
        self.journal.add_receipt(kind="output", job_id=job["job_id"], generation=generation, ref=f"outbox/{request['request_id']}/g{generation}", sha256=info["manifest_sha256"],
                                 payload={"files": sorted(files)})
        return info

    def _settle(self, job: dict, lease: int, state: S, reason: str | None = None) -> S:
        current = self.journal.job(job["job_id"])
        if current["state"] == state:
            return state
        # Walk through the legal intermediate states so the journal's transition rules stay authoritative.
        order = [S.CLAIMED, S.RUNNING, S.STAGED, S.COMMIT_PENDING]
        if state == S.SUCCEEDED and current["state"] == S.CLAIMED:
            self.journal.transition(job["job_id"], lease, S.RUNNING)
        elif state in {S.STAGED, S.COMMIT_PENDING} and current["state"] in order:
            for step in order[order.index(current["state"]) + 1: order.index(state)]:
                self.journal.transition(job["job_id"], lease, step)
        self.journal.transition(job["job_id"], lease, state, waiting_reason=reason)
        if self._on_change:
            self._on_change(job["course_id"])
        return state

    # ---- native step ----------------------------------------------------------------------------
    def _native(self, job: dict, lease: int, request: dict, *, prompt: str, context: dict, session_id: str, prior: NativeObservation | None) -> tuple[str, dict, dict]:
        """Run (or resume) the single native turn. Returns (reply text, native-result record, context artifact)."""
        course_id = job["course_id"]
        context_ref = self.capture.write_or_existing(course_id, session_id, "context", context["context_id"], c.dump_json(context))
        target = resolve_target(self.settings, course_id=course_id, request_binding_revision=request["binding_revision"], request_thread_key=request["thread_key"])
        dispatches = [d for d in self.journal.dispatches(job["job_id"]) if d["generation"] == job["generation"]]
        if prior is None:
            dispatch_id = f"d-{job['job_id'][:12]}-g{job['generation']}-{len(self.journal.dispatches(job['job_id'])) + 1}"
            submission = NativeSubmission(dispatch_id, request["request_id"], target, prompt, float(self.settings.policy["interactive_turn_budget_seconds"]))
            if self.journal.job(job["job_id"])["state"] == S.CLAIMED:
                self.journal.transition(job["job_id"], lease, S.RUNNING)
            self.journal.record_dispatch(job["job_id"], lease, dispatch_id=dispatch_id, adapter=self.adapter.name, native_thread_id=target.native_thread_id, native_turn_id=None)
            try:
                observation = self.adapter.submit(submission)
            except NativeBlocked:
                # Refused before reaching any runtime: this is not a possibly-running turn.
                self.journal.complete_dispatch(dispatch_id, state="not_sent", failure_code="blocked_before_send")
                raise
        else:
            dispatch_id = dispatches[-1]["dispatch_id"]
            observation = prior
        if observation.state == "completion_unknown":
            self.journal.complete_dispatch(dispatch_id, state="submitted", native_turn_id=observation.native_turn_id)
            raise _Pause(S.UNCERTAIN_COMPLETION, "The native turn may have completed, but no terminal result was observed. Check status before any retry.")
        self.journal.complete_dispatch(dispatch_id, state=observation.state, native_turn_id=observation.native_turn_id, failure_code=observation.failure_code)
        if observation.state == "approval_pending":
            raise _Pause(S.WAITING_USER, "Permission needed: a native approval is waiting for you. The app never approves on your behalf.")
        if observation.state == "quota_wait":
            raise _Pause(S.QUOTA_WAIT, "The native allowance is exhausted for now. Nothing else is substituted; resume when it resets.")
        if observation.state == "auth_required":
            raise _Pause(S.AUTH_REQUIRED, "Native sign-in is required. Sign in through the native app; no credentials are handled here.")
        if observation.state == "interrupted":
            raise _Pause(S.CANCELLED if self.journal.job(job["job_id"])["cancel_requested"] else S.FAILED_FINAL, "The native turn was interrupted.")
        if observation.state == "failed" or not observation.text:
            raise _Pause(S.FAILED_FINAL, f"The native turn failed ({observation.failure_code or 'no output'}). Your input is retained; you can retry deliberately.")
        output = self.capture.write_record(course_id, session_id, "receipts", f"native-{dispatch_id}", c.dump_json({"dispatch_id": dispatch_id, "text": observation.text}))
        self.journal.add_receipt(kind="native-output", job_id=job["job_id"], generation=job["generation"], ref=output["path"], sha256=output["sha256"],
                                 payload={"dispatch_id": dispatch_id, "session_id": session_id, "native_turn_id": observation.native_turn_id, "context": context_ref})
        if not self.journal.is_current_generation(job["job_id"], job["generation"]):
            # Cancelled or superseded while the turn was in flight: keep the late output, publish nothing, save nothing.
            self.journal.add_receipt(kind="late-result", job_id=job["job_id"], generation=job["generation"], ref=output["path"], sha256=output["sha256"],
                                     payload={"note": "Result arrived for a cancelled or superseded generation; kept, not published as current."})
            cancelled = self.journal.job(job["job_id"])["cancel_requested"]
            raise _Pause(S.CANCELLED if cancelled else S.SUPERSEDED, "A late result arrived after cancellation; it is kept as late and was not published or saved.")
        native_result = {"contract": "ll.native-result/1", "request_id": request["request_id"], "dispatch_id": dispatch_id, "scope": request["scope"], "binding_id": target.binding_id,
                         "binding_revision": target.binding_revision, "native_thread_id": target.native_thread_id, "native_turn_id": observation.native_turn_id, "state": "completed",
                         "terminal": True, "output_files": [output], "context_receipt": context_ref, "observed_at": self.now(), "failure_code": None}
        c.require_valid("native-result", native_result)
        return observation.text, native_result, context_ref

    def _tutor_message(self, request: dict, out: TutorOutput, material: dict, *, reply_to_turn: str | None, disposition: str, session_id: str) -> tuple[dict, dict]:
        banner = ""
        if self.adapter.is_test_double and "Fixture tutor" not in out.reply_markdown:
            banner = "**[Fixture tutor — synthetic test reply, not a real tutor and not real feedback]**\n\n"
        sources = [material["spans"][i]["source"] for i in out.sources_used if i < len(material["spans"])]
        message = {"contract": "ll.message/1", "message_id": f"msg-{_short(request['request_id'] + '|tutor', 32)}", "request_id": request["request_id"], "scope": request["scope"],
                   "thread_key": request["thread_key"], "reply_to_turn": reply_to_turn, "role": "tutor", "text": banner + out.reply_markdown, "sources": sources,
                   "attachments": [], "created_at": self.now(), "assessment_disposition": disposition}
        c.require_valid("message", message)
        course_id = request["scope"]["course_id"]
        try:
            ref = self.capture.freeze_message(course_id, session_id, c.dump_json(message))
        except CaptureConflict:
            # The reply for this request was already delivered and frozen (resumed job): the first frozen text stands.
            message, ref = self.capture.read_message(course_id, session_id, message["message_id"])
        return message, ref

    # ---- execution ------------------------------------------------------------------------------
    def _execute(self, job: dict, prior: NativeObservation | None) -> S:
        lease, generation = job["lease_token"], job["generation"]
        try:
            request, payload, directory, payload_bytes = self._bundle(job)
            handler = getattr(self, "_do_" + request["action"])
            records, state, reason, extra = handler(job, lease, request, payload, directory, payload_bytes, prior)
        except _Pause as pause:
            return self._settle(job, lease, pause.state, pause.reason)
        except NativeBlocked as blocked:
            return self._settle(job, lease, S(blocked.job_state), f"{blocked.message} ({blocked.code})")
        published = self._publish_result(job, request, generation, records, extra)
        if published is None:
            current = self.journal.job(job["job_id"])
            return self._settle(job, lease, S.CANCELLED if current["cancel_requested"] else S.SUPERSEDED, "A newer generation exists; this result was kept as late and not published.")
        return self._settle(job, lease, state, reason)

    # -- WF04 -------------------------------------------------------------------------------------
    def _do_ask(self, job, lease, request, payload, directory, payload_bytes, prior):
        course_id = job["course_id"]
        session_id = f"thread-{request['thread_key']}"
        question_ref = self.capture.freeze_message(course_id, session_id, payload_bytes)  # retained before inference
        self.journal.add_receipt(kind="capture", job_id=job["job_id"], generation=job["generation"], ref=question_ref["path"], sha256=question_ref["sha256"], payload={"role": "learner_question"})
        context, material = select_context(self.settings, request=request, sources=payload["sources"], skill_ids=[], question_id=None, for_assessment=False, prior_exposure=None, now=self.now())
        prompt, _ = build_prompt(action="ask", depth=request["depth"], material=material, question_text=payload["text"], policy=self.settings.policy)
        text, native_result, _ = self._native(job, lease, request, prompt=prompt, context=context, session_id=session_id, prior=prior)
        out = parse_tutor_output(text, expect_assessment=False, intended_skill_ids=[], max_sources=len(material["spans"]))
        message, _ = self._tutor_message(request, out, material, reply_to_turn=None, disposition="not_assessed", session_id=session_id)
        publication = self.writer.none_publication(course_id, request["request_id"], self.now(), "Not assessed in this exchange: receiving an answer does not establish understanding. Earlier evidence is unchanged.")
        return {"publication": publication, "message": message, "native-result": native_result, "context": context}, S.SUCCEEDED, None, {"problems": out.problems, "uncertainty": out.uncertainty}

    # -- WF05 -------------------------------------------------------------------------------------
    def _attachments(self, directory: Path, submission: dict) -> dict[str, bytes]:
        found = {}
        for artifact in [*submission["question"]["attachments"], *submission["response"]["attachments"]]:
            path = directory / artifact["path"]
            if path.is_file():
                found[artifact["path"]] = path.read_bytes()
        return found

    def _existing_attempt_for(self, course_id: str, logical_input_id: str) -> str | None:
        attempt_id = self._attempt_id(course_id, logical_input_id)
        records = read_attempt_records(self.settings.course(course_id).root, course_id)
        return attempt_id if attempt_id in records["attempts"] else None

    def _store_candidate(self, job: dict, record_id: str, record: dict) -> None:
        # Stored as exact text: key order is part of the bytes the owner will be asked to keep.
        self.journal.add_receipt(kind="candidate", job_id=job["job_id"], generation=job["generation"], ref=record_id, payload={"record_json": cand.serialize(record).decode("utf-8")})

    def _stored_candidate(self, job: dict) -> dict | None:
        stored = next((r["payload"] for r in self.journal.receipts(job["job_id"], "candidate")), None)
        return json.loads(stored["record_json"]) if stored else None

    @staticmethod
    def _attempt_id(course_id: str, logical_input_id: str) -> str:
        return f"{course_id}-ll-{_short(logical_input_id, 20)}"

    def _assess(self, job, lease, request, submission, directory, payload_bytes, prior):
        course_id = job["course_id"]
        try:
            capture = self.capture.freeze_submission(course_id, payload_bytes, self._attachments(directory, submission))  # BEFORE any inference
        except CaptureError as exc:
            raise _Pause(S.FAILED_FINAL, f"The submitted response could not be captured ({exc.code}); nothing was assessed.") from exc
        self.journal.add_receipt(kind="capture", job_id=job["job_id"], generation=job["generation"], ref=capture["path"], sha256=capture["sha256"], payload={"turn_id": submission["turn_id"]})
        if submission.get("supersedes_capture") is not None:
            corrected = self._capture_correction(job, lease, request, submission, capture, prior)
            if corrected is not None:
                return (*corrected, capture)
        stored = self._stored_candidate(job)
        if stored is None and self._existing_attempt_for(course_id, submission["logical_input_id"]):
            publication = self.writer.blocked(course_id, request["request_id"], "attempt", self.now(), capture=capture,
                                              reason="An attempt for this same learner response is already saved. Re-assessing it is a correction (revision), not another attempt.")
            return {"publication": publication}, S.SUCCEEDED, None, None, capture
        question = submission["question"]
        family = family_for(self.settings, course_id, question["family_id"], question["family_revision"])
        skill_ids = list(family["skill_ids"]) if family else []
        context, material = select_context(self.settings, request=request, sources=question["sources"], skill_ids=skill_ids, question_id=question["question_id"],
                                           for_assessment=family is not None, prior_exposure=submission["conditions"]["prior_exposure"], now=self.now())
        prompt, _ = build_prompt(action=request["action"], depth=request["depth"], material=material, submission=submission, family=family, policy=self.settings.policy)
        text, native_result, _ = self._native(job, lease, request, prompt=prompt, context=context, session_id=submission["session_id"], prior=prior)
        out = parse_tutor_output(text, expect_assessment=family is not None, intended_skill_ids=skill_ids, max_sources=len(material["spans"]))
        extra = {"problems": out.problems, "uncertainty": out.uncertainty, "diagnostic": out.diagnostic, "observations": out.observations,
                 "conditions": submission["conditions"], "criteria": material["rubric"] or ([{"skill_id": r["skill_id"], "observable": r["criterion"]} for r in family["rubric"]] if family else [])}
        if family is None or out.observations is None:
            reason = ("Assessment pending: no reviewed question family/rubric is bound to this response. Your full response is retained." if family is None
                      else "Assessment pending: the tutor returned no usable assessment for the intended skills. Your full response is retained.")
            publication = self.writer.blocked(course_id, request["request_id"], "attempt", self.now(), reason, capture=capture)
            message, _ = self._tutor_message(request, out, material, reply_to_turn=submission["turn_id"], disposition="unavailable", session_id=submission["session_id"])
            return {"publication": publication, "message": message, "native-result": native_result, "context": context}, S.WAITING_REVIEW, reason, extra, capture
        self._settle(job, lease, S.STAGED)
        observations = [cand.observation(o["skill_id"], o["outcome"], submission=submission, analysis=o["analysis"], missing=o["missing_or_incorrect"], error_types=o["error_types"],
                                         confidence=o["assessment_confidence"]) for o in out.observations]
        if stored is not None:
            record = stored  # resumed after an interruption: commit exactly the staged candidate, never a re-timed copy
        else:
            record = cand.build_attempt_candidate(submission=submission, capture=capture, attempt_id=self._attempt_id(course_id, submission["logical_input_id"]),
                                                  recorded_at=self.now_offset(), observations=observations,
                                                  question_version=question_version_for(self.settings, course_id, question["question_id"]))
            self._store_candidate(job, record["attempt_id"], record)
        self._settle(job, lease, S.COMMIT_PENDING)
        publication = self.writer.publish_attempt(course_id, record, capture=capture, submission=submission, request_id=request["request_id"], now=self.now())
        self.journal.add_receipt(kind="publication", job_id=job["job_id"], generation=job["generation"], ref=(publication["canonical_record"] or {}).get("record_id"),
                                 sha256=((publication["canonical_record"] or {}).get("artifact") or {}).get("sha256"), payload=publication)
        saved = publication["status"] in {"saved", "already_saved"}
        message, _ = self._tutor_message(request, out, material, reply_to_turn=submission["turn_id"], disposition="canonical_saved" if saved else "provisional", session_id=submission["session_id"])
        records = {"publication": publication, "message": message, "native-result": native_result, "context": context}
        if saved:
            return records, S.SUCCEEDED, None, extra, capture
        if publication["status"] == "incomplete":
            return records, S.UNCERTAIN_COMPLETION, publication["reason"], extra, capture
        return records, S.WAITING_REVIEW, f"Awaiting course save: {publication['reason']}", extra, capture

    def _capture_correction(self, job, lease, request, submission, capture, prior):
        """The learner corrected how a response was captured (for example a transcription mistake).

        The corrected wording is new evidence linked to the original capture, which is never edited. When
        that original capture belongs to a saved attempt, the same attempt is re-read against the corrected
        wording for the same skills: a changed outcome becomes one linked assessment revision, an unchanged
        one writes nothing. It is not a new attempt. Returns None when no attempt references the original
        capture, so the corrected response is assessed as the (first) attempt for that response.
        """
        course_id = job["course_id"]
        supersedes = submission["supersedes_capture"]
        try:
            self.capture.verify(course_id, supersedes["artifact"], expect_turn_id=supersedes["record_id"])
        except CaptureError as exc:
            raise _Pause(S.FAILED_FINAL, f"The capture being corrected could not be verified ({exc.code}); nothing was changed. Your corrected text is retained.") from exc
        records = read_attempt_records(self.settings.course(course_id).root, course_id)
        target = None
        for attempt_id, attempt in records["attempts"].items():
            match = _LOCATOR.match(attempt["response_evidence"]["locator"])
            if match and match["path"] == supersedes["artifact"]["path"] and match["sha"] == supersedes["artifact"]["sha256"]:
                target = attempt_id
                break
        if target is None:
            return None
        attempt, effective = records["attempts"][target], records["effective"][target]
        if effective["conflict"]:
            raise _Pause(S.WAITING_REVIEW, "This attempt's correction chain is already branched; reconcile it before another revision. Your corrected text is retained.")
        family = family_for(self.settings, course_id, attempt["question"]["family_id"], attempt["question"]["family_revision"])
        if family is None:
            raise _Pause(S.WAITING_REVIEW, "The attempt's question family revision is no longer in the catalog, so the corrected wording was not assessed. It is retained and linked.")
        skill_ids = [o["skill_id"] for o in attempt["observations"]]
        context, material = select_context(self.settings, request=request, sources=submission["question"]["sources"], skill_ids=skill_ids, question_id=submission["question"]["question_id"],
                                           for_assessment=True, prior_exposure=submission["conditions"]["prior_exposure"], now=self.now())
        current = [{k: o[k] for k in ("skill_id", "outcome", "analysis")} for o in effective["observations"]]
        note = "The learner corrected how this same response was captured (for example a transcription mistake). Assess the corrected wording for the same skills."
        prompt, _ = build_prompt(action="correct_assessment", depth=request["depth"], material=material, submission=submission, family=family, policy=self.settings.policy,
                                 correction={"reason": note, "current_observations": current})
        text, native_result, _ = self._native(job, lease, request, prompt=prompt, context=context, session_id=submission["session_id"], prior=prior)
        out = parse_tutor_output(text, expect_assessment=True, intended_skill_ids=skill_ids, max_sources=len(material["spans"]))
        if out.observations is None:
            raise _Pause(S.WAITING_REVIEW, "The corrected wording could not be assessed for the same skills; the earlier assessment stands and your corrected text is retained and linked.")
        before = {o["skill_id"]: o["outcome"] for o in effective["observations"]}
        after = {o["skill_id"]: o["outcome"] for o in out.observations}
        extra = {"observations": out.observations, "previous_outcomes": before, "problems": out.problems, "conditions": submission["conditions"], "capture_correction": {"attempt_id": target}}
        if before == after:
            message, _ = self._tutor_message(request, out, material, reply_to_turn=submission["turn_id"], disposition="canonical_saved", session_id=submission["session_id"])
            publication = self.writer.none_publication(course_id, request["request_id"], self.now(), capture=capture,
                                                       reason="Corrected wording recorded and linked to the original capture. The assessment is unchanged: no revision was written and no new attempt exists.")
            return {"publication": publication, "message": message, "native-result": native_result, "context": context}, S.SUCCEEDED, None, extra
        self._settle(job, lease, S.STAGED)
        by_skill = {o["skill_id"]: o for o in effective["observations"]}
        stored = self._stored_candidate(job)
        revision = stored if stored is not None else {
            "contract_version": "course-learning-v1", "course_id": course_id, "term": request["scope"]["term"], "record_kind": "assessment_revision",
            "event_id": f"{course_id}-ll-rev-{_short(request['request_id'], 20)}", "attempt_id": target, "replaces_assessment_id": effective["assessment_id"], "recorded_at": self.now_offset(),
            "reason": (f"Capture correction: the learner corrected how this response was captured; assessed from the corrected wording in capture {capture['path']} "
                       f"sha256:{capture['sha256']}. The original capture is kept unchanged.")[:2000],
            "observations": [{"skill_id": o["skill_id"], "outcome": o["outcome"], "assistance": by_skill[o["skill_id"]]["assistance"], "reference_access": by_skill[o["skill_id"]]["reference_access"],
                              "analysis": o["analysis"], "missing_or_incorrect": o["missing_or_incorrect"], "error_types": o["error_types"], "assessment_confidence": o["assessment_confidence"]}
                             for o in out.observations]}
        if stored is None:
            self._store_candidate(job, revision["event_id"], revision)
        self._settle(job, lease, S.COMMIT_PENDING)
        publication = self.writer.publish_revision(course_id, revision, capture=capture, submission=submission, request_id=request["request_id"], now=self.now())
        self.journal.add_receipt(kind="publication", job_id=job["job_id"], generation=job["generation"], ref=(publication["canonical_record"] or {}).get("record_id"), payload=publication)
        saved = publication["status"] in {"saved", "already_saved"}
        message, _ = self._tutor_message(request, out, material, reply_to_turn=submission["turn_id"], disposition="canonical_saved" if saved else "provisional", session_id=submission["session_id"])
        records_out = {"publication": publication, "message": message, "native-result": native_result, "context": context}
        return records_out, (S.SUCCEEDED if saved else S.WAITING_REVIEW), (None if saved else f"Awaiting course save: {publication['reason']}"), extra

    def _do_explain(self, job, lease, request, payload, directory, payload_bytes, prior):
        return self._assess(job, lease, request, payload, directory, payload_bytes, prior)[:4]

    _do_practice = _do_explain

    def _do_review_answer(self, job, lease, request, payload, directory, payload_bytes, prior):
        records, state, reason, extra, capture = self._assess(job, lease, request, payload, directory, payload_bytes, prior)
        publication = records["publication"]
        items = self.reviews.items(job["course_id"])["current"]
        match = next((e for e in items.values() if e["record"]["question"]["question_id"] == payload["question"]["question_id"] and e["record"]["selection"] == "active"), None)
        if match is not None and extra is not None:
            unaided = payload["conditions"]["assistance_before_answer"] == "none_reported"
            assisted = "none_reported" if unaided else ("unknown" if payload["conditions"]["assistance_before_answer"] == "unknown" else "assisted")
            saved = publication["status"] in {"saved", "already_saved"}
            rating = rating_from_observations(extra.get("observations") or []) if extra.get("observations") else None
            apply = bool(saved and unaided and rating is not None)
            event = {"contract": "ll.review-event/1", "event_id": f"rev-{_short(payload['logical_input_id'], 24)}", "scope": request["scope"], "item_id": match["record"]["item_id"],
                     "item_revision": match["record"]["revision"], "submission": capture, "attempt": publication["canonical_record"] if saved else None,
                     "occurred_at": self.now(), "rating": rating if (saved and rating is not None) else None,
                     "rating_basis": "reviewed_observation" if (saved and rating is not None) else "unresolved", "assistance_before_answer": assisted, "apply_schedule": apply,
                     "scheduler_config": self.reviews.scheduler_config(job["course_id"]), "previous_schedule_revision": None}
            try:
                self.reviews.record_event(job["course_id"], c.dump_json(event))
                extra["review_event"] = {"event_id": event["event_id"], "apply_schedule": apply, "rating": event["rating"], "rating_basis": event["rating_basis"],
                                         "note": None if apply else "Kept as practice: no rating was fed to the scheduler (assisted, uncertain, or not yet saved)."}
            except ReviewError as exc:
                extra["review_event"] = {"error": exc.message}
        return records, state, reason, extra

    # -- WF06 -------------------------------------------------------------------------------------
    def _diagnose_depth(self, request: dict) -> int:
        depth, parent = 0, request["parent_request_id"]
        while parent and depth < 20:
            admission = self.journal.admission(parent)
            if admission is None:
                break
            depth += admission["action"] == "diagnose"
            parent = admission["parent_request_id"]
        return depth

    def _do_diagnose(self, job, lease, request, payload, directory, payload_bytes, prior):
        course_id = job["course_id"]
        try:
            capture = self.capture.freeze_submission(course_id, payload_bytes, self._attachments(directory, payload))
        except CaptureError as exc:
            raise _Pause(S.FAILED_FINAL, f"The diagnostic answer could not be captured ({exc.code}).") from exc
        self.journal.add_receipt(kind="capture", job_id=job["job_id"], generation=job["generation"], ref=capture["path"], sha256=capture["sha256"], payload={"turn_id": payload["turn_id"]})
        used = self._diagnose_depth(request)
        limit = int(self.settings.policy["diagnostic_default_followups"])
        context, material = select_context(self.settings, request=request, sources=payload["question"]["sources"], skill_ids=[], question_id=None, for_assessment=False,
                                           prior_exposure=payload["conditions"]["prior_exposure"], now=self.now())
        prompt, _ = build_prompt(action="diagnose", depth=request["depth"], material=material, submission=payload, policy=self.settings.policy, diagnostic_state={"followups_used": used})
        text, native_result, _ = self._native(job, lease, request, prompt=prompt, context=context, session_id=payload["session_id"], prior=prior)
        out = parse_tutor_output(text, expect_assessment=False, intended_skill_ids=[], max_sources=len(material["spans"]))
        diagnostic = out.diagnostic or {"hypotheses": [], "next_prompt": None}
        if used + 1 >= limit:
            diagnostic = dict(diagnostic, next_prompt=None)  # the short detour ends here; more depth needs the learner's fresh choice
        proposal = {"kind": "diagnostic_proposal", "status": "waiting_user" if diagnostic["next_prompt"] else "closed", "hypotheses": diagnostic["hypotheses"],
                    "next_prompt": diagnostic["next_prompt"], "followups_used": used + 1, "followups_limit": limit, "captured_answer": capture,
                    "note": "Hypotheses are proposals, not assessed observations. An unanswered prompt is pending, not failed."}
        self.capture.write_record(course_id, payload["session_id"], "proposals", f"diag-{_short(request['request_id'], 24)}", c.dump_json(proposal))
        message, _ = self._tutor_message(request, out, material, reply_to_turn=payload["turn_id"], disposition="not_assessed", session_id=payload["session_id"])
        publication = self.writer.none_publication(course_id, request["request_id"], self.now(), "Diagnostic exchange: kept as an operational proposal, not an assessed attempt.")
        records = {"publication": publication, "message": message, "native-result": native_result, "context": context}
        if diagnostic["next_prompt"]:
            return records, S.WAITING_USER, "Waiting for your answer to the diagnostic question. Nothing runs until you respond; you can also skip.", {"diagnostic": proposal}
        return records, S.SUCCEEDED, None, {"diagnostic": proposal}

    # -- WF09: assessment dispute -----------------------------------------------------------------
    def _do_correct_assessment(self, job, lease, request, payload, directory, payload_bytes, prior):
        course_id = job["course_id"]
        root = self.settings.course(course_id).root
        target = payload["command"]["attempt"]
        records = read_attempt_records(root, course_id)
        attempt = records["attempts"].get(target["record_id"])
        if attempt is None or attempt["_sha256"] != target["artifact"]["sha256"]:
            raise _Pause(S.FAILED_FINAL, "The disputed attempt does not exist with the referenced bytes; nothing was changed.")
        effective = records["effective"][target["record_id"]]
        if effective["conflict"]:
            raise _Pause(S.WAITING_REVIEW, "This attempt's correction chain is already branched; reconcile it before another revision.")
        match = _LOCATOR.match(attempt["response_evidence"]["locator"])
        if not match:
            raise _Pause(S.WAITING_REVIEW, "This attempt has no verifiable full-turn capture, so it cannot be regraded automatically. Your dispute is kept for owner review.")
        capture = {"path": match["path"], "sha256": match["sha"], "bytes": int(match["bytes"]), "media_type": "application/json"}
        try:
            submission = self.capture.verify(course_id, capture, expect_turn_id=match["turn"])
        except CaptureError as exc:
            raise _Pause(S.WAITING_REVIEW, f"The captured response for this attempt could not be verified ({exc.code}); it was not regraded.") from exc
        family = family_for(self.settings, course_id, attempt["question"]["family_id"], attempt["question"]["family_revision"])
        if family is None:
            raise _Pause(S.WAITING_REVIEW, "The attempt's question family revision is no longer in the catalog; a rubric change needs a separate reviewed path.")
        skill_ids = [o["skill_id"] for o in attempt["observations"]]
        context, material = select_context(self.settings, request=request, sources=submission["question"]["sources"], skill_ids=skill_ids, question_id=submission["question"]["question_id"],
                                           for_assessment=True, prior_exposure=submission["conditions"]["prior_exposure"], now=self.now())
        current = [{k: o[k] for k in ("skill_id", "outcome", "analysis")} for o in effective["observations"]]
        prompt, _ = build_prompt(action="correct_assessment", depth=request["depth"], material=material, submission=submission, family=family, policy=self.settings.policy,
                                 correction={"reason": payload["command"]["reason"], "current_observations": current})
        text, native_result, _ = self._native(job, lease, request, prompt=prompt, context=context, session_id=submission["session_id"], prior=prior)
        out = parse_tutor_output(text, expect_assessment=True, intended_skill_ids=skill_ids, max_sources=len(material["spans"]))
        if out.observations is None:
            raise _Pause(S.WAITING_REVIEW, "The regrade returned no usable assessment for the same skills; the original assessment stands and your dispute is kept.")
        before = {o["skill_id"]: o["outcome"] for o in effective["observations"]}
        after = {o["skill_id"]: o["outcome"] for o in out.observations}
        extra = {"observations": out.observations, "previous_outcomes": before, "problems": out.problems, "dispute_reason": payload["command"]["reason"]}
        if before == after:
            message, _ = self._tutor_message(request, out, material, reply_to_turn=submission["turn_id"], disposition="canonical_saved", session_id=submission["session_id"])
            publication = self.writer.none_publication(course_id, request["request_id"], self.now(), "Reviewed: the assessment is unchanged. No revision was written and no new attempt exists.")
            return {"publication": publication, "message": message, "native-result": native_result, "context": context}, S.SUCCEEDED, None, extra
        self._settle(job, lease, S.STAGED)
        by_skill = {o["skill_id"]: o for o in effective["observations"]}
        stored = self._stored_candidate(job)
        revision = stored if stored is not None else {"contract_version": "course-learning-v1", "course_id": course_id, "term": request["scope"]["term"], "record_kind": "assessment_revision",
                    "event_id": f"{course_id}-ll-rev-{_short(request['request_id'], 20)}", "attempt_id": target["record_id"], "replaces_assessment_id": effective["assessment_id"],
                    "recorded_at": self.now_offset(), "reason": f"Learner dispute: {payload['command']['reason']}"[:2000],
                    "observations": [{"skill_id": o["skill_id"], "outcome": o["outcome"], "assistance": by_skill[o["skill_id"]]["assistance"], "reference_access": by_skill[o["skill_id"]]["reference_access"],
                                      "analysis": o["analysis"], "missing_or_incorrect": o["missing_or_incorrect"], "error_types": o["error_types"], "assessment_confidence": o["assessment_confidence"]}
                                     for o in out.observations]}
        if stored is None:
            self._store_candidate(job, revision["event_id"], revision)
        self._settle(job, lease, S.COMMIT_PENDING)
        publication = self.writer.publish_revision(course_id, revision, capture=capture, submission=submission, request_id=request["request_id"], now=self.now())
        self.journal.add_receipt(kind="publication", job_id=job["job_id"], generation=job["generation"], ref=(publication["canonical_record"] or {}).get("record_id"), payload=publication)
        saved = publication["status"] in {"saved", "already_saved"}
        message, _ = self._tutor_message(request, out, material, reply_to_turn=submission["turn_id"], disposition="canonical_saved" if saved else "provisional", session_id=submission["session_id"])
        records_out = {"publication": publication, "message": message, "native-result": native_result, "context": context}
        return records_out, (S.SUCCEEDED if saved else S.WAITING_REVIEW), (None if saved else f"Awaiting course save: {publication['reason']}"), extra

    # -- deterministic workflows (no native turn) -------------------------------------------------
    def _owned(self, course_id: str, request_id: str, kind: str, writer_id: str, result: dict) -> dict:
        status = result["status"]
        if status in {"saved", "already_saved"} and self.settings.writes_are_staged:
            status, result = "blocked", dict(result, reason="Saved to local staging only: course writes are not enabled, so the owning record was not changed.")
        if status in {"saved", "already_saved"}:
            record_ref = {"record_id": Path(result["artifact"]["path"]).name.rsplit(".json", 1)[0][:128], "artifact": result["artifact"]}
            return c.require_valid("publication", {"contract": "ll.publication/1", "receipt_id": "pub-" + _short(f"{request_id}|{kind}|{status}", 32), "request_id": request_id,
                                                   "scope": {"course_id": course_id, "term": self.settings.course(course_id).term}, "writer_id": writer_id, "kind": kind, "status": status,
                                                   "canonical_record": record_ref, "view_status": "current", "captured_submission": None, "observed_at": self.now(), "reason": None})
        return c.require_valid("publication", {"contract": "ll.publication/1", "receipt_id": "pub-" + _short(f"{request_id}|{kind}|blocked", 32), "request_id": request_id,
                                               "scope": {"course_id": course_id, "term": self.settings.course(course_id).term}, "writer_id": writer_id, "kind": kind, "status": "blocked",
                                               "canonical_record": None, "view_status": "not_applicable", "captured_submission": None, "observed_at": self.now(),
                                               "reason": str(result.get("reason") or "blocked")[:2000]})

    def _do_correct_source(self, job, lease, request, payload, directory, payload_bytes, prior):
        try:
            result = self.annotations.propose(job["course_id"], payload_bytes)
        except AnnotationError as exc:
            raise _Pause(S.FAILED_FINAL, f"The link correction was rejected: {exc.message}") from exc
        publication = self._owned(job["course_id"], request["request_id"], "source_annotation", "source-link-sidecar", result)
        if result["status"] == "conflict":
            return {"publication": publication}, S.WAITING_USER, result["reason"], {"conflict_id": result["conflict_id"]}
        self.annotations.export_alignment(job["course_id"])
        return {"publication": publication}, S.SUCCEEDED, None, None

    def _do_select_review(self, job, lease, request, payload, directory, payload_bytes, prior):
        try:
            result = self.reviews.save_item(job["course_id"], payload_bytes)
        except ReviewError as exc:
            raise _Pause(S.FAILED_FINAL, f"The review item was rejected: {exc.message}") from exc
        publication = self._owned(job["course_id"], request["request_id"], "review", "review-owner", result)
        if result["status"] == "conflict":
            return {"publication": publication}, S.WAITING_USER, result["reason"], None
        return {"publication": publication}, S.SUCCEEDED, None, None

    _do_edit_review = _do_select_review

    def _do_save_note(self, job, lease, request, payload, directory, payload_bytes, prior):
        publish_exclusive(self.settings.app_area(job["course_id"]) / "notes" / f"{_short(payload['event_id'], 40)}.json", payload_bytes)
        attachments = self.settings.app_area(job["course_id"]) / "notes" / "attachments"
        for artifact in payload["command"]["attachments"]:
            source = directory / artifact["path"]
            if source.is_file():
                publish_exclusive(attachments / artifact["sha256"], source.read_bytes())
        publication = self.writer.none_publication(job["course_id"], request["request_id"], self.now(), "Note saved as your own authored work. It is not learning evidence.")
        return {"publication": publication}, S.SUCCEEDED, None, None

    def _do_resume(self, job, lease, request, payload, directory, payload_bytes, prior):
        draft = payload["cursor"]["draft"]
        draft_bytes = (directory / draft["path"]).read_bytes() if draft and (directory / draft["path"]).is_file() else None
        try:
            self.resume.save_checkpoint(job["course_id"], payload_bytes, draft_bytes)
        except ResumeError as exc:
            raise _Pause(S.FAILED_FINAL, f"The checkpoint was rejected: {exc.message}") from exc
        publication = self.writer.none_publication(job["course_id"], request["request_id"], self.now(), "Study position checkpoint received. It is not learning evidence.")
        return {"publication": publication}, S.SUCCEEDED, None, None

    def _do_cancel(self, job, lease, request, payload, directory, payload_bytes, prior):
        target_id = payload["command"]["target_request_id"]
        target = self.journal.job_for_request(target_id)
        if target is None or target["course_id"] != job["course_id"]:
            raise _Pause(S.FAILED_FINAL, "The request to cancel was not found for this course.")
        state = self.journal.request_cancel(target_id)
        note = {S.CANCELLED: "Cancelled before any native work started. Your captured input is kept."}.get(state, f"Cancellation requested while the job was {state}. It is not terminal until verified; captured input and any saved record are kept.")
        publication = self.writer.none_publication(job["course_id"], request["request_id"], self.now(), note)
        return {"publication": publication}, S.SUCCEEDED, None, {"target_request_id": target_id, "target_state": str(self.journal.job(target["job_id"])["state"])}

    def _do_source_hint(self, job, lease, request, payload, directory, payload_bytes, prior):
        hint = {"request_id": request["request_id"], "drive_file_ids": payload["command"]["drive_file_ids"], "reason": payload["command"]["reason"], "at": self.now()}
        publish_exclusive(self.settings.app_area(job["course_id"]) / "source-hints" / f"{_short(request['request_id'], 40)}.json", c.dump_json(hint))
        self.journal.enqueue_internal(workflow="WF02", course_id=job["course_id"], thread_key=f"prep-{job['course_id']}", priority=3, input_digest=c.sha256_hex(c.dump_json(hint)),
                                      detail={"kind": "inventory-refresh", "reason": "source hint"})
        publication = self.writer.none_publication(job["course_id"], request["request_id"], self.now(),
                                                   "Hint recorded. Registration stays with the existing course updater; this app does not register sources itself.")
        return {"publication": publication}, S.SUCCEEDED, None, None

    # ---- recovery: reconcile, never blind retry -------------------------------------------------
    def reconcile(self, job_id: str) -> S:
        """User-initiated "Check status": use existing receipts and native state; do not re-run the turn."""
        job = self.journal.job(job_id)
        if job["state"] not in {S.UNCERTAIN_COMPLETION, S.STAGED, S.COMMIT_PENDING}:
            return job["state"]
        leased = self.journal.acquire_for_reconcile(job_id, self._owner)
        if leased["cancel_requested"]:
            return self._reconcile_cancelled(leased)
        outputs = [r for r in self.journal.receipts(job_id, "native-output") if r["generation"] == leased["generation"]]
        if outputs:
            path = self.settings.write_root(leased["course_id"]) / outputs[-1]["ref"]
            text = json.loads(path.read_bytes())["text"]
            observation = NativeObservation("completed", outputs[-1]["payload"].get("native_turn_id"), text)
        else:
            dispatches = [d for d in self.journal.dispatches(job_id) if d["generation"] == leased["generation"]]
            if not dispatches:
                self.journal.transition(job_id, leased["lease_token"], S.READY)
                return S.READY
            request, *_ = self._bundle(leased)
            try:
                target = resolve_target(self.settings, course_id=leased["course_id"], request_binding_revision=request["binding_revision"], request_thread_key=request["thread_key"])
                observation = self.adapter.status(NativeSubmission(dispatches[-1]["dispatch_id"], request["request_id"], target, "", 30.0), dispatches[-1]["native_turn_id"])
            except NativeBlocked as blocked:
                self.journal.heartbeat(job_id, leased["lease_token"], 0)
                return self._note_uncertain(job_id, f"Still unknown: {blocked.message}")
            if observation.state == "completion_unknown":
                return self._note_uncertain(job_id, "Still unknown after checking the native turn. Nothing was re-sent.")
        try:
            return self._execute(leased, prior=observation)
        except StaleLease:
            return self.journal.job(job_id)["state"]

    def _reconcile_cancelled(self, leased: dict) -> S:
        """Cancellation was requested while a turn may have been running: make it terminal only on evidence."""
        job_id = leased["job_id"]
        pending = [d for d in self.journal.dispatches(job_id) if d["state"] == "submitted"]
        if pending:
            last = pending[-1]
            request, *_ = self._bundle(leased)
            try:
                target = resolve_target(self.settings, course_id=leased["course_id"], request_binding_revision=request["binding_revision"], request_thread_key=request["thread_key"])
                submission = NativeSubmission(last["dispatch_id"], request["request_id"], target, "", 30.0)
                observation = self.adapter.status(submission, last["native_turn_id"])
                if observation.state == "completion_unknown":
                    observation = self.adapter.interrupt(submission, last["native_turn_id"])
            except NativeBlocked as blocked:
                return self._note_uncertain(job_id, f"Cancellation requested; the native turn's end state is still unknown: {blocked.message}")
            if not observation.terminal:
                return self._note_uncertain(job_id, "Cancellation requested; the native turn has not reached a verified terminal state yet.")
            self.journal.complete_dispatch(last["dispatch_id"], state=observation.state, native_turn_id=observation.native_turn_id, failure_code=observation.failure_code)
            payload = {"note": "The turn ended after cancellation was requested. Its output is kept as late and was not published or saved.", "native_state": observation.state}
            if observation.text:
                kept = self.settings.app_area(leased["course_id"]) / "outbox" / request["request_id"] / f"late-g{last['generation']}" / "native-output.json"
                publish_exclusive(kept, c.dump_json({"dispatch_id": last["dispatch_id"], "text": observation.text}))
                payload["ref"] = kept.relative_to(self.settings.write_root(leased["course_id"])).as_posix()
            self.journal.add_receipt(kind="late-result", job_id=job_id, generation=last["generation"], payload=payload)
        return self._settle(leased, leased["lease_token"], S.CANCELLED, "Cancelled. Captured input and any record already saved are kept.")

    def _note_uncertain(self, job_id: str, reason: str) -> S:
        self.journal.add_receipt(kind="reconcile", job_id=job_id, payload={"result": reason, "at": self.now()})
        return self.journal.job(job_id)["state"]

    def retry(self, job_id: str, *, reason: str = "explicit user retry") -> S:
        """Deliberate retry of a failed or still-unknown job: same learner input, new dispatch identity."""
        job = self.journal.job(job_id)
        if job["state"] in {S.UNCERTAIN_COMPLETION, S.AUTH_REQUIRED, S.QUOTA_WAIT, S.WAITING_USER, S.WAITING_REVIEW, S.WAITING_SOURCE}:
            self.journal.supersede_generation(job_id, reason)
            self.journal.resume_waiting(job_id, expected=job["state"], reason=reason)
            return S.READY
        return job["state"]
