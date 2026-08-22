"""Regression contracts from Ed's manual UAT screenshots on PR #2."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "hermes_harness" / "static"
POLISH3 = STATIC / "harness-polish3.js"
MODELS = STATIC / "harness-models.js"
OPERATOR = STATIC / "harness-operator-ux.js"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_operator_layer_has_h63_watchdog_fallback():
    source = _read(POLISH3)
    assert "function h63EnsureOperatorUx()" in source
    assert 'typeof ouxInit === "function"' in source
    assert 'script.src = "/harness-operator-ux.js"' in source
    assert 'script.dataset.h63OperatorFallback = "1"' in source
    assert "window.setTimeout" in source


def test_single_stage_tasks_grid_the_actual_task_group_at_full_width():
    source = _read(POLISH3)
    # h5RenderDag puts task cards inside .h5-dag-group. Applying columns to the
    # parent level creates one narrow group plus dead space, which Ed caught in
    # real UAT. The group itself must own the responsive grid.
    assert ".h5-dag-canvas.h63-single-stage .h5-dag-level{display:block!important;width:100%!important" in source
    assert ".h5-dag-canvas.h63-single-stage .h5-dag-group{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))" in source
    assert "function h63ApplySingleStageColumns" in source
    assert 'group.style.setProperty("grid-template-columns"' in source
    assert "Math.min(responsiveCap, visibleTasks || 1)" in source
    assert ".h5-dag-level{display:grid!important;grid-template-columns:repeat(3" not in source


def test_completed_single_stage_task_history_hides_existing_and_future_cards():
    source = _read(POLISH3)
    assert 'H63_HIDE_COMPLETED_KEY = "hermesHarness.ui.hideCompletedTasks"' in source
    assert "function h63SyncRenderedTaskStatus" in source
    assert 'node.dataset.h5Status = String(task.status || "")' in source
    assert 'node.hidden = hidden && node.dataset.h5Status === "completed"' in source
    assert ".h5-task-node[hidden]{display:none!important}" in source
    assert "h63CompletedTasksToggle" in source
    assert "h63WriteHideCompleted(!h63ReadHideCompleted())" in source
    assert "subtree: true" in source
    assert "/delete" not in source
    assert "/purge" not in source


def test_new_task_dialog_has_description_dictation_without_submit_or_backend_call():
    source = _read(POLISH3)
    start = source.index("function h63InstallTaskDictation()")
    end = source.index("function h63EnsureOperatorUx()", start)
    block = source[start:end]
    assert 'textarea[name="description"]' in block
    assert 'button.id = "h63TaskDictationBtn"' in block
    assert "window.SpeechRecognition || window.webkitSpeechRecognition" in block
    assert "h63InsertText(textarea" in block
    assert "api(" not in block
    assert "fetch(" not in block
    assert "taskForm.submit" not in block
    assert "createTaskSubmit" not in block


def test_model_auxiliary_failure_does_not_blank_main_model_controls():
    source = _read(MODELS)
    start = source.index("async function loadConfiguration")
    end = source.index("async function openModels", start)
    block = source[start:end]
    assert 'options = await api(`/api/harness/model-options${suffix}`)' in block
    assert 'panel.auxiliary = await api("/api/harness/model-auxiliary")' in block
    assert "panel.auxiliaryAvailable = false" in block
    assert "renderMain();" in block
    assert "renderAuxiliary();" in block
    assert "Promise.all" not in block
    assert "auxiliaryUnavailable" in source


def test_activation_duplicate_is_still_removed_by_operator_renderer():
    source = _read(OPERATOR)
    start = source.index("function ouxActivationNode")
    end = source.index("// Override only presentation", start)
    block = source[start:end]
    assert "technical.push(activation.summary)" not in block
    assert "if (activation.summary)" in block
    assert 'document.createElement("details")' in block


@pytest.mark.parametrize("path", [POLISH3, MODELS])
def test_changed_javascript_syntax(path: Path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    completed = subprocess.run(
        [node, "--check", str(path)],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
