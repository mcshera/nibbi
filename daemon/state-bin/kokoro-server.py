#!/usr/bin/env python
"""Nibbi voice server — Kokoro-82M resident in memory. GET /synth?text=...[&path=1] -> ogg bytes or cache path."""
import hashlib, os, subprocess, sys, time, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

CACHE = os.path.expanduser("~/.nibbi/tts-cache")
FFMPEG = os.path.expanduser("~/.nibbi/bin/ffmpeg")
os.makedirs(CACHE, exist_ok=True)

sys.stderr.write("loading Kokoro-82M...\n"); sys.stderr.flush()
from mlx_audio.tts.utils import load_model
from mlx_audio.tts.generate import generate_audio
MODEL = load_model("prince-canuma/Kokoro-82M")
# one warm synth so first request is fast
generate_audio(text="ready", model=MODEL, voice="af_heart", join_audio=True, verbose=False,
               output_path="/tmp", file_prefix="kokoro-warmup")
sys.stderr.write("kokoro ready\n"); sys.stderr.flush()

def synth(text: str, cache: bool = True) -> str:
    key = hashlib.sha1(text.encode()).hexdigest()[:16]
    ogg = os.path.join(CACHE, key + ".ogg") if cache else os.path.join("/tmp", "kokoro-warm-" + key + ".ogg")
    if cache and os.path.exists(ogg): return ogg
    t0 = time.time()
    generate_audio(text=text, model=MODEL, voice="af_heart", join_audio=True, verbose=False,
                   output_path="/tmp", file_prefix="kokoro-" + key)
    wav = "/tmp/kokoro-" + key + ".wav"
    subprocess.run([FFMPEG, "-y", "-i", wav, "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", ogg],
                   capture_output=True, timeout=30)
    try: os.remove(wav)
    except OSError: pass
    sys.stderr.write(f"synth {time.time()-t0:.2f}s: {text[:60]!r}\n"); sys.stderr.flush()
    try:  # keep the cache bounded (newest 400 clips)
        files = sorted((os.path.join(CACHE, f) for f in os.listdir(CACHE)), key=os.path.getmtime)
        for old_f in files[:-400]:
            os.remove(old_f)
    except OSError:
        pass
    return ogg

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/health":
            self.send_response(200); self.end_headers(); self.wfile.write(b"ok"); return
        if u.path == "/synth":
            text = (q.get("text") or [""])[0].strip()[:900]
            if not text:
                self.send_response(400); self.end_headers(); return
            try:
                ogg = synth(text, cache="nocache" not in q)
            except Exception as e:
                self.send_response(500); self.end_headers()
                self.wfile.write(str(e)[:200].encode()); return
            if q.get("path"):
                self.send_response(200)
                self.send_header("content-type", "text/plain"); self.end_headers()
                self.wfile.write(ogg.encode()); return
            data = open(ogg, "rb").read()
            self.send_response(200)
            self.send_header("content-type", "audio/ogg")
            self.send_header("content-length", str(len(data))); self.end_headers()
            self.wfile.write(data); return
        self.send_response(404); self.end_headers()

HTTPServer(("127.0.0.1", 4521), H).serve_forever()
