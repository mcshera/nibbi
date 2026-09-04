#!/usr/bin/env python
"""Nibbi ears — whisper-large-v3-turbo resident. POST /stt (audio bytes) -> {"heard": text}."""
import json, os, subprocess, sys, tempfile, time
from http.server import BaseHTTPRequestHandler, HTTPServer

FFMPEG = os.path.expanduser("~/.nibbi/bin/ffmpeg")
REPO = "mlx-community/whisper-large-v3-turbo"
REPO_FAST = "mlx-community/whisper-small-mlx"
VOCAB = "Nibbi, SHIPLESS, Matty, fixer, playtest, golden gate, worktree, vault, Telegram, Kokoro, derelict."

sys.stderr.write("loading whisper...\n"); sys.stderr.flush()
import mlx_whisper
with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
    warm = f.name
subprocess.run([FFMPEG, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ar", "16000", warm],
               capture_output=True)
mlx_whisper.transcribe(warm, path_or_hf_repo=REPO)       # loads + caches turbo
mlx_whisper.transcribe(warm, path_or_hf_repo=REPO_FAST)  # loads + caches small (live loop)
os.remove(warm)
sys.stderr.write("whisper ready\n"); sys.stderr.flush()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        import urllib.parse as up
        u = up.urlparse(self.path)
        if u.path != "/stt":
            self.send_response(404); self.end_headers(); return
        fast = "fast" in up.parse_qs(u.query)
        n = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(n) if n else b""
        if len(raw) < 200:
            self.send_response(400); self.end_headers(); return
        t0 = time.time()
        is_wav = raw[:4] == b"RIFF"
        src = tempfile.NamedTemporaryFile(suffix=(".wav" if is_wav else ".bin"), delete=False).name
        wav = src if is_wav else src + ".wav"
        open(src, "wb").write(raw)
        try:
            if not is_wav:
                subprocess.run([FFMPEG, "-y", "-i", src, "-ac", "1", "-ar", "16000", wav],
                               capture_output=True, timeout=30)
            r = mlx_whisper.transcribe(wav, path_or_hf_repo=(REPO_FAST if fast else REPO), initial_prompt=VOCAB)
            text = (r.get("text") or "").strip()
        except Exception as e:
            self.send_response(500); self.end_headers()
            self.wfile.write(str(e)[:200].encode()); return
        finally:
            for p in (src, wav):
                try: os.remove(p)
                except OSError: pass
        body = json.dumps({"heard": text}).encode()
        sys.stderr.write(f"stt[{'fast' if fast else 'turbo'}] {time.time()-t0:.2f}s: {text[:70]!r}\n"); sys.stderr.flush()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

HTTPServer(("127.0.0.1", 4522), H).serve_forever()
