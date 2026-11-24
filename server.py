"""Modern Option Trader QUIK — local server: serves the web UI and relays data between the browser and quik_bridge.lua.

Run:  python server.py   ->  open http://127.0.0.1:8765
Only Python standard library is used. Listens on 127.0.0.1 only.
"""
import json
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "out.json")
CMD = os.path.join(DATA, "cmd.txt")
PORT = int(os.environ.get("MOTQ_PORT") or os.environ.get("PORT") or "8765")

os.makedirs(DATA, exist_ok=True)

lock = threading.Lock()
state = {"raw": None, "mtime": 0.0, "ack": 0, "last_seq": 0, "has_cmds": False}


def read_snapshot():
    """Re-read out.json if it changed. QUIK writes strings in cp1251."""
    try:
        mtime = os.path.getmtime(OUT)
    except OSError:
        return
    if mtime == state["mtime"]:
        return
    for _ in range(3):
        try:
            with open(OUT, "rb") as f:
                raw = f.read().decode("cp1251", errors="replace")
            data = json.loads(raw)
            break
        except (OSError, ValueError):
            time.sleep(0.02)
    else:
        return
    with lock:
        state["mtime"] = mtime
        state["raw"] = raw
        state["ack"] = int(data.get("ack") or 0)
        # all commands processed -> clear the command file
        if state["has_cmds"] and state["ack"] >= state["last_seq"]:
            try:
                open(CMD, "w").close()
                state["has_cmds"] = False
            except OSError:
                pass


def poller():
    while True:
        read_snapshot()
        time.sleep(0.1)


def push_cmd(parts):
    with lock:
        seq = max(int(time.time() * 1000), state["last_seq"] + 1)
        state["last_seq"] = seq
        clean = [str(p).replace("|", "/").replace("\n", " ").replace("\r", " ") for p in parts]
        with open(CMD, "a", encoding="cp1251", errors="replace") as f:
            f.write("|".join([str(seq)] + clean) + "\n")
        state["has_cmds"] = True
    return seq


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            return
        super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/stream"):
            return self.stream()
        if self.path.startswith("/api/snapshot"):
            with lock:
                raw = state["raw"]
            body = (raw or "{}").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.end_headers()
        last = None
        idle = 0
        try:
            while True:
                with lock:
                    raw, mtime = state["raw"], state["mtime"]
                if raw and mtime != last:
                    last = mtime
                    meta = json.dumps({"age": time.time() - mtime})
                    self.wfile.write(f"event: meta\ndata: {meta}\n\n".encode())
                    self.wfile.write(b"data: " + raw.encode("utf-8") + b"\n\n")
                    self.wfile.flush()
                    idle = 0
                else:
                    idle += 1
                    if idle % 10 == 0:  # heartbeat every ~1s with data age
                        age = time.time() - mtime if mtime else -1
                        self.wfile.write(f"event: meta\ndata: {json.dumps({'age': age})}\n\n".encode())
                        self.wfile.flush()
                time.sleep(0.1)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def do_POST(self):
        if not self.path.startswith("/api/cmd"):
            self.send_error(404)
            return
        # basic CSRF guard: only same-origin requests
        origin = self.headers.get("Origin")
        if origin and not origin.startswith(f"http://127.0.0.1:{PORT}") and not origin.startswith(f"http://localhost:{PORT}"):
            self.send_error(403)
            return
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            cmd = str(body["cmd"]).upper()
            if cmd not in ("SUB", "ORDER", "KILL", "KILLALL", "REINDEX"):
                raise ValueError("bad cmd")
            seq = push_cmd([cmd] + list(body.get("args") or []))
        except (KeyError, ValueError, TypeError) as e:
            self.send_error(400, str(e))
            return
        out = json.dumps({"seq": seq}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    threading.Thread(target=poller, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    print(f"Modern Option Trader QUIK: http://127.0.0.1:{PORT}   (data: {DATA})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
