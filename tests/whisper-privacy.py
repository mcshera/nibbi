"""Run with the installed voice venv; never loads models or opens sockets."""
import contextlib, io, json, runpy, sys, types, unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "daemon/state-bin/whisper-server.py"

class PrivacyTest(unittest.TestCase):
    def test_success_returns_speech_without_logging_and_removes_audio(self):
        phrase = "PRIVATE RAW UTTERANCE DO NOT LOG"
        fake = types.ModuleType("mlx_whisper")
        fake.transcribe = lambda *a, **k: {"text": phrase}
        err = io.StringIO()
        with patch.dict(sys.modules, {"mlx_whisper": fake}), patch("http.server.HTTPServer"), patch("subprocess.run"), contextlib.redirect_stderr(err):
            ns = runpy.run_path(str(SOURCE))
            handler = object.__new__(ns["H"])
            handler.path = "/stt?fast=1"
            raw = b"RIFF" + b"x" * 256
            handler.headers = {"content-length": str(len(raw))}
            handler.rfile = io.BytesIO(raw)
            handler.wfile = io.BytesIO()
            handler.send_response = lambda code: self.assertEqual(code, 200)
            handler.send_header = lambda *a: None
            handler.end_headers = lambda: None
            removed = []
            original = ns["os"].remove
            def remove(path):
                removed.append(path)
                original(path)
            with patch("os.remove", side_effect=remove):
                handler.do_POST()
            self.assertEqual(json.loads(handler.wfile.getvalue()), {"heard": phrase})
            self.assertNotIn(phrase, err.getvalue())
            self.assertIn("stt[fast]", err.getvalue())
            self.assertTrue(removed)
            self.assertTrue(all(not Path(p).exists() for p in removed))

if __name__ == "__main__": unittest.main()
