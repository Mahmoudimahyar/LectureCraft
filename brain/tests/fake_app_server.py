"""LABELED TEST DOUBLE of a stdio JSON-RPC app server (documented method names only).

Not the Codex App Server. It lets the adapter's protocol handling be tested: handshake, thread
resume by explicit id, turn start with explicit policies, terminal notifications, approval
requests, interruption and silence. Mode is argv[1]; a turn log is appended to argv[2].
"""
import json
import sys
import time

mode = sys.argv[1] if len(sys.argv) > 1 else "normal"
log_path = sys.argv[2] if len(sys.argv) > 2 else None
KNOWN_THREAD = "thread-disposable-0001"
turns = {}


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
        if params.get("threadId") != KNOWN_THREAD:
            send({"id": mid, "error": {"code": -32000, "message": "thread not found"}})
        else:
            send({"id": mid, "result": {"thread": {"id": KNOWN_THREAD}}})
    elif method == "turn/start":
        if params.get("sandboxPolicy", {}).get("type") == "dangerFullAccess":
            send({"id": mid, "error": {"code": -32001, "message": "test double refuses full access"}})
            continue
        turn_id = f"turn-{len(turns) + 1}"
        text = params["input"][0]["text"]
        turns[turn_id] = {"id": turn_id, "status": "inProgress", "items": []}
        send({"id": mid, "result": {"turn": {"id": turn_id, "status": "inProgress"}}})
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
        reply = text.split("nothing else: ", 1)[1] if "nothing else: " in text else json.dumps({"reply_markdown": "double reply", "sources_used": [], "uncertainty": None, "assessment": None, "diagnostic": None})
        item = {"type": "agentMessage", "id": "item-1", "text": reply}
        turns[turn_id].update(status="completed", items=[item])
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
    elif mid is not None:
        send({"id": mid, "error": {"code": -32601, "message": "method not found"}})
