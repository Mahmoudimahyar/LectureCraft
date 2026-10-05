"""LABELED TEST DOUBLE of a stdio JSON-RPC app server (documented method names only).

Not the Codex App Server. It lets the adapter's protocol handling be tested: handshake, thread
resume by explicit id, turn start with explicit policies, terminal notifications, approval
requests, interruption and silence. Mode is argv[1]; a turn log is appended to argv[2].
"""
import json
import os
import re
import sys
import time

mode = sys.argv[1] if len(sys.argv) > 1 else "normal"
log_path = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "-" else None  # "-" keeps the launch arguments in place
KNOWN_THREAD = "thread-disposable-0001"
NEW_THREAD = "thread-new-disposable-0001"
turns = {}

# Stand-in for a user's own defaults, which a restricted launch must override: full access, a tool server, a notify program.
effective = {"sandbox_mode": "danger-full-access", "approval_policy": "on-request", "notify": ["notify.exe"], "project_doc_max_bytes": 32768, "model": "double-model",
             "model_reasoning_effort": "low", "mcp_servers": {"node_repl": {"enabled": True}}, "features": {}}
launch = sys.argv[3:]
for flag, value in zip(launch, launch[1:]):
    if flag == "--disable":
        effective["features"][value] = False
    elif flag == "-c":
        key, _, raw = value.partition("=")
        parsed = json.loads(raw) if raw[:1] in '"[{0123456789tf' else raw
        if key.startswith("mcp_servers.") and mode != "tools-stay":
            effective["mcp_servers"].setdefault(key.split(".")[1], {})["enabled"] = parsed
        elif key == "sandbox_mode" and mode == "ignores-sandbox":
            pass
        elif not key.startswith("mcp_servers."):
            effective[key] = parsed


# Optional memory across processes (LL_FAKE_STATE): a thread created by one process can be resumed by the next,
# with its turns and whatever it was asked to remember — or without the latter in mode "forgets".
STATE = os.environ.get("LL_FAKE_STATE")
memory = {"thread": None, "marker": None}
if STATE and os.path.exists(STATE):
    with open(STATE, encoding="utf-8") as handle:
        saved = json.load(handle)
    turns, memory = saved["turns"], saved["memory"]
    KNOWN_THREAD = memory["thread"] or KNOWN_THREAD


def save():
    if STATE:
        with open(STATE, "w", encoding="utf-8") as handle:
            json.dump({"turns": turns, "memory": memory}, handle)


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def log(entry):
    if log_path:
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


for raw in sys.stdin:
    msg = json.loads(raw)
    method, mid, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    log({"method": method, "params": params})
    if method == "initialize":
        send({"id": mid, "result": {"userAgent": "fake-app-server/0.0-test-double"}})
    elif method == "initialized":
        pass
    elif method == "thread/resume":
        if params.get("threadId") != KNOWN_THREAD or mode == "resume-fails":
            send({"id": mid, "error": {"code": -32000, "message": "thread not found"}})
        else:
            send({"id": mid, "result": {"thread": {"id": "thread-some-other" if mode == "resumes-other" else KNOWN_THREAD, "turns": list(turns.values())}, "cwd": params.get("cwd"),
                                        "sandbox": {"type": "dangerFullAccess"} if mode == "thread-full-access" else {"type": "readOnly", "networkAccess": False},
                                        "approvalPolicy": params.get("approvalPolicy"), "instructionSources": ["C:/somewhere/AGENTS.md"] if mode == "instructions" else [],
                                        "model": "double-model", "modelProvider": "double"}})
    elif method == "turn/start":
        if params.get("sandboxPolicy", {}).get("type") == "dangerFullAccess":
            send({"id": mid, "error": {"code": -32001, "message": "test double refuses full access"}})
            continue
        turn_id = f"turn-{len(turns) + 1}"
        text = params["input"][0]["text"]
        turns[turn_id] = {"id": turn_id, "status": "inProgress", "items": []}
        save()
        send({"id": mid, "result": {"turn": {"id": turn_id, "status": "inProgress"}}})
        remembered = re.search(r"LL-MARK [0-9a-f]+", text)
        if remembered and "next message" in text:
            memory["marker"] = remembered.group(0)
            save()
        if mode == "silent" or "interrupt test" in text:
            continue  # never completes on its own
        if mode == "approval":
            send({"method": "item/commandExecution/requestApproval", "id": 9001, "params": {"turnId": turn_id, "command": "echo hi"}})
            continue
        if mode == "fail":
            turns[turn_id]["status"] = "failed"
            send({"method": "turn/completed", "params": {"turn": {"id": turn_id, "status": "failed", "error": {"message": "model_overloaded"}}}})
            continue
        if mode == "quota":
            send({"method": "turn/completed", "params": {"turn": {"id": turn_id, "status": "failed", "error": {"message": "usage limit reached"}}}})
            continue
        if mode == "tool-activity":
            send({"method": "item/completed", "params": {"item": {"type": "commandExecution", "id": "item-0", "command": "dir"}}})
        asks_for_marker = "previous message" in text and "nothing else: " not in text
        reply = "LL-PROOF 0000000000000000" if mode == "wrong-answer" else ("I have no earlier message from you." if mode == "forgets" or not memory["marker"] else memory["marker"]) if asks_for_marker else text.split("nothing else: ", 1)[1] if "nothing else: " in text else json.dumps({"reply_markdown": "double reply", "sources_used": [], "uncertainty": None, "assessment": None, "diagnostic": None})
        item = {"type": "agentMessage", "id": "item-1", "text": reply}
        turns[turn_id].update(status="completed", items=[item])
        save()
        send({"method": "item/completed", "params": {"item": item}})
        send({"method": "turn/completed", "params": {"turn": {"id": turn_id, "status": "completed"}}})
    elif method == "turn/interrupt":
        turn_id = params.get("turnId")
        if turn_id in turns:
            turns[turn_id]["status"] = "interrupted"
        send({"id": mid, "result": {}})
        send({"method": "turn/completed", "params": {"turn": {"id": turn_id, "status": "interrupted"}}})
    elif method == "thread/read":
        send({"id": mid, "result": {"thread": {"id": KNOWN_THREAD, "turns": list(turns.values())}}})
    elif method == "account/read":
        send({"id": mid, "result": {"account": {"type": "apiKey" if mode == "apikey" else "chatgpt", "planType": "pro", "email": "double@example.invalid"}, "requiresOpenaiAuth": True}})
    elif method == "config/read":
        send({"id": mid, "result": {"config": effective}})
    elif method == "mcpServerStatus/list":
        send({"id": mid, "result": {"data": [{"name": name, "tools": {} if entry.get("enabled") is False else {"run": {}}} for name, entry in effective["mcp_servers"].items()], "nextCursor": None}})
    elif method == "hooks/list":
        send({"id": mid, "result": {"data": [{"cwd": (params.get("cwds") or [None])[0], "hooks": [{"name": "h"}] if mode == "hooks" else [], "warnings": [], "errors": []}]}})
    elif method == "thread/start":
        KNOWN_THREAD = NEW_THREAD
        memory["thread"] = NEW_THREAD
        save()
        send({"id": mid, "result": {"thread": {"id": NEW_THREAD, "ephemeral": bool(params.get("ephemeral")), "cliVersion": "0.0-test-double"}, "cwd": params.get("cwd"),
                                    "sandbox": {"type": "dangerFullAccess"} if mode == "thread-full-access" else {"type": "readOnly", "networkAccess": False},
                                    "approvalPolicy": params.get("approvalPolicy"), "instructionSources": ["C:/somewhere/AGENTS.md"] if mode == "instructions" else [],
                                    "model": "double-model", "modelProvider": "double", "approvalsReviewer": "user"}})
    elif mid is not None:
        send({"id": mid, "error": {"code": -32601, "message": "method not found"}})
