"""Contract tests for the Harness-owned standalone runtime boundary."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_harness_server_does_not_import_legacy_webui_runtime():
    source = _read("hermes_harness/server.py")

    forbidden = (
        "from api.auth import",
        "from api.helpers import",
        "from api.profiles import",
        "from api.routes import",
        "from server import",
        "HERMES_WEBUI_PASSWORD",
        "HERMES_WEBUI_STATE_DIR",
        "get_profile_cookie",
        "set_request_profile",
        "clear_request_profile",
    )
    for token in forbidden:
        assert token not in source

    assert "from hermes_harness import auth" in source
    assert "from hermes_harness.http import CLIENT_DISCONNECT_ERRORS, json_response" in source
    assert "ThreadingHTTPServer" in source


def test_remote_bind_requires_harness_specific_password_and_opt_in():
    source = _read("hermes_harness/server.py")

    assert 'HERMES_HARNESS_ALLOW_REMOTE' in source
    assert 'HERMES_HARNESS_PASSWORD' in source
    assert 'Non-loopback Harness bind requires HERMES_HARNESS_ALLOW_REMOTE=1' in source
    assert 'Non-loopback Harness bind requires HERMES_HARNESS_PASSWORD' in source


def test_standalone_auth_is_harness_owned_and_has_cookie_csrf_guards():
    source = _read("hermes_harness/auth.py")

    assert 'HERMES_HARNESS_STATE_DIR' in source
    assert 'HERMES_HARNESS_PASSWORD' in source
    assert 'hermes_harness_session' in source
    assert 'httponly' in source
    assert 'samesite' in source
    assert '"Strict"' in source
    assert 'X-Hermes-CSRF-Token' in source
    assert 'hmac.compare_digest' in source
    assert 'os.chmod(tmp, 0o600)' in source

    for token in ("api.auth", "api.config", "server.py", "HERMES_WEBUI_PASSWORD"):
        assert token not in source


def test_standalone_bff_keeps_secret_server_side_and_exact_allowlist():
    source = _read("hermes_harness/bff.py")

    assert 'Authorization' in source
    assert 'Bearer ' in source
    assert 'HERMES_HARNESS_GATEWAY_API_KEY' in source
    assert '_ROUTES:' in source
    assert 'resolve_upstream' in source
    assert 'ProxyHandler({})' in source
    assert 'HTTPRedirectHandler' in source
    assert '_MAX_REQUEST_BYTES' in source
    assert '_MAX_RESPONSE_BYTES' in source
    assert 'from api.helpers import' not in source
    assert 'from api.auth import' not in source


def test_h4_h5_h6_use_harness_owned_bff_and_http_helpers():
    for path in (
        "hermes_harness/operations.py",
        "hermes_harness/tasks.py",
        "hermes_harness/recovery.py",
    ):
        source = _read(path)
        assert "from hermes_harness import bff as foundation" in source
        assert "from hermes_harness.http import j" in source
        assert "from api.helpers import j" not in source
        assert "from api import harness_ui as foundation" not in source


def test_archive_browser_preference_remains_unchanged_by_runtime_extraction():
    prefs = _read("hermes_harness/static/harness-preferences.js")
    server = _read("hermes_harness/server.py")
    bff = _read("hermes_harness/bff.py")

    assert 'archivedSessions: PREFIX + "archivedSessions"' in prefs
    assert 'window.localStorage' in prefs
    assert 'setSessionArchived' in prefs
    assert 'isSessionArchived' in prefs

    # Runtime extraction must not silently turn the existing reversible
    # browser archive control into a destructive server operation.
    assert "/purge" not in server
    assert "/bulk-delete" not in server
    assert "/purge" not in bff
    assert "/bulk-delete" not in bff
