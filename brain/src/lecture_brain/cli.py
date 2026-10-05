"""Command line entry point: ``lecture-brain`` (or ``python -m lecture_brain``).

Nothing here installs a service, a schedule or a startup entry. ``serve`` runs in the foreground
on loopback until you stop it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import ConfigError, load_settings


def _print(value) -> None:
    sys.stdout.write(json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lecture-brain", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", choices=["fixture", "local", "live", "pilot"], help="fixture (synthetic, default) | local (real roots, read-only, staged writes) | live | pilot (allow-listed course, budgeted Codex worker, no recording)")
    parser.add_argument("--state-dir", type=Path, help="Local nonsynced state directory (journal, keys, staging)")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Run the loopback API and supervisor in the foreground")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--no-supervisor", action="store_true", help="Serve read views only; do not process requests")
    serve.add_argument("--static", type=Path, help="Built web app directory to serve (default: web/dist when present)")
    sub.add_parser("status", help="Bindings, capabilities and queue counts")
    sub.add_parser("coverage", help="All-lecture preparation coverage")
    prepare = sub.add_parser("prepare", help="Run one bounded preparation batch")
    prepare.add_argument("--course")
    prepare.add_argument("--max-units", type=int, default=8)
    probe = sub.add_parser("probe-native", help="Inspect (default) or prove the native connection on a disposable target")
    probe.add_argument("--execute", action="store_true", help="Send the bounded proof to the bound DISPOSABLE thread (never a course thread)")
    probe.add_argument("--continuity", action="store_true", help="Continuity on the EXISTING disposable proof thread: inspect by default; with --execute at most two synthetic turns across a reconnect, once")
    probe.add_argument("--disposable", action="store_true", help="Single-request proof on a NEW disposable thread: reads the effective scope back first; with --execute sends exactly one synthetic request")
    sub.add_parser("acceptance", help="Run the fail-closed live-acceptance report")
    backup = sub.add_parser("backup", help="Consistent backup of the local journal")
    backup.add_argument("--dest", type=Path, required=True)
    evaluate = sub.add_parser("evaluate", help="Run the evaluation harness on labelled case files")
    evaluate.add_argument("cases", nargs="+", type=Path)
    evaluate.add_argument("--scripted", action="store_true", help="Offline mechanics only: use the replies written in the case files (labeled double, no tutor, can never promote)")
    sub.add_parser("devices", help="List paired and pending devices")
    approve = sub.add_parser("pair-approve", help="Approve a pending device after reviewing its fingerprint")
    approve.add_argument("key_id")
    approve.add_argument("fingerprint")
    args = parser.parse_args(argv)

    try:
        settings = load_settings(args.profile, state_dir=args.state_dir)
    except ConfigError as exc:
        print(f"Configuration problem: {exc}", file=sys.stderr)
        return 2

    from .runtime import Runtime

    runtime = Runtime(settings)
    try:
        if args.command == "serve":
            import uvicorn

            from .api import create_app

            host = settings.policy["loopback_operator_bind"]
            if host != "127.0.0.1":
                print("Refusing to bind a non-loopback address.", file=sys.stderr)
                return 2
            static = args.static or (settings.repo / "web" / "dist")
            app = create_app(runtime, static_dir=static if static.is_dir() else None)
            print(json.dumps({"startup": runtime.startup(), "profile": settings.profile, "label": settings.fixture_label, "url": f"http://{host}:{args.port}/"}))
            if not args.no_supervisor:
                runtime.start_supervisor()
            uvicorn.run(app, host=host, port=args.port, log_level="warning")
            return 0
        if args.command == "status":
            _print({"profile": settings.profile, "binding_revision": settings.binding_revision, "courses": {k: {"status": v.status, "problem": v.problem} for k, v in settings.courses.items()},
                    "capabilities": runtime.maintenance.capabilities(runtime.adapter), "queue": runtime.journal.counts()})
        elif args.command == "coverage":
            _print(runtime.preparation.coverage())
        elif args.command == "prepare":
            courses = [args.course] if args.course else sorted(c for c, b in settings.courses.items() if b.usable)
            _print([runtime.preparation.prepare_course(course, max_units=args.max_units) for course in courses])
        elif args.command == "probe-native":
            from .native.probe import probe_native

            if args.continuity:
                from .native.continuity_proof import run_continuity_proof

                report = run_continuity_proof(settings, execute=args.execute)
                _print(report)
                return 0 if report.get("ready_to_execute") or report["classification"]["process_roundtrip"] == "VERIFIED" else 1
            if args.disposable:
                from .native.disposable_proof import run_disposable_proof

                report = run_disposable_proof(settings, execute=args.execute)
                _print(report)
                return 0 if report["classification"] == "SEPARATE_WORKER_ONLY" or report.get("ready_to_execute") else 1
            report = probe_native(settings, execute=args.execute)
            _print(report)
            return 0 if report["status"] in {"PASS", "INSPECT_ONLY"} else 1
        elif args.command == "acceptance":
            from .acceptance import run_acceptance

            report = run_acceptance(settings, runtime.journal, reports_dir=settings.state_dir / "reports", preparation=runtime.preparation)
            _print(report)
            return 0 if report["overall"] == "READY" else 1
        elif args.command == "backup":
            _print(runtime.maintenance.backup_journal(args.dest))
        elif args.command == "evaluate":
            from .evaluation import ScriptedReplyAdapter, run_evaluation

            report = run_evaluation(args.cases, ScriptedReplyAdapter(args.cases) if args.scripted else runtime.adapter, policy=settings.policy, out_dir=settings.state_dir / "reports" / "evaluation", rubric_digest=settings.policy_revision)
            _print(report)
            return 0 if report["promotion"]["promote"] else 1
        elif args.command == "devices":
            _print(runtime.pairing.devices())
        elif args.command == "pair-approve":
            _print(runtime.pairing.approve(args.key_id, reviewed_fingerprint=args.fingerprint))
        return 0
    finally:
        if args.command != "serve":
            runtime.journal.close()


if __name__ == "__main__":
    raise SystemExit(main())
