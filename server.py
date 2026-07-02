#!/usr/bin/env python3
"""本地开发服务器:托管静态文件 + /api/refresh 触发 update.py"""
from __future__ import annotations

import json
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # 禁用缓存,避免改完 HTML 后浏览器不更新
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _run_script(self, name):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            result = subprocess.run(
                [sys.executable, str(ROOT / name)],
                capture_output=True, text=True, timeout=120,
                cwd=str(ROOT),
            )
            ok = result.returncode == 0
            self.wfile.write(json.dumps({
                "ok": ok,
                "stdout": result.stdout[-2000:],
                "stderr": result.stderr[-2000:],
            }, ensure_ascii=False).encode())
        except subprocess.TimeoutExpired:
            self.wfile.write(json.dumps({"ok": False, "stderr": "脚本超时(120s)"}, ensure_ascii=False).encode())

    def _run_chat(self):
        """AI 问答:从 stdin 读 JSON, 返回 {ok, answer}"""
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length else b'{}'
            result = subprocess.run(
                [sys.executable, str(ROOT / "chat.py")],
                input=body.decode('utf-8'),
                capture_output=True, text=True, timeout=90,
                cwd=str(ROOT),
            )
            if result.returncode != 0:
                self.wfile.write(json.dumps({"ok": False, "error": result.stderr[-500:]}, ensure_ascii=False).encode())
            else:
                self.wfile.write(json.dumps({"ok": True, "answer": result.stdout}, ensure_ascii=False).encode())
        except subprocess.TimeoutExpired:
            self.wfile.write(json.dumps({"ok": False, "error": "请求超时(90s)"}, ensure_ascii=False).encode())
        except Exception as e:
            self.wfile.write(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode())

    def do_GET(self):
        if self.path == "/api/refresh":
            self._run_script("update.py")
        elif self.path == "/api/refresh-papers":
            self._run_script("fetch_papers.py")
        elif self.path == "/api/summarize":
            self._run_script("summarize.py")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/chat":
            self._run_chat()
        else:
            self.send_error(404)

    def log_message(self, fmt, *args):
        msg = fmt % args if args else fmt
        if "/api/refresh" in str(msg):
            print(f"[refresh] {msg}")
        # 其它请求静默


if __name__ == "__main__":
    print(f"  NEXA Daily server → http://{HOST}:{PORT}/")
    HTTPServer((HOST, PORT), Handler).serve_forever()