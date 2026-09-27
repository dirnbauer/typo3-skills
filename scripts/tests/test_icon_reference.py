"""Offline behavior checks for provider failover; no API calls or real credentials."""
import base64
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "skills/typo3-icon14/scripts/generate-icon-reference.sh"


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


PIXELS = b"".join(b"\0" + bytes((x * 7 + y * 11) % 256 for x in range(96)) for y in range(32))
PNG = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(PIXELS)) + chunk(b"IEND", b""))
ENCODED = base64.b64encode(PNG).decode()
SUCCESS_OPENAI = {"data": [{"b64_json": ENCODED}]}
SUCCESS_GEMINI = {"candidates": [{"content": {"parts": [
    {"text": "Reference"}, {"inlineData": {"mimeType": "image/png", "data": ENCODED}}
]}}]}
CURL = """#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
engine = "openai" if "api.openai.com" in args[-1] else "gemini"
body = json.loads(pathlib.Path(args[args.index("--data-binary")+1][1:]).read_text())
with open(os.environ["ICON_TEST_LOG"], "a") as out:
    out.write(json.dumps({"engine":engine,"body":body,"url":args[-1]})+"\\n")
reply = json.loads(pathlib.Path(os.environ["ICON_TEST_REPLIES"]).read_text())[engine]
if reply.get("exit"):
    sys.exit(reply["exit"])
pathlib.Path(args[args.index("-o")+1]).write_text(json.dumps(reply.get("body", {})))
print(reply.get("status",200), end="")
"""


class IconReferenceTests(unittest.TestCase):
    def run_helper(self, replies=None, args=(), keys=True, existing=False, extra_env=None):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            mock = directory / "curl"
            mock.write_text(CURL)
            mock.chmod(0o755)
            log = directory / "calls.jsonl"
            config = directory / "replies.json"
            config.write_text(json.dumps(replies or {}))
            out = directory / "reference.png"
            if existing:
                out.write_bytes(b"existing reference")
            env = {key: value for key, value in os.environ.items() if key not in {
                "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
                "OPENAI_IMAGE_MODEL", "GEMINI_IMAGE_MODEL"}}
            env.update(PATH=folder + os.pathsep + env["PATH"],
                       ICON_TEST_LOG=str(log), ICON_TEST_REPLIES=str(config))
            if keys:
                env.update(OPENAI_API_KEY="test-openai", GEMINI_API_KEY="test-google")
            env.update(extra_env or {})
            result = subprocess.run(["bash", str(SCRIPT), "file maintenance", str(out), *args],
                                    env=env, text=True, capture_output=True, timeout=15)
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            data = out.read_bytes() if out.exists() else None
            self.assertEqual(list(directory.glob(".icon-reference.*")), [])
            self.assertNotIn("test-openai", result.stderr)
            self.assertNotIn("test-google", result.stderr)
            return result, calls, data

    def test_openai_success_uses_25_without_second_request(self):
        result, calls, data = self.run_helper({"openai": {"body": SUCCESS_OPENAI}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c["engine"] for c in calls], ["openai"])
        self.assertEqual(calls[0]["body"]["model"], "gpt-image-2.5-flare")
        self.assertEqual(data, PNG)

    def test_quota_falls_back_to_nano_banana(self):
        result, calls, data = self.run_helper({
            "openai": {"status": 429}, "gemini": {"body": SUCCESS_GEMINI}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c["engine"] for c in calls], ["openai", "gemini"])
        self.assertIn("gemini-3.1-flash-image:generateContent", calls[1]["url"])
        self.assertEqual(data, PNG)

    def test_gemini_transport_failure_falls_back_to_openai(self):
        result, calls, data = self.run_helper({
            "gemini": {"exit": 28}, "openai": {"body": SUCCESS_OPENAI}},
            args=("--provider", "gemini"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c["engine"] for c in calls], ["gemini", "openai"])
        self.assertEqual(data, PNG)

    def test_invalid_images_preserve_existing_file(self):
        for body in ({"data": [{"b64_json": "not base64!"}]},
                     {"data": [{"b64_json": base64.b64encode(b"x" * 200).decode()}]},
                     {"data": []}):
            with self.subTest(body=body):
                result, calls, data = self.run_helper({
                    "openai": {"body": body}, "gemini": {"body": {"candidates": []}}},
                    existing=True)
                self.assertEqual(result.returncode, 3, result.stderr)
                self.assertEqual(len(calls), 2)
                self.assertEqual(data, b"existing reference")

    def test_missing_credentials_falls_back_for_all_types(self):
        for kind in ("module", "small", "content"):
            with self.subTest(kind=kind):
                result, calls, data = self.run_helper(args=("--type", kind), keys=False)
                self.assertEqual(result.returncode, 3, result.stderr)
                self.assertEqual(calls, [])
                self.assertIsNone(data)

    def test_provider_restriction(self):
        result, calls, data = self.run_helper({"openai": {"status": 503}},
                                             args=("--provider", "openai", "--no-fallback"))
        self.assertEqual(result.returncode, 3)
        self.assertEqual([c["engine"] for c in calls], ["openai"])
        self.assertIsNone(data)

    def test_safety_refusal_is_not_retried(self):
        for provider, body in (
            ("openai", {"error": {"code": "content_policy_violation"}}),
            ("gemini", {"promptFeedback": {"blockReason": "SAFETY"}})):
            with self.subTest(provider=provider):
                result, calls, data = self.run_helper({provider: {"body": body}},
                                                     args=("--provider", provider))
                self.assertEqual(result.returncode, 4, result.stderr)
                self.assertEqual(len(calls), 1)
                self.assertIsNone(data)

    def test_transparent_does_not_downgrade_and_small_grid_is_used(self):
        result, calls, data = self.run_helper({"openai": {"body": SUCCESS_OPENAI}},
            args=("--transparent", "--type", "small", "--family", "existing outlined record glyphs"),
            extra_env={"OPENAI_IMAGE_MODEL": "gpt-image-2.5-sunburst"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[0]["body"]["model"], "gpt-image-2.5-sunburst")
        self.assertIn("16x16 canvas", calls[0]["body"]["prompt"])
        self.assertIn("existing outlined record glyphs", calls[0]["body"]["prompt"])
        self.assertNotIn("background", calls[0]["body"])

    def test_google_key_alias_without_openai(self):
        result, calls, data = self.run_helper({"gemini": {"body": SUCCESS_GEMINI}}, keys=False,
                                             extra_env={"GOOGLE_API_KEY": "test-google"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c["engine"] for c in calls], ["gemini"])
        self.assertEqual(data, PNG)

    def test_invalid_arguments_make_no_request(self):
        result, calls, data = self.run_helper(args=("--provider",))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(calls, [])
        self.assertIsNone(data)


if __name__ == "__main__":
    unittest.main()
