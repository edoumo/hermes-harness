"""H6/H6.1/H6.2/H6.3 final-contract tests for the complete Harness surface."""
from __future__ import annotations

from pathlib import Path

from hermes_harness import recovery
from hermes_harness import tasks
from hermes_harness import bff as foundation


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "hermes_harness" / "static"

_BROWSER_RUNTIME_ASSETS = (
    "harness.js",
    "harness-operations.js",
    "harness-tasks.js",
    "harness-task-recovery.js",
    "harness-polish2.js",
    "harness-polish3.js",
    "harness-models.js",
    "harness-operator-ux.js",
    "harness-dictation.js",
)
_BROWSER_ASSETS = ("harness-locales.js", "harness-preferences.js") + _BROWSER_RUNTIME_ASSETS


def _asset_source(name: str) -> str:
    return (STATIC / name).read_text(encoding="utf-8")


def test_final_harness_has_exactly_one_eventsource_owner():
    sources = {name: _asset_source(name) for name in _BROWSER_ASSETS}

    assert sources["harness.js"].count("new EventSource") == 1
    for name in _BROWSER_ASSETS:
        if name != "harness.js":
            assert "new EventSource" not in sources[name]


def test_final_browser_assets_keep_server_side_secret_boundary():
    combined = "\n".join(_asset_source(name) for name in _BROWSER_ASSETS)

    for forbidden in (
        "Authorization",
        "Bearer ",
        "API_SERVER_KEY",
        "HERMES_HARNESS_GATEWAY_API_KEY",
        "HERMES_WEBUI_GATEWAY_API_KEY",
        "durable-workers.db",
    ):
        assert forbidden not in combined


def test_browser_localstorage_surfaces_are_namespaced_ui_preferences_only():
    locales = _asset_source("harness-locales.js")
    preferences = _asset_source("harness-preferences.js")
    polish3 = _asset_source("harness-polish3.js")
    operator = _asset_source("harness-operator-ux.js")

    # Operational/runtime assets still do not persist state in the browser.
    for name in (
        "harness.js",
        "harness-operations.js",
        "harness-tasks.js",
        "harness-task-recovery.js",
        "harness-polish2.js",
        "harness-models.js",
        "harness-dictation.js",
    ):
        assert "localStorage" not in _asset_source(name)
    assert "localStorage" not in locales

    # Browser persistence is deliberately limited to presentation preferences.
    assert "localStorage" in preferences
    assert 'const PREFIX = "hermesHarness.ui."' in preferences
    assert "localStorage" in polish3
    assert 'const H63_HIDE_COMPLETED_KEY = "hermesHarness.ui.hideCompletedTasks"' in polish3
    assert "window.localStorage.getItem(H63_HIDE_COMPLETED_KEY)" in polish3
    assert "window.localStorage.setItem(H63_HIDE_COMPLETED_KEY" in polish3
    assert "localStorage" in operator
    assert 'const OUX_PREFIX = "hermesHarness.ui."' in operator

    browser_pref_sources = "\n".join((preferences, polish3, operator))
    for forbidden in (
        "csrfToken",
        "apiKey",
        "Authorization",
        "Bearer ",
        "HERMES_HARNESS_GATEWAY_API_KEY",
        "HERMES_WEBUI_GATEWAY_API_KEY",
        "durable-workers.db",
    ):
        assert forbidden not in browser_pref_sources


def test_final_server_defaults_loopback_and_remote_bind_is_guarded_by_harness_runtime():
    server = (ROOT / "hermes_harness" / "server.py").read_text(encoding="utf-8")
    auth = (ROOT / "hermes_harness" / "auth.py").read_text(encoding="utf-8")

    assert '"127.0.0.1"' in server
    assert "HERMES_HARNESS_ALLOW_REMOTE" in server
    assert "HERMES_HARNESS_PASSWORD" in server
    assert "Non-loopback Harness bind requires" in server
    assert "resolve_bind" in server
    assert "from hermes_harness.recovery import" in server
    assert "HERMES_HARNESS_STATE_DIR" in auth

    # The standalone server delegates asset resolution to the qualified H6
    # layer instead of duplicating an asset allowlist in the HTTP entrypoint.
    assert "serve_harness_asset(self, parsed.path)" in server
    recovery_source = (ROOT / "hermes_harness" / "recovery.py").read_text(encoding="utf-8")
    for asset in (
        "/harness-task-recovery.js",
        "/harness-preferences.js",
        "/harness-locales.js",
        "/harness-polish2.js",
        "/harness-polish3.js",
        "/harness-models.js",
        "/harness-operator-ux.js",
        "/harness-dictation.js",
    ):
        assert f'"{asset}"' in recovery_source


def test_final_bff_delegation_chain_preserves_h4_operations_on_standalone_foundation():
    server = (ROOT / "hermes_harness" / "server.py").read_text(encoding="utf-8")
    recovery_source = (ROOT / "hermes_harness" / "recovery.py").read_text(encoding="utf-8")
    task_source = (ROOT / "hermes_harness" / "tasks.py").read_text(encoding="utf-8")
    operations_source = (ROOT / "hermes_harness" / "operations.py").read_text(encoding="utf-8")
    assert "from hermes_harness.recovery import" in server
    assert "from hermes_harness import tasks" in recovery_source
    assert "from hermes_harness import operations" in recovery_source
    assert "from hermes_harness import operations" in task_source
    assert "from hermes_harness import bff as foundation" in operations_source
    assert "from hermes_harness import bff as foundation" in task_source
    assert "from hermes_harness import bff as foundation" in recovery_source
    # The legacy WebUI server entrypoint must not exist in the standalone repo.
    assert not (ROOT / "server.py").exists()


def test_final_script_boot_order_is_h3_h4_h5_recovery_h62_h63_models_operator_dictation_then_boot():
    boot = recovery._H5_RECOVERY_BOOT

    h4 = boot.index("h4.src='/harness-operations.js'")
    h5 = boot.index("h5.src='/harness-tasks.js'")
    h5_recovery = boot.index("h5r.src='/harness-task-recovery.js'")
    h62 = boot.index("h62.src='/harness-polish2.js'")
    h63 = boot.index("h63.src='/harness-polish3.js'")
    models = boot.index("hm.src='/harness-models.js'")
    operator = boot.index("houx.src='/harness-operator-ux.js'")
    dictation = boot.index("hdict.src='/harness-dictation.js'")
    dom_boot = boot.index("document.dispatchEvent(new Event('DOMContentLoaded'))")

    assert h4 < h5 < h5_recovery < h62 < h63 < models < operator < dictation < dom_boot
    assert boot.count("/harness-operations.js") == 1
    assert boot.count("/harness-tasks.js") == 1
    assert boot.count("/harness-task-recovery.js") == 1
    assert boot.count("/harness-polish2.js") == 1
    assert boot.count("/harness-polish3.js") == 1
    assert boot.count("/harness-models.js") == 1
    assert boot.count("/harness-operator-ux.js") == 1
    assert boot.count("/harness-dictation.js") == 1


def test_final_bff_surface_remains_allowlisted_and_non_destructive():
    foundation_methods = {method for method, _pattern, _template in foundation._ROUTES}
    h5_methods = {method for method, _pattern, _template in tasks._H5_ROUTES}
    h61_methods = {method for method, _pattern, _template in recovery._H61_WORKER_ROUTES}
    h62_methods = {method for method, _pattern, _template in recovery._H62_ROUTES}

    assert foundation_methods <= {"GET", "POST"}
    assert h5_methods <= {"GET", "POST"}
    assert h61_methods == {"POST"}
    assert h62_methods == {"GET", "POST"}
    assert recovery._RECOVERY_ROUTE[0] == "POST"
    combined = foundation_methods | h5_methods | h61_methods | h62_methods
    assert "DELETE" not in combined
    assert "PUT" not in combined
    assert "PATCH" not in combined
