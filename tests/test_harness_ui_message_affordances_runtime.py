"""Runtime regression proof for the effective message-card renderer.

This specifically guards against a duplicate function declaration later in
harness.js silently overriding the richer eventNode() implementation while
string-presence tests still pass.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS_JS = ROOT / "hermes_harness" / "static" / "harness.js"


def test_message_renderer_has_single_effective_definitions():
    source = HARNESS_JS.read_text(encoding="utf-8")

    assert source.count("function eventNode(") == 1
    assert source.count("function formatTime(") == 1


def test_effective_runtime_renderer_keeps_copy_status_timestamp_and_duration():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")

    script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(__HARNESS_JS__, "utf8");

function makeNode(tag = "div") {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    attributes: {},
    style: {},
    disabled: false,
    hidden: false,
    append(...children) { this.children.push(...children.filter(Boolean)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children.filter(Boolean); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener() {},
    remove() {},
    focus() {},
    select() {},
    setSelectionRange() {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
  return node;
}

const nodes = new Map();
function byId(id) {
  if (!nodes.has(id)) nodes.set(id, makeNode("div"));
  return nodes.get(id);
}

const context = {
  window: {
    __HERMES_HARNESS__: {},
    HarnessUI: {},
    addEventListener() {},
  },
  navigator: {},
  document: {
    body: makeNode("body"),
    createElement: makeNode,
    getElementById: byId,
    addEventListener() {},
    execCommand() { return true; },
  },
  console,
  setTimeout() { return 1; },
  clearTimeout() {},
  requestAnimationFrame(fn) { if (typeof fn === "function") fn(); },
};

vm.createContext(context);
vm.runInContext(source, context);

function findClass(root, className) {
  if (!root) return null;
  const classes = String(root.className || "").split(/\s+/).filter(Boolean);
  if (classes.includes(className)) return root;
  for (const child of root.children || []) {
    const found = findClass(child, className);
    if (found) return found;
  }
  return null;
}

// Exercise the actual public renderer path for a worker message.
vm.runInContext(`renderMessages([{
  direction: "worker",
  created_at: 1700000000,
  content: "hello **worker** result",
  state: "consumed"
}]);`, context);

const messageRoot = byId("messageList");
if (messageRoot.children.length !== 1) throw new Error("worker message card not rendered");
const messageCard = messageRoot.children[0];
const messageStatus = findClass(messageCard, "state");
const messageTime = findClass(messageCard, "event-time");
const copyButton = findClass(messageCard, "copy-btn");
const body = findClass(messageCard, "event-body");
if (!messageStatus || messageStatus.textContent !== "consumed") throw new Error("message status missing");
if (!messageTime || !String(messageTime.textContent).trim()) throw new Error("message timestamp missing");
if (!copyButton || copyButton.textContent !== "copy") throw new Error("message copy action missing");
if (!body || body.textContent !== "hello **worker** result") throw new Error("message body changed");

// Exercise activation rendering and canonical duration metadata.
vm.runInContext(`renderActivations([{
  activation_id: "a-1",
  state: "completed",
  started_at: 1700000000,
  completed_at: 1700000004
}]);`, context);

const activationRoot = byId("activationList");
if (activationRoot.children.length !== 1) throw new Error("activation card not rendered");
const activationCard = activationRoot.children[0];
const activationStatus = findClass(activationCard, "state");
const activationTime = findClass(activationCard, "event-time");
const activationDuration = findClass(activationCard, "event-duration");
if (!activationStatus || activationStatus.textContent !== "completed") throw new Error("activation status missing");
if (!activationTime || !String(activationTime.textContent).trim()) throw new Error("activation timestamp missing");
if (!activationDuration || activationDuration.textContent !== "4s") throw new Error("activation duration missing");
'''

    completed = subprocess.run(
        [node, "-e", script.replace("__HARNESS_JS__", json.dumps(str(HARNESS_JS)))],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
