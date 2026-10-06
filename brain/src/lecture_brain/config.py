"""Runtime settings and trusted local bindings.

The existing ``planner-config.yaml`` stays the authority for course roots; this module only reads
it. Nothing here grants a capability: live flags default to disabled and every request-supplied
value (root, thread, executable, permission) is ignored in favour of these local bindings.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path
import json
import os
from typing import Any, Mapping

import yaml

from .contracts import dump_json, sha256_hex

TERM = "2026-fall"
PROFILES = ("fixture", "local", "live", "pilot")
PILOT_MAX_TURNS = 4  # the size of the one grant given for the pilot; a larger number in a file is refused, not honoured


class ConfigError(RuntimeError):
    pass


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "contracts" / "index.json").is_file() and (parent / "config" / "defaults.json").is_file():
            return parent
    raise ConfigError("Repository root not found (contracts/ and config/ expected)")


@dataclass(frozen=True)
class CourseBinding:
    course_id: str
    term: str
    root: Path
    display_name: str
    thread_key: str
    status: str = "bound"  # bound | missing_root | identity_mismatch
    problem: str | None = None
    native_thread_id: str | None = None
    # App-side read configuration (never a course edit): a chosen deck per lecture unit, the collections whose slide
    # numbers the owner confirmed as physical pages, and the source ids the course's own question catalog cites.
    deck_overrides: Mapping[str, str] = field(default_factory=dict)
    reviewed_collections: tuple[str, ...] = ()
    cited_source_ids: tuple[str, ...] = ()
    # Offer, as a labelled suggestion, a session the course index links to no unit when its file names carry that
    # unit's number. Off unless the private read configuration switches it on; the index itself is never changed.
    suggest_session_links: bool = False

    @property
    def usable(self) -> bool:
        return self.status == "bound"


@dataclass
class Settings:
    profile: str
    repo: Path
    state_dir: Path
    planner_root: Path
    planner_config: Path
    courses: dict[str, CourseBinding]
    policy: dict[str, Any]
    course_writes_enabled: bool = False
    native_dispatch_enabled: bool = False
    native_binding: dict[str, Any] = field(default_factory=dict)
    fixture_label: str | None = None
    pilot: dict[str, Any] = field(default_factory=dict)

    # ---- derived locations -------------------------------------------------------------------
    @property
    def journal_path(self) -> Path:
        return self.state_dir / "journal.sqlite"

    @property
    def keys_dir(self) -> Path:
        return self.state_dir / "keys"

    @property
    def workspace_area(self) -> Path:
        """Cross-course app views (course list, device registry export). Never course-owned data."""
        return self.state_dir / "workspace-area"

    def course(self, course_id: str) -> CourseBinding:
        binding = self.courses.get(course_id)
        if binding is None:
            raise ConfigError(f"Course {course_id!r} is not in the trusted local binding")
        return binding

    def write_root(self, course_id: str) -> Path:
        """Root under which the app creates its own files for a course.

        With course writes disabled (the default outside the fixture profile) nothing is created
        inside the real course folder: app files are staged in a local shadow tree instead.
        """
        binding = self.course(course_id)
        if self.course_writes_enabled:
            return binding.root
        return self.state_dir / "shadow" / course_id

    def app_area(self, course_id: str) -> Path:
        return self.write_root(course_id) / ".agent" / "learning-app"

    def runs_area(self, course_id: str) -> Path:
        return self.write_root(course_id) / ".agent" / "course-learning" / "runs"

    def source_links_area(self, course_id: str) -> Path:
        return self.write_root(course_id) / "work" / "lecture-review" / "source-links"

    def exports_area(self, course_id: str) -> Path:
        return self.write_root(course_id) / "exports" / "learning"

    @property
    def writes_are_staged(self) -> bool:
        return not self.course_writes_enabled

    @property
    def synced_roots(self) -> list[Path]:
        return [self.planner_root, *(b.root for b in self.courses.values())]

    @property
    def binding_revision(self) -> str:
        """Digest of the trusted binding; requests must name the revision they were built against."""
        material = {
            "term": TERM,
            "profile": self.profile,
            "courses": {cid: {"root": b.root.as_posix(), "thread_key": b.thread_key, "native_thread_id": b.native_thread_id, "status": b.status} for cid, b in sorted(self.courses.items())},
            "native": {k: self.native_binding.get(k) for k in sorted(self.native_binding) if k != "notes"},
            "course_writes_enabled": self.course_writes_enabled,
            "native_dispatch_enabled": self.native_dispatch_enabled,
            "pilot": self.pilot if self.profile == "pilot" else None,
        }
        return sha256_hex(dump_json(material))

    @property
    def policy_revision(self) -> str:
        return sha256_hex(dump_json(self.policy))


def load_policy(repo: Path) -> dict[str, Any]:
    policy = json.loads((repo / "config" / "defaults.json").read_text(encoding="utf-8"))
    if policy.get("contract") != "ll.policy-defaults/1":
        raise ConfigError("Unsupported policy defaults contract")
    return policy


def read_planner_config(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Cannot read planner config: {exc}") from exc
    if not isinstance(data, dict) or data.get("contract") != "main-planner-config-v1":
        raise ConfigError("Planner config is not main-planner-config-v1")
    return data


def _bind_course(course_id: str, root: Path, native_threads: Mapping[str, str]) -> CourseBinding:
    thread_key = f"tutor-{course_id}"
    native = native_threads.get(course_id)
    if not root.is_dir():
        return CourseBinding(course_id, TERM, root, course_id.upper(), thread_key, "missing_root", f"Course root not found: {root}", native)
    course_yaml = root / "course.yaml"
    display = course_id.upper()
    try:
        meta = yaml.safe_load(course_yaml.read_text(encoding="utf-8-sig")) or {}
    except (OSError, yaml.YAMLError) as exc:
        return CourseBinding(course_id, TERM, root, display, thread_key, "identity_mismatch", f"course.yaml unreadable: {exc}", native)
    if meta.get("course_id") != course_id or meta.get("term") != TERM:
        problem = f"course.yaml identifies {meta.get('course_id')!r}/{meta.get('term')!r}, expected {course_id!r}/{TERM!r}"
        return CourseBinding(course_id, TERM, root, display, thread_key, "identity_mismatch", problem, native)
    return CourseBinding(course_id, TERM, root, str(meta.get("display_name") or display), thread_key, "bound", None, native)


def _with_read_configuration(binding: CourseBinding, overrides: Mapping[str, Any]) -> CourseBinding:
    """Attach the app's read-side configuration for one course. The question catalog is read only for the ids it cites."""
    if not binding.usable:
        return binding
    cited: set[str] = set()
    try:
        index = json.loads((binding.root / "learning" / "question-index.json").read_text(encoding="utf-8-sig"))
        cited = {r.get("source_id") for q in index.get("questions") or [] for r in q.get("source_refs") or [] if isinstance(r, dict) and r.get("source_id")}
    except (OSError, ValueError, AttributeError):
        pass  # no catalog, or one the catalog reader will report: deck choice then simply has no question references
    decks = (overrides.get("deck_overrides") or {}).get(binding.course_id) or {}
    reviewed = (overrides.get("reviewed_page_basis") or {}).get(binding.course_id) or []
    wanted = overrides.get("suggest_session_links")
    suggest = wanted is True or (isinstance(wanted, (list, tuple)) and binding.course_id in wanted)
    return replace(binding, deck_overrides={str(k): str(v) for k, v in decks.items()}, reviewed_collections=tuple(str(c) for c in reviewed), cited_source_ids=tuple(sorted(cited)),
                   suggest_session_links=suggest)


def load_settings(profile: str | None = None, *, env: Mapping[str, str] | None = None, repo: Path | None = None,
                  planner_config: Path | None = None, state_dir: Path | None = None, pilot: dict[str, Any] | None = None) -> Settings:
    env = os.environ if env is None else env
    repo = repo or repo_root()
    profile = profile or env.get("LL_PROFILE", "fixture")
    if profile not in PROFILES:
        raise ConfigError(f"Unknown profile {profile!r}; expected one of {PROFILES}")
    policy = load_policy(repo)
    workspace = json.loads((repo / "config" / "workspace.example.json").read_text(encoding="utf-8"))
    local_binding_file = repo / "config" / "local-bindings" / "workspace.json"
    if local_binding_file.is_file():
        workspace.update(json.loads(local_binding_file.read_text(encoding="utf-8")))
    allowed = list(workspace["allowed_course_ids"])

    fixture_label = None
    if profile == "fixture":
        from .fixtures.builder import ensure_fixture_workspace

        fixture_root = Path(env.get("LL_FIXTURE_ROOT") or (repo / ".local" / "fixture-workspace"))
        planner_config = planner_config or ensure_fixture_workspace(fixture_root)
        state_dir = state_dir or Path(env.get("LL_LOCAL_STATE_DIR") or (repo / ".local" / "state" / "fixture"))
        fixture_label = "FIXTURE PROFILE — synthetic course data and a labeled test tutor; not live evidence"
        pilot = {}
    else:
        candidate = planner_config or env.get("LL_PLANNER_CONFIG") or workspace.get("planner_config") or workspace.get("planner_config_candidate")
        if not candidate:
            raise ConfigError("No planner config bound; set LL_PLANNER_CONFIG or config/local-bindings/workspace.json")
        planner_config = Path(candidate)
        default_state = Path(env.get("LOCALAPPDATA", str(Path.home()))) / "LectureLearning" / profile
        # Precedence: explicit argument, environment, the private binding file, then the per-user default.
        configured = workspace.get("local_state_dir")
        if configured and not Path(configured).is_absolute():
            configured = repo / configured  # a relative path stays inside the code workspace
        if profile == "pilot":
            # The pilot keeps its own history. It never shares a folder with the read-only profile, so synthetic pilot
            # turns can never be taken for the learner's own later work there.
            pilot_file = repo / "config" / "local-bindings" / "pilot.json"
            grant = dict(pilot) if pilot is not None else (json.loads(pilot_file.read_text(encoding="utf-8")) if pilot_file.is_file() else {})
            if not grant.get("courses") or not grant.get("label") or grant.get("max_threads") != 1 or not isinstance(grant.get("max_turns"), int) or grant["max_turns"] < 1:
                raise ConfigError("The pilot profile needs an explicit grant (config/local-bindings/pilot.json): label, courses, max_threads 1 and max_turns")
            if grant["max_turns"] > PILOT_MAX_TURNS:
                raise ConfigError(f"The pilot grant allows no more than {PILOT_MAX_TURNS} turns; {grant['max_turns']} was configured")
            if any(course not in allowed for course in grant["courses"]):
                raise ConfigError("The pilot grant names a course that is not one of the configured courses")
            pilot_state = grant.get("state_dir")
            if pilot_state and not Path(pilot_state).is_absolute():
                pilot_state = repo / pilot_state
            state_dir = state_dir or Path(env.get("LL_PILOT_STATE_DIR") or pilot_state or (repo / ".local" / "state" / "pilot"))
            if configured and Path(state_dir).resolve() == Path(configured).resolve():
                raise ConfigError("The pilot state directory must not be the read-only profile's state directory")
            pilot = {k: grant[k] for k in ("label", "courses", "max_threads", "max_turns")}
        else:
            pilot = {}
            state_dir = state_dir or Path(env.get("LL_LOCAL_STATE_DIR") or configured or default_state)

    planner = read_planner_config(planner_config)
    declared = planner.get("courses") or {}
    # Read-side overrides. The fixture profile takes them from the generated fixture workspace, never from the private binding.
    overrides_file = planner_config.parent / "app-read-overrides.json" if profile == "fixture" else None
    overrides = (json.loads(overrides_file.read_text(encoding="utf-8")) if overrides_file is not None and overrides_file.is_file()
                 else {} if profile == "fixture" else dict(workspace.get("read_overrides") or {}))
    native_file = repo / "config" / "local-bindings" / "native.json"
    native_binding: dict[str, Any] = {}
    if profile != "fixture" and native_file.is_file():
        native_binding = json.loads(native_file.read_text(encoding="utf-8"))
    native_threads = native_binding.get("threads", {}) if isinstance(native_binding.get("threads"), dict) else {}

    courses: dict[str, CourseBinding] = {}
    for course_id in allowed:
        entry = declared.get(course_id)
        if not isinstance(entry, dict) or not entry.get("root"):
            courses[course_id] = CourseBinding(course_id, TERM, Path("."), course_id.upper(), f"tutor-{course_id}", "missing_root",
                                               "Course is not present in the planner configuration")
            continue
        courses[course_id] = _with_read_configuration(_bind_course(course_id, Path(entry["root"]), native_threads), overrides)

    if profile == "fixture":
        # The fixture profile writes directly and answers with a labeled keyword double. It may only ever see folders
        # this workspace generated as synthetic fixtures: the generator's marker must sit above everything it binds.
        from .fixtures.builder import MARKER

        config_path = planner_config.resolve()
        marked = next((p for p in config_path.parents if (p / MARKER).is_file()), None)
        outside = [b.course_id for b in courses.values() if b.status != "missing_root" and (marked is None or not b.root.resolve().is_relative_to(marked))]
        if marked is None or outside:
            raise ConfigError("The fixture profile runs only on a generated synthetic fixture workspace; these folders are not one"
                              + (f" (courses outside it: {', '.join(outside)})" if marked is not None else "")
                              + ". Use --profile local for real course folders.")

    # Journal, staged candidates and derived files must never live inside a course or the planner folder.
    resolved_state = Path(state_dir).resolve()
    for owned in [planner_config.parent, *(b.root for b in courses.values() if b.status != "missing_root")]:
        if resolved_state == owned.resolve() or resolved_state.is_relative_to(owned.resolve()):
            raise ConfigError(f"The local state directory {state_dir} is inside a course or planner folder; choose a private local folder outside them")

    def flag(name: str, default: bool) -> bool:
        return str(env.get(name, str(default))).strip().lower() in {"1", "true", "yes"}

    if profile == "fixture":
        writes, native = True, False  # fixture roots are synthetic and owned by this workspace
    elif profile == "local":
        writes, native = False, False  # read-only against real roots; app files staged locally
    elif profile == "pilot":
        writes, native = False, True  # course writes can never be switched on here; dispatch only through the pilot worker and its budget
    else:
        writes = flag("LL_COURSE_WRITES_ENABLED", bool(workspace.get("course_writes_enabled", False)))
        native = flag("LL_NATIVE_ENABLED", bool(workspace.get("native_dispatch_enabled", False)))
    return Settings(profile=profile, repo=repo, state_dir=Path(state_dir), planner_root=planner_config.parent, planner_config=planner_config,
                    courses=courses, policy=policy, course_writes_enabled=writes, native_dispatch_enabled=native, native_binding=native_binding,
                    fixture_label=fixture_label, pilot=pilot or {})
