"""Contract tests for MESSAGE_RESULT_AFFORDANCES (copy / timestamp / duration).

The message cards must expose a working Copy action (with an HTTP/LAN-safe
fallback), keep status and timestamp visible simultaneously, and only show
canonical execution durations derived from Hermes timestamps — never a client
clock approximation.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "hermes_harness" / "static"


def _static(name: str) -> str:
    return (STATIC / name).read_text(encoding="utf-8")


def test_copy_button_present_for_worker_and_parent_messages():
    harness = _static("harness.js")

    assert "copyButton" in harness
    assert "copy-btn" in harness
    assert "navigator.clipboard.writeText" in harness
    # The fallback must exist for non-secure HTTP contexts (LAN usage).
    assert "document.execCommand" in harness
    assert "createElement(\"textarea\")" in harness
    assert "setSelectionRange" in harness
    assert "area.remove()" in harness

    # renderMessages passes the message content to the copy affordance for
    # both directions (worker and parent).
    assert "message.direction === \"worker\" ? \"WORKER\" : \"PARENT\"" in harness
    assert "eventNode(direction, message.created_at, message.content, message.state, message.content)" in harness


def test_copy_fallback_does_not_require_secure_context_or_backend():
    harness = _static("harness.js")

    # The clipboard API is only attempted; failure falls back to a local
    # textarea + execCommand copy. No POST, no fetch, no storage is involved.
    assert "navigator.clipboard && typeof navigator.clipboard.writeText === \"function\"" in harness
    assert "catch (_) {" in harness
    assert "document.execCommand(\"copy\")" in harness
    assert "async function copyText" in harness


def test_message_timestamp_and_status_coexist():
    harness = _static("harness.js")

    # There must be exactly one effective renderer. A duplicate declaration
    # later in the classic script would silently override the richer renderer
    # while string-presence checks still passed.
    assert harness.count("function eventNode(") == 1
    assert harness.count("function formatTime(") == 1

    # eventNode renders BOTH the state label and the formatted timestamp when
    # both are available (previously the header showed only one of them).
    assert "stateName" in harness
    assert "formatTime(timestamp)" in harness
    assert "event-meta" in harness
    assert "event-time" in harness
    assert "statusLabel(stateName)" in harness

    # The timestamp is server-side created_at, formatted with the UI locale.
    assert "message.created_at" in harness
    assert "ui.locale" in harness


def test_activation_timestamp_visible():
    harness = _static("harness.js")

    assert "activation.started_at" in harness
    assert "formatTime(activation.started_at)" in harness or "activation.started_at" in harness


def test_duration_only_canonical():
    harness = _static("harness.js")

    # Duration is derived from Hermes-owned started_at/completed_at of the
    # same activation, never from Date.now() or a fetch-to-render clock.
    assert "canonicalDurationSeconds" in harness
    assert "activation.started_at" in harness
    assert "activation.completed_at" in harness
    assert "Date.now()" not in harness
    assert "performance.now()" not in harness

    # Guard rails: missing/zero/inverted bounds yield no duration.
    assert "end < start" in harness
    assert "return null" in harness


def test_no_fork_regenerate_or_purge_added():
    harness = _static("harness.js")
    preferences = _static("harness-preferences.js")

    assert "fork" not in harness.lower()
    assert "fork" not in preferences.lower()
    assert "regenerate" not in harness.lower()
    assert "method: \"DELETE\"" not in harness
    assert "purgeSessions" not in harness
