"""Contracts for Hermes-backed browser dictation."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from hermes_harness import recovery


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "hermes_harness" / "static"
DICTATION = STATIC / "harness-dictation.js"


def _source() -> str:
    return DICTATION.read_text(encoding="utf-8")


def test_dictation_route_is_explicit_post_only_hermes_stt_proxy():
    assert recovery.resolve_upstream("POST", "/api/harness/audio-transcribe") == "/api/audio/transcribe"
    assert recovery.resolve_upstream("GET", "/api/harness/audio-transcribe") is None


def test_dictation_asset_boots_after_operator_and_is_served():
    boot = recovery._H5_RECOVERY_BOOT
    assert "houx.src='/harness-operator-ux.js'" in boot
    assert "hdict.src='/harness-dictation.js'" in boot
    assert boot.index("houx.src='/harness-operator-ux.js'") < boot.index("hdict.src='/harness-dictation.js'")
    assert '"/harness-dictation.js": "harness-dictation.js"' in Path(recovery.__file__).read_text(encoding="utf-8")


def test_dictation_uses_mediarecorder_and_hermes_transcription_not_web_speech():
    source = _source()
    assert "navigator.mediaDevices.getUserMedia" in source
    assert "MediaRecorder" in source
    assert 'api("/api/harness/audio-transcribe"' in source
    assert "response?.transcript" in source
    assert "SpeechRecognition" not in source
    assert "webkitSpeechRecognition" not in source


def test_dictation_targets_message_and_task_description_without_auto_submit():
    source = _source()
    assert 'document.getElementById("messageInput")' in source
    assert 'textarea[name="description"]' in source
    assert '"ouxDictationBtn"' in source
    assert '"h63TaskDictationBtn"' in source
    assert "sendMessage(" not in source
    assert "queueMessage(" not in source
    assert "createTaskSubmit" not in source
    assert ".submit(" not in source


def test_dictation_keeps_request_below_existing_bff_json_limit():
    source = _source()
    assert "const HD_MAX_RECORDING_MS = 40000" in source
    assert "const HD_MAX_DATA_URL_BYTES = 240 * 1024" in source
    assert "audioBitsPerSecond: 32000" in source
    assert "dataUrl.length > HD_MAX_DATA_URL_BYTES" in source


def test_dictation_is_ephemeral_and_keeps_browser_secret_boundary():
    source = _source()
    assert "localStorage" not in source
    for forbidden in (
        "Authorization",
        "Bearer ",
        "API_SERVER_KEY",
        "HERMES_HARNESS_GATEWAY_API_KEY",
        "HERMES_WEBUI_GATEWAY_API_KEY",
        "durable-workers.db",
    ):
        assert forbidden not in source


def test_dictation_javascript_syntax():
    node = shutil.which("node")
    if not node:
        return
    completed = subprocess.run(
        [node, "--check", str(DICTATION)],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
