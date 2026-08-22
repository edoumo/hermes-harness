"""Runtime proof of the Copy fallback in a non-secure (HTTP/LAN) context.

Harness is used over plain http://192.168.1.x:PORT/harness where
navigator.clipboard is unavailable or rejected. copyText() must fall back to a
temporary textarea + execCommand("copy") — no secure context, no backend call.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS_JS = ROOT / "hermes_harness" / "static" / "harness.js"


def test_copy_fallback_http_context_via_exec_command():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")

    script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(__HARNESS_JS__, "utf8");

// Non-secure HTTP context: no clipboard API at all.
const copiedValues = [];
const domNodes = new Map();
function domNode(id) {
  if (!domNodes.has(id)) {
    domNodes.set(id, {
      textContent: "",
      classList: { add() {}, remove() {} },
    });
  }
  return domNodes.get(id);
}

let execCommandCalls = 0;
let textareaCleaned = false;
const context = {
  window: { __HERMES_HARNESS__: {}, addEventListener() {} },
  navigator: {}, // no clipboard.writeText
  document: {
    body: { appendChild() {} },
    getElementById: domNode,
    addEventListener() {},
    createElement(tag) {
      if (tag === "textarea") {
        return {
          value: "",
          setAttribute() {},
          style: {},
          focus() {},
          select() { copiedValues.push(this.value); },
          setSelectionRange() {},
          remove() { textareaCleaned = true; },
        };
      }
      return { classList: { add() {}, remove() {} }, setAttribute() {}, append() {} };
    },
    execCommand(command) {
      createdTextCalls++;
      return command === "copy";
    },
  },
  console,
};
let createdTextCalls = 0;

vm.createContext(context);
vm.runInContext(source, context);

// copyText is defined at top level in harness.js.
vm.runInContext(`
  (async function () {
    const ok = await copyText("hello **worker** result");
    if (!ok) throw new Error("copyText returned false");
  })();
`, context).then(() => {
  if (copiedValues.length !== 1 || copiedValues[0] !== "hello **worker** result") {
    throw new Error("textarea selection did not receive the message content");
  }
  if (createdTextCalls !== 1) throw new Error("execCommand copy not invoked exactly once");
  if (!textareaCleaned) throw new Error("temporary textarea was not removed");
}).catch((error) => { console.error(error); process.exit(1); });
'''
    completed = subprocess.run(
        [node, "-e", script.replace("__HARNESS_JS__", json.dumps(str(HARNESS_JS)))],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
