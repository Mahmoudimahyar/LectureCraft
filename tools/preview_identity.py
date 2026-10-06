#!/usr/bin/env python3
"""Which build is a running preview serving? Prints one JSON object.

    python tools/preview_identity.py http://127.0.0.1:8765 [--dist web/dist]

Read-only. It sends GET requests only, to a LOOPBACK origin only (anything else is refused before any request):
the page ("/"), the health view ("/api/health") and the script/stylesheet files of the built app that page names.
It compares what came back with web/dist on disk and with the HEAD of this checkout. It writes nothing, follows no
redirect, uses no proxy and starts or stops nothing.

Reported:
* what the server states about itself - app version, commit, dirty state, profile, port, process id and start time,
  and per course its preparation generation, stored source-map revisions and derived generations (all null when its
  health view carries no build identity: an older process);
* what the page that was actually returned states about its own origin (``web_build``: the commit the web bundle was
  built from, whether the working tree was modified then, and when) and ``bundle_state``, which says whether that is
  the commit the server runs. A commit made without rebuilding the web app shows here as ``built_from_another_commit``;
  a page built before the stamp existed is ``not_established``, never a match;
* the files named by that page, their cache policy, and whether they equal the files of web/dist on disk, by name and
  by bytes. Equal files only mean the server serves what is on disk now - not which commit that is.

Exit code: 0 the server answered, 1 it could not be read, 2 the URL was refused. Output is always one JSON object.
Standard library only, so it runs under any Python and against any running instance.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit
import argparse
import hashlib
import http.client
import ipaddress
import json
import re
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TOOL = "preview_identity/2"
Fetch = Callable[[str], tuple[int, dict[str, str], bytes]]
MAX_BYTES = 64 * 1024 * 1024
BUILD_STAMP = "ll-build"  # <meta name="ll-build" content="commit=<id>; dirty=<true|false>; built_at=<UTC time>">, written by web/vite.config.ts
NO_BUILD = "The health view of this server carries no build identity (the process predates it): its commit, dirty state, process id, start time and preparation version cannot be established from its responses."
NO_STAMP = ("The page this server returned carries no build stamp (it was built before the stamp existed): which commit the web bundle was built from, and whether the working tree "
            "was modified then, cannot be established from it. Equal files on disk only mean the server serves what is on disk now.")
_COMMIT = re.compile(r"[0-9a-f]{40}(?:[0-9a-f]{24})?")
_BUILT_AT = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")
_PLAIN = re.compile(r"[A-Za-z0-9._@+~-]+(?:/[A-Za-z0-9._@+~-]+)*")
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{n}" for n in range(1, 10)), *(f"lpt{n}" for n in range(1, 10))}
_STATED = ("app_version", "commit", "commit_short", "branch", "dirty", "port", "pid", "process_started_at", "process_started_basis", "preparation_tool_version", "source_map_version")


def loopback_base(url: str) -> str:
    """The origin to query, or ValueError. Only http(s)://<loopback>[:port] with nothing after it is accepted."""
    parts = urlsplit(url or "")
    try:
        port = parts.port
    except ValueError as exc:
        raise ValueError(f"Not a loopback origin (bad port): {url!r}") from exc
    host = parts.hostname or ""
    try:
        loopback = host == "localhost" or ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if parts.scheme not in {"http", "https"} or not loopback or parts.username is not None or parts.password is not None or parts.path not in {"", "/"} or parts.query or parts.fragment:
        raise ValueError(f"Refused: only a loopback origin such as http://127.0.0.1:8765 is read, not {url!r}")
    name = f"[{host}]" if ":" in host else host
    return f"{parts.scheme}://{name}" + (f":{port}" if port is not None else "")


def plain_name(reference: str) -> str | None:
    """The file of the built app that a script or stylesheet reference names, or None when the reference is anything
    else: another origin, an absolute or parent path, a backslash, or characters that cannot be sent as they are. Only
    a plain name is ever requested from the server or looked up on disk."""
    name = reference.split("?", 1)[0].split("#", 1)[0]
    if name.startswith("/") and not name.startswith("//"):
        name = name[1:]
    if len(name) > 512 or not _PLAIN.fullmatch(name):
        return None
    if any(part in {".", ".."} or part.endswith(".") or part.split(".")[0].lower() in _RESERVED for part in name.split("/")):
        return None
    return name


class _Page(HTMLParser):
    """Script and stylesheet references of a page in document order, each as (reference as written, name as the Brain
    reports it in /api/health), and the build stamp."""

    def __init__(self) -> None:
        super().__init__()
        self.script: list[tuple[str, str]] = []
        self.style: list[tuple[str, str]] = []
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
    def _add(entries: list[tuple[str, str]], url: str) -> None:
        name = url.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if name and all(name != known for _, known in entries):
            entries.append((url, name))


def read_page(html: bytes) -> dict[str, Any]:
    """What a page names and states: ``script``/``style`` (plain files of the built app, in document order),
    ``stated_script``/``stated_style`` (every reference, named as the Brain names it), ``other_references`` (how many
    references are not plain files of the built app) and ``web_build`` (its build stamp)."""
    page = _Page()
    page.feed(html.decode("utf-8", "replace"))
    page.close()
    plain = {kind: [name for name in (plain_name(reference) for reference, _ in entries) if name is not None] for kind, entries in (("script", page.script), ("style", page.style))}
    return {"script": list(dict.fromkeys(plain["script"])), "style": list(dict.fromkeys(plain["style"])),
            "stated_script": [name for _, name in page.script], "stated_style": [name for _, name in page.style],
            "other_references": sum(1 for entries in (page.script, page.style) for reference, _ in entries if plain_name(reference) is None), "web_build": web_build(page.stamp)}


def web_build(stamp: str | None) -> dict[str, Any]:
    """What a built page states about its own origin. ``stamped`` False: it carries no stamp. A field that is absent or
    malformed stays None; nothing is filled in."""
    fields = {key.strip(): value.strip() for key, _, value in (part.partition("=") for part in (stamp or "").split(";"))}
    commit = fields.get("commit", "") if _COMMIT.fullmatch(fields.get("commit", "")) else None
    return {"stamped": stamp is not None, "commit": commit, "commit_short": commit[:7] if commit else None, "dirty": {"true": True, "false": False}.get(fields.get("dirty", "")),
            "built_at": fields.get("built_at") if _BUILT_AT.fullmatch(fields.get("built_at", "")) else None}


def checkout_head(repo: Path) -> dict[str, str | None]:
    """HEAD of a checkout, read from git's own files (no git executable). Unknown stays None."""
    out: dict[str, str | None] = {"commit": None, "commit_short": None}
    try:
        git = repo / ".git"
        if git.is_file():  # a linked worktree: ".git" is a pointer file
            git = (repo / git.read_text(encoding="utf-8").strip().removeprefix("gitdir:").strip()).resolve()
        value: str | None = (git / "HEAD").read_text(encoding="utf-8").strip()
        if value.startswith("ref:"):
            ref = value[4:].strip()
            if not ref.startswith("refs/") or "\\" in ref or ":" in ref or any(part in {"", ".", ".."} for part in ref.split("/")):
                return out  # a reference that would lead out of git's own folder is not followed
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


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:  # a redirect could lead off this machine: report it, do not follow it
        return None


def http_fetch(base: str, *, timeout: float = 15.0) -> Fetch:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())

    def fetch(path: str) -> tuple[int, dict[str, str], bytes]:
        request = urllib.request.Request(base + path, method="GET", headers={"Accept": "*/*"})
        try:
            with opener.open(request, timeout=timeout) as response:
                return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read(MAX_BYTES)
        except urllib.error.HTTPError as error:
            return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read(MAX_BYTES)

    return fetch


class _Unreadable(Exception):
    """A request that produced no HTTP answer; carries only the kind of failure (never a path or an address)."""


def _get(fetch: Fetch, path: str) -> tuple[int, dict[str, str], bytes]:
    try:
        return fetch(path)
    except (OSError, http.client.HTTPException, ValueError) as error:  # refused, reset, timed out; not HTTP at all; a truncated body; a name that cannot be sent
        raise _Unreadable(type(error).__name__) from None


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _label(path: Path, repo: Path) -> str:
    try:
        return path.resolve().relative_to(repo.resolve()).as_posix()
    except (ValueError, OSError):
        return "outside-repository/" + path.name  # where it lies is not printed


def _dist_on_disk(dist: Path, repo: Path) -> tuple[dict[str, Any], dict[str, Any] | None]:
    index = dist / "index.html"
    try:
        data, modified = index.read_bytes(), index.stat().st_mtime
    except OSError:
        return {"index": _label(index, repo), "present": False, "index_sha256": None, "index_modified_at": None, "script": [], "style": [], "web_build": web_build(None)}, None
    page = read_page(data)
    return {"index": _label(index, repo), "present": True, "index_sha256": _sha256(data), "index_modified_at": datetime.fromtimestamp(modified, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "script": page["script"], "style": page["style"], "web_build": page["web_build"]}, page


def _same_bytes(dist: Path, name: str, body: bytes) -> bool | None:
    """Does the file of that plain name inside the compared build hold these bytes? None: there is no such file there."""
    try:
        on_disk = (dist / name).resolve()
        on_disk.relative_to(dist.resolve())  # a link inside the build that leads out of it is not a file of the build
        return _sha256(on_disk.read_bytes()) == _sha256(body) if on_disk.is_file() else None
    except (OSError, ValueError):
        return None


def _blank(base: str) -> dict[str, Any]:
    return {"tool": TOOL, "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "base_url": base, "reachable": False,
            **{key: None for key in _STATED}, "profile": None, "courses": None, "health_has_build": None,
            "web_build": web_build(None), "checkout": {"commit": None, "commit_short": None}, "bundle_state": "not_established",
            "bundle_commit_equals_server_commit": None, "bundle_commit_equals_checkout_head": None, "server_commit_equals_checkout_head": None,
            "served": {"index_status": None, "index_sha256": None, "index_cache_control": None, "script": [], "style": [], "other_references": 0, "assets": []},
            "dist_on_disk": None, "assets_equal_dist_on_disk": None, "index_equal_dist_on_disk": None, "asset_bytes_equal_dist_on_disk": None,
            "health_assets_equal_served": None, "notes": []}


def _bundle_state(report: dict[str, Any], notes: list[str]) -> str:
    stamp, server = report["web_build"], report["commit"]
    if not stamp["stamped"]:
        notes.append(NO_STAMP)
        return "not_established"
    if stamp["commit"] is None:
        notes.append("The page's build stamp names no commit (the build could not read one): which commit the web bundle was built from is not established.")
        return "not_established"
    if stamp["dirty"] is True:
        notes.append("The web bundle was built from a modified working tree: its commit id alone does not describe what it contains.")
    if server is None:
        return "not_established"  # the page says what it was built from; the server does not say what it runs
    if stamp["commit"] != server:
        notes.append(f"STALE: the served web bundle was built from {stamp['commit'][:7]} but the server runs {server[:7]}. A commit was made (or the server restarted on newer code) without "
                     "rebuilding the web app, or the server was not restarted after a rebuild of older code. Rebuild the web app and compare again.")
        return "built_from_another_commit"
    return {True: "built_from_modified_tree", False: "built_from_server_commit"}.get(stamp["dirty"], "built_from_server_commit_tree_state_unknown")


def identify(base_url: str, *, fetch: Fetch | None = None, dist: Path | None = None, repo: Path = ROOT) -> dict[str, Any]:
    base = loopback_base(base_url)
    fetch = fetch or http_fetch(base)
    dist = dist if dist is not None else repo / "web" / "dist"
    report = _blank(base)
    notes: list[str] = report["notes"]
    report["checkout"] = checkout_head(repo)
    disk, disk_page = _dist_on_disk(dist, repo)
    report["dist_on_disk"] = disk
    if disk_page is None:
        notes.append("No built app on disk at the compared location: nothing to compare the served page with.")
    try:
        status, headers, body = _get(fetch, "/")
        health_status, _, health_body = _get(fetch, "/api/health")
    except _Unreadable as error:
        notes.append(f"The server could not be read: {error}.")
        return report
    report["reachable"] = True
    served = report["served"]
    served.update(index_status=status, index_cache_control=headers.get("cache-control"))
    page = read_page(body) if status == 200 else None
    if page is not None:
        served.update(index_sha256=_sha256(body), script=page["script"], style=page["style"], other_references=page["other_references"])
        report["web_build"] = page["web_build"]
        if page["other_references"]:
            notes.append(f"{page['other_references']} script or stylesheet reference(s) of the served page are not plain files of the built app (another origin, an absolute or parent path, "
                         "or characters that cannot be sent as written). They were not requested, not looked up on disk and are not repeated here.")
    else:
        notes.append(f"GET / answered {status}: this server serves no app page (a Brain without a built app, or not a Brain).")
    try:
        health = json.loads(health_body) if health_status == 200 else None
    except ValueError:
        health = None
    if not isinstance(health, dict):
        notes.append(f"GET /api/health answered {health_status} without a JSON object: this may not be a Lecture Learning Brain.")
        health = {}
    report["profile"] = health.get("profile") if isinstance(health.get("profile"), str) else None
    build = health.get("build") if isinstance(health.get("build"), dict) else None
    report["health_has_build"] = build is not None
    if build is None:
        notes.append(NO_BUILD)
    else:
        for key in _STATED:
            report[key] = build.get(key) if isinstance(build.get(key), (str, int, bool)) else None
        report["commit"] = report["commit"] if isinstance(report["commit"], str) and _COMMIT.fullmatch(report["commit"]) else None
        report["courses"] = build.get("courses") if isinstance(build.get("courses"), dict) else None
        stated = build.get("assets") if isinstance(build.get("assets"), dict) else None
        legacy = build.get("static") if isinstance(build.get("static"), dict) else {}  # the first version of the identity named them static.js / static.css
        stated_script, stated_style = (stated.get("script"), stated.get("style")) if stated is not None else (legacy.get("js"), legacy.get("css"))
        if page is not None:
            report["health_assets_equal_served"] = stated_script == page["stated_script"] and stated_style == page["stated_style"]
    report["bundle_state"] = _bundle_state(report, notes) if page is not None else "not_established"
    stamp_commit, head, server = report["web_build"]["commit"], report["checkout"]["commit"], report["commit"]
    report["bundle_commit_equals_server_commit"] = stamp_commit == server if stamp_commit and server else None
    report["bundle_commit_equals_checkout_head"] = stamp_commit == head if stamp_commit and head else None
    report["server_commit_equals_checkout_head"] = server == head if server and head else None
    if server and head and server != head:
        notes.append(f"The server runs {server[:7]}; this checkout is now at {head[:7]}: the process was started before the newer commit, or from another checkout.")
    if report["dirty"] is True:
        notes.append("The server's code was started from a modified working tree: its commit id alone does not describe what it runs.")
    names = [*served["script"], *served["style"]]
    all_same: bool | None = bool(names) if page is not None and disk_page is not None else None
    for name in names:
        try:
            asset_status, asset_headers, asset_body = _get(fetch, "/" + name)
        except _Unreadable as error:
            served["assets"].append({"name": name, "status": None, "bytes": None, "sha256": None, "cache_control": None, "same_bytes_as_dist": None})
            notes.append(f"{name} could not be read: {error}.")
            all_same = False if all_same is not None else None
            continue
        same = _same_bytes(dist, name, asset_body) if asset_status == 200 and disk_page is not None else None
        served["assets"].append({"name": name, "status": asset_status, "bytes": len(asset_body) if asset_status == 200 else None, "sha256": _sha256(asset_body) if asset_status == 200 else None,
                                 "cache_control": asset_headers.get("cache-control"), "same_bytes_as_dist": same})
        if all_same is not None and same is not True:
            all_same = False
    if page is not None and disk_page is not None:
        report["assets_equal_dist_on_disk"] = page["stated_script"] == disk_page["stated_script"] and page["stated_style"] == disk_page["stated_style"]
        report["index_equal_dist_on_disk"] = served["index_sha256"] == disk["index_sha256"]
        report["asset_bytes_equal_dist_on_disk"] = all_same
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base_url", help="Loopback origin of the running preview, e.g. http://127.0.0.1:8765")
    parser.add_argument("--dist", type=Path, help="Built app to compare with (default: web/dist of this checkout)")
    args = parser.parse_args(argv)
    try:
        base = loopback_base(args.base_url)
    except ValueError as error:
        print(str(error) + " (loopback origins only)", file=sys.stderr)
        return 2
    try:
        report = identify(args.base_url, dist=args.dist)
    except Exception as error:  # noqa: BLE001 - always one JSON object and an exit code; a traceback would print local paths
        report = _blank(base)
        report["notes"].append(f"The check itself failed and established nothing: {type(error).__name__}.")
    sys.stdout.write(json.dumps(report, indent=2, ensure_ascii=True) + "\n")
    return 0 if report["reachable"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
