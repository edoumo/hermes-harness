"""Static-shell regression gates for Hermes Harness UI."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_dialog_cancel_buttons_cannot_submit_forms():
    html = (ROOT / "hermes_harness" / "static" / "harness.html").read_text(encoding="utf-8")
    assert html.count('type="button" data-dialog-close') == 8
    assert 'id="sessionForm"' in html
    assert 'id="createWorkerSubmit"' in html
    assert 'id="saveWorkerSettingsBtn"' in html
    assert 'id="createTaskSubmit"' in html
    assert "event.preventDefault()" in html
    assert "dialog.close()" in html


def test_harness_shell_fetches_csrf_before_invoking_client_loader():
    html = (ROOT / "hermes_harness" / "static" / "harness.html").read_text(encoding="utf-8")
    # Locale/preferences assets are UI-only and may load before auth data. The
    # operational client still starts only after the CSRF request settles.
    assert 'src="/harness-locales.js"' in html
    assert 'src="/harness-preferences.js"' in html
    assert html.index('src="/harness-locales.js"') < html.index('src="/harness-preferences.js"')
    assert "fetch('/api/harness/csrf'" in html
    assert ".finally(loadClient)" in html
    assert "s.src='/harness.js'" in html
    assert "csrfToken" in html


def test_harness_browser_assets_do_not_embed_backend_secret_names():
    assets = "\n".join(
        (ROOT / "hermes_harness" / "static" / name).read_text(encoding="utf-8")
        for name in (
            "harness.html",
            "harness.js",
            "harness-locales.js",
            "harness-preferences.js",
            "harness-operations.js",
            "harness-tasks.js",
            "harness-task-recovery.js",
            "harness-polish2.js",
            "harness-polish3.js",
            "harness-models.js",
            "harness.css",
        )
    )
    assert "HERMES_HARNESS_GATEWAY_API_KEY" not in assets
    assert "HERMES_WEBUI_GATEWAY_API_KEY" not in assets
    assert "API_SERVER_KEY" not in assets
    assert "Authorization: Bearer" not in assets


def test_harness_remains_a_separate_standalone_entrypoint():
    harness = (ROOT / "hermes_harness" / "server.py").read_text(encoding="utf-8")
    runtime_auth = (ROOT / "hermes_harness" / "auth.py").read_text(encoding="utf-8")
    runtime_bff = (ROOT / "hermes_harness" / "bff.py").read_text(encoding="utf-8")

    assert not (ROOT / "server.py").exists()
    assert "ThreadingHTTPServer" in harness
    assert "resolve_bind" in harness
    assert "HERMES_HARNESS_PORT" in harness
    assert "HERMES_HARNESS_STATE_DIR" in runtime_auth
    assert "HERMES_HARNESS_GATEWAY_BASE_URL" in runtime_bff

    # The legacy WebUI ``api`` namespace must not exist in the standalone repo.
    assert not (ROOT / "api").exists()

    for forbidden in (
        "from api.auth import",
        "from api.helpers import",
        "from api.profiles import",
        "from api.routes import",
        "from server import",
    ):
        assert forbidden not in harness
