"""Contracts for the post-UAT operator ergonomics layer.

The layer deliberately changes presentation only: transcript-first layout,
collapsible execution/task panels, focus mode, rename discoverability and
best-effort browser dictation. Hermes remains the source of truth.
"""
from __future__ import annotations

import io
import json
import shutil
import subprocess
import urllib.parse
from pathlib import Path

import pytest

from hermes_harness import bff as foundation
from hermes_harness import recovery

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "hermes_harness" / "static"
OPERATOR_JS = STATIC / "harness-operator-ux.js"


def _operator_source() -> str:
    return OPERATOR_JS.read_text(encoding="utf-8")


class _JsonHandler:
    def __init__(self, payload: dict):
        raw = json.dumps(payload).encode("utf-8")
        self.headers = {"Content-Length": str(len(raw))}
        self.rfile = io.BytesIO(raw)
        self.wfile = io.BytesIO()
        self.status = None
        self.response_headers: list[tuple[str, str]] = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None


class _FakeResponse:
    status = 200
    headers = {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _limit=-1):
        return b'{"ok":true}'


class _CapturingOpener:
    def __init__(self):
        self.request = None
        self.timeout = None

    def open(self, request, timeout=None):
        self.request = request
        self.timeout = timeout
        return _FakeResponse()


def test_operator_asset_is_booted_after_models_and_served():
    source = Path(recovery.__file__).read_text(encoding="utf-8")

    assert "hm.src='/harness-models.js'" in source
    assert "houx.src='/harness-operator-ux.js'" in source
    assert source.index("hm.src='/harness-models.js'") < source.index("houx.src='/harness-operator-ux.js'")
    assert '"/harness-operator-ux.js": "harness-operator-ux.js"' in source


def test_session_rename_uses_canonical_hermes_contract_through_bff():
    assert recovery.resolve_upstream("POST", "/api/harness/session-rename") == "/api/session/rename"
    assert recovery.resolve_upstream("GET", "/api/harness/session-rename") is None

    source = _operator_source()
    assert 'api("/api/harness/session-rename"' in source
    assert "session_id: sid, title" in source
    assert "safeId(state.sessionId)" in source


def test_session_rename_cannot_smuggle_archive_or_lifecycle_fields():
    handler = _JsonHandler({"session_id": "session-uat", "title": "Renamed", "archived": True})
    parsed = urllib.parse.urlparse("/api/harness/session-rename")

    handled = recovery.handle_harness_request(handler, parsed, method="POST")

    assert handled is True
    assert handler.status == 400
    payload = json.loads(handler.wfile.getvalue().decode("utf-8"))
    assert "accepts only session_id and title" in payload["error"]

    source = Path(recovery.__file__).read_text(encoding="utf-8")
    assert 'set(payload) - {"session_id", "title"}' in source
    assert '{"session_id": session_id, "title": title.strip()}' in source


def test_session_rename_proxies_only_sanitized_title_payload(monkeypatch):
    opener = _CapturingOpener()
    monkeypatch.setattr(foundation, "_OPENER", opener)
    monkeypatch.setattr(foundation, "_gateway_base_url", lambda environ=None: "http://hermes.test")
    monkeypatch.setattr(foundation, "_gateway_api_key", lambda environ=None: "test-key")

    handler = _JsonHandler({"session_id": "session-uat", "title": "  Better name  "})
    parsed = urllib.parse.urlparse("/api/harness/session-rename")

    handled = recovery._proxy_session_rename(handler, parsed)

    assert handled is True
    assert handler.status == 200
    assert opener.request is not None
    assert opener.request.full_url == "http://hermes.test/api/session/rename"
    assert json.loads(opener.request.data.decode("utf-8")) == {
        "session_id": "session-uat",
        "title": "Better name",
    }
    assert opener.request.get_header("Authorization") == "Bearer test-key"


def test_worker_rename_is_discoverable_without_duplicate_worker_api():
    source = _operator_source()

    assert 'button.id = "ouxRenameWorkerBtn"' in source
    assert 'typeof openWorkerSettings === "function"' in source
    # Reuse the already-qualified worker settings/edit flow instead of adding
    # another worker mutation contract in this UX layer.
    assert "/workers/" not in source
    assert "/edit" not in source


def test_transcript_is_primary_and_execution_panel_is_collapsed_by_default():
    source = _operator_source()

    assert "ouxReadBool(OUX_KEYS.activationsCollapsed, true)" in source
    assert ".oux-activations-collapsed .activation-card{display:none!important}" in source
    assert ".oux-activations-collapsed .content-grid{grid-template-columns:minmax(0,1fr)!important}" in source
    assert ".worker-view{max-width:1680px!important;width:100%}" in source


def test_activation_summary_is_not_rendered_in_default_technical_body():
    source = _operator_source()

    start = source.index("function ouxActivationNode")
    end = source.index("// Override only presentation", start)
    activation = source[start:end]

    assert "technical.push(activation.summary)" not in activation
    assert "if (activation.summary)" in activation
    assert 'document.createElement("details")' in activation
    assert 'details.className = "oux-activation-details"' in activation
    assert 'details.append(el("div", "oux-activation-summary", activation.summary))' in activation


def test_focus_and_panel_preferences_are_browser_local_only():
    source = _operator_source()

    assert 'OUX_PREFIX = "hermesHarness.ui."' in source
    assert 'OUX_PREFIX + "activationsCollapsed"' in source
    assert 'OUX_PREFIX + "tasksCollapsed"' in source
    assert 'OUX_PREFIX + "focusMode"' in source
    assert "window.localStorage.setItem" in source
    assert "body.oux-focus-mode" in source
    # A persisted focus preference must never trap the user with both rails
    # hidden before a worker is selected: the exit control lives in the topbar.
    assert 'document.querySelector(".topbar .connection")' in source
    assert 'topbar.insertBefore(focus, refresh || null)' in source


def test_dictation_only_edits_composer_and_never_submits_automatically():
    source = _operator_source()

    assert "window.SpeechRecognition || window.webkitSpeechRecognition" in source
    assert "function ouxInsertDictation" in source
    assert 'textarea.dispatchEvent(new Event("input", { bubbles: true }))' in source
    assert "dictationUnsupported" in source
    assert "dictationDenied" in source

    start = source.index("function ouxInstallDictation")
    end = source.index("function ouxActivationNode", start)
    dictation = source[start:end]
    assert "api(" not in dictation
    assert "fetch(" not in dictation
    assert "sendMessage(" not in dictation
    assert "queueMessage(" not in dictation
    assert "sendMessageBtn" in dictation  # placement only: microphone before Send


def test_operator_javascript_syntax():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")

    completed = subprocess.run(
        [node, "--check", str(OPERATOR_JS)],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
