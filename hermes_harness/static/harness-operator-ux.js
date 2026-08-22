"use strict";

// Operator UX layer: keeps the durable transcript primary, moves execution
// diagnostics behind explicit controls, exposes rename actions, and offers
// best-effort browser dictation without taking ownership of Hermes data.

const OUX_PREFIX = "hermesHarness.ui.";
const OUX_KEYS = Object.freeze({
  activationsCollapsed: OUX_PREFIX + "activationsCollapsed",
  tasksCollapsed: OUX_PREFIX + "tasksCollapsed",
  focusMode: OUX_PREFIX + "focusMode",
});

const OUX_TEXT = Object.freeze({
  en: {
    focus: "Focus",
    exitFocus: "Exit focus",
    showExecutions: "Show executions",
    hideExecutions: "Hide executions",
    showTasks: "Show tasks",
    hideTasks: "Hide tasks",
    renameSession: "Rename session",
    renameWorker: "Rename worker",
    sessionName: "Session name",
    save: "Save",
    cancel: "Cancel",
    sessionRenamed: "Session renamed",
    renameFailed: "Rename failed",
    dictation: "Dictate message",
    dictationStop: "Stop dictation",
    dictationListening: "Listening…",
    dictationUnsupported: "Voice dictation is not available in this browser.",
    dictationDenied: "Voice dictation is unavailable here. Check microphone permission or use a secure origin.",
    executionDetails: "Worker result (details)",
  },
  fr: {
    focus: "Focus",
    exitFocus: "Quitter le focus",
    showExecutions: "Afficher les exécutions",
    hideExecutions: "Masquer les exécutions",
    showTasks: "Afficher les tâches",
    hideTasks: "Masquer les tâches",
    renameSession: "Renommer la session",
    renameWorker: "Renommer le worker",
    sessionName: "Nom de la session",
    save: "Enregistrer",
    cancel: "Annuler",
    sessionRenamed: "Session renommée",
    renameFailed: "Échec du renommage",
    dictation: "Dicter le message",
    dictationStop: "Arrêter la dictée",
    dictationListening: "Écoute…",
    dictationUnsupported: "La dictée vocale n’est pas disponible dans ce navigateur.",
    dictationDenied: "La dictée vocale est indisponible ici. Vérifiez l’autorisation micro ou utilisez une origine sécurisée.",
    executionDetails: "Retour du worker (détails)",
  },
  es: {
    focus: "Foco",
    exitFocus: "Salir del foco",
    showExecutions: "Mostrar ejecuciones",
    hideExecutions: "Ocultar ejecuciones",
    showTasks: "Mostrar tareas",
    hideTasks: "Ocultar tareas",
    renameSession: "Renombrar sesión",
    renameWorker: "Renombrar worker",
    sessionName: "Nombre de la sesión",
    save: "Guardar",
    cancel: "Cancelar",
    sessionRenamed: "Sesión renombrada",
    renameFailed: "Error al renombrar",
    dictation: "Dictar mensaje",
    dictationStop: "Detener dictado",
    dictationListening: "Escuchando…",
    dictationUnsupported: "El dictado por voz no está disponible en este navegador.",
    dictationDenied: "El dictado por voz no está disponible aquí. Comprueba el permiso del micrófono o usa un origen seguro.",
    executionDetails: "Resultado del worker (detalles)",
  },
  pt: {
    focus: "Foco",
    exitFocus: "Sair do foco",
    showExecutions: "Mostrar execuções",
    hideExecutions: "Ocultar execuções",
    showTasks: "Mostrar tarefas",
    hideTasks: "Ocultar tarefas",
    renameSession: "Renomear sessão",
    renameWorker: "Renomear worker",
    sessionName: "Nome da sessão",
    save: "Guardar",
    cancel: "Cancelar",
    sessionRenamed: "Sessão renomeada",
    renameFailed: "Falha ao renomear",
    dictation: "Ditar mensagem",
    dictationStop: "Parar ditado",
    dictationListening: "A ouvir…",
    dictationUnsupported: "O ditado por voz não está disponível neste navegador.",
    dictationDenied: "O ditado por voz não está disponível aqui. Verifique a permissão do microfone ou use uma origem segura.",
    executionDetails: "Resultado do worker (detalhes)",
  },
  de: {
    focus: "Fokus",
    exitFocus: "Fokus beenden",
    showExecutions: "Ausführungen anzeigen",
    hideExecutions: "Ausführungen ausblenden",
    showTasks: "Aufgaben anzeigen",
    hideTasks: "Aufgaben ausblenden",
    renameSession: "Sitzung umbenennen",
    renameWorker: "Worker umbenennen",
    sessionName: "Sitzungsname",
    save: "Speichern",
    cancel: "Abbrechen",
    sessionRenamed: "Sitzung umbenannt",
    renameFailed: "Umbenennen fehlgeschlagen",
    dictation: "Nachricht diktieren",
    dictationStop: "Diktat stoppen",
    dictationListening: "Hört zu…",
    dictationUnsupported: "Sprachdiktat ist in diesem Browser nicht verfügbar.",
    dictationDenied: "Sprachdiktat ist hier nicht verfügbar. Mikrofonberechtigung prüfen oder einen sicheren Ursprung verwenden.",
    executionDetails: "Worker-Ergebnis (Details)",
  },
  it: {
    focus: "Focus",
    exitFocus: "Esci dal focus",
    showExecutions: "Mostra esecuzioni",
    hideExecutions: "Nascondi esecuzioni",
    showTasks: "Mostra attività",
    hideTasks: "Nascondi attività",
    renameSession: "Rinomina sessione",
    renameWorker: "Rinomina worker",
    sessionName: "Nome sessione",
    save: "Salva",
    cancel: "Annulla",
    sessionRenamed: "Sessione rinominata",
    renameFailed: "Rinomina non riuscita",
    dictation: "Detta messaggio",
    dictationStop: "Ferma dettatura",
    dictationListening: "In ascolto…",
    dictationUnsupported: "La dettatura vocale non è disponibile in questo browser.",
    dictationDenied: "La dettatura vocale non è disponibile qui. Controlla il permesso del microfono o usa un'origine sicura.",
    executionDetails: "Risultato worker (dettagli)",
  },
});

function ouxLocale() {
  const raw = typeof ui.locale === "function" ? ui.locale() : "en";
  return OUX_TEXT[raw] ? raw : "en";
}

function ouxText(key) {
  return OUX_TEXT[ouxLocale()][key] || OUX_TEXT.en[key] || key;
}

function ouxReadBool(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1" || raw === "true";
  } catch (_) {
    return fallback;
  }
}

function ouxWriteBool(key, value) {
  try { window.localStorage.setItem(key, value ? "1" : "0"); } catch (_) {}
}

const ouxState = {
  activationsCollapsed: ouxReadBool(OUX_KEYS.activationsCollapsed, true),
  tasksCollapsed: ouxReadBool(OUX_KEYS.tasksCollapsed, false),
  focusMode: ouxReadBool(OUX_KEYS.focusMode, false),
  recognition: null,
  listening: false,
};

function ouxButton(id, icon, label) {
  const button = el("button", "ghost oux-toggle");
  button.id = id;
  button.type = "button";
  const iconNode = el("span", "oux-toggle-icon", icon);
  iconNode.setAttribute("aria-hidden", "true");
  const textNode = el("span", "oux-toggle-label", label);
  button.append(iconNode, textNode);
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

function ouxInstallStyles() {
  if ($("harnessOperatorUxStyle")) return;
  const style = document.createElement("style");
  style.id = "harnessOperatorUxStyle";
  style.textContent = `
    .worker-view{max-width:1680px!important;width:100%}
    .content-grid{grid-template-columns:minmax(0,1fr) minmax(240px,.46fr)!important;gap:14px!important}
    .worker-actions{flex-wrap:wrap;justify-content:flex-end}
    .oux-toggle{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
    .oux-toggle-icon{font-size:14px;line-height:1}
    .oux-toggle[aria-pressed="true"]{border-color:var(--accent);color:var(--text)}
    .topbar .oux-focus-toggle{min-width:34px}
    .oux-activations-collapsed .activation-card{display:none!important}
    .oux-activations-collapsed .content-grid{grid-template-columns:minmax(0,1fr)!important}
    .oux-tasks-collapsed .tasks-card{display:none!important}
    .activation-card .event-body{font-size:10px;line-height:1.45;color:var(--muted)}
    .activation-card .event-footer{margin-top:4px}
    .oux-activation-details{margin-top:7px;border-top:1px solid var(--border);padding-top:6px;color:var(--muted);font-size:10px}
    .oux-activation-details summary{cursor:pointer;color:var(--soft);user-select:none}
    .oux-activation-details .oux-activation-summary{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7px;color:var(--text);opacity:.82}
    .oux-rail-rename{font-size:15px}
    .oux-compose-mic{flex:0 0 auto;min-width:38px}
    .oux-compose-mic.oux-listening{border-color:var(--danger);color:var(--danger)}
    .oux-session-dialog form{padding:18px;display:grid;gap:13px}
    body.oux-focus-mode .layout{grid-template-columns:minmax(0,1fr)!important}
    body.oux-focus-mode .sessions-rail,body.oux-focus-mode .workers-rail{display:none!important}
    body.oux-focus-mode .workspace{grid-column:1/-1;padding:18px 24px}
    body.oux-focus-mode .worker-view{max-width:none!important}
    body.oux-focus-mode .activation-card,body.oux-focus-mode .tasks-card{display:none!important}
    body.oux-focus-mode .content-grid{grid-template-columns:minmax(0,1fr)!important}
    body.oux-focus-mode .timeline{max-height:calc(100vh - 330px)}
    @media (max-width:1180px){
      .content-grid{grid-template-columns:minmax(0,1fr)!important}
      .activation-card{width:100%}
      .worker-header .oux-toggle-label{display:none}
      .worker-header .oux-toggle{width:32px;padding:0;justify-content:center}
    }
    @media (max-width:760px){
      .worker-actions{gap:4px}
      .compose-actions{flex-wrap:wrap}
      .compose-actions input{max-width:none;flex:1 1 100%}
      .workspace{padding:14px}
    }
  `;
  document.head.appendChild(style);
}

function ouxSetButtonLabel(button, label) {
  if (!button) return;
  button.setAttribute("aria-label", label);
  button.title = label;
  const text = button.querySelector(".oux-toggle-label");
  if (text) text.textContent = label;
}

function ouxApplyLayout() {
  const view = $("workerView");
  if (view) {
    view.classList.toggle("oux-activations-collapsed", ouxState.activationsCollapsed);
    view.classList.toggle("oux-tasks-collapsed", ouxState.tasksCollapsed);
  }
  document.body.classList.toggle("oux-focus-mode", ouxState.focusMode);

  const executionButton = $("ouxExecutionToggle");
  if (executionButton) {
    executionButton.setAttribute("aria-pressed", String(!ouxState.activationsCollapsed));
    ouxSetButtonLabel(executionButton, ouxText(ouxState.activationsCollapsed ? "showExecutions" : "hideExecutions"));
  }
  const tasksButton = $("ouxTasksToggle");
  if (tasksButton) {
    tasksButton.setAttribute("aria-pressed", String(!ouxState.tasksCollapsed));
    ouxSetButtonLabel(tasksButton, ouxText(ouxState.tasksCollapsed ? "showTasks" : "hideTasks"));
  }
  const focusButton = $("ouxFocusToggle");
  if (focusButton) {
    focusButton.setAttribute("aria-pressed", String(ouxState.focusMode));
    ouxSetButtonLabel(focusButton, ouxText(ouxState.focusMode ? "exitFocus" : "focus"));
  }
  window.dispatchEvent(new CustomEvent("hermes-harness-ui-change", { detail: { kind: "layout" } }));
}

function ouxInstallWorkspaceControls() {
  const actions = document.querySelector(".worker-header .worker-actions");
  if (actions && !$("ouxExecutionToggle")) {
    const execution = ouxButton("ouxExecutionToggle", "▣", ouxText("showExecutions"));
    execution.addEventListener("click", () => {
      ouxState.activationsCollapsed = !ouxState.activationsCollapsed;
      ouxWriteBool(OUX_KEYS.activationsCollapsed, ouxState.activationsCollapsed);
      ouxApplyLayout();
    });
    const tasksButton = ouxButton("ouxTasksToggle", "◇", ouxText("hideTasks"));
    tasksButton.addEventListener("click", () => {
      ouxState.tasksCollapsed = !ouxState.tasksCollapsed;
      ouxWriteBool(OUX_KEYS.tasksCollapsed, ouxState.tasksCollapsed);
      ouxApplyLayout();
    });
    actions.prepend(tasksButton);
    actions.prepend(execution);
  }

  // Focus is global rather than worker-local so a persisted focus preference can
  // always be escaped after reload, even before a worker is selected.
  const topbar = document.querySelector(".topbar .connection");
  if (topbar && !$("ouxFocusToggle")) {
    const focus = ouxButton("ouxFocusToggle", "⛶", ouxText("focus"));
    focus.classList.add("oux-focus-toggle");
    focus.addEventListener("click", () => {
      ouxState.focusMode = !ouxState.focusMode;
      ouxWriteBool(OUX_KEYS.focusMode, ouxState.focusMode);
      ouxApplyLayout();
    });
    const refresh = $("refreshAllBtn");
    topbar.insertBefore(focus, refresh || null);
  }
}

function ouxInstallRenameControls() {
  const sessionActions = document.querySelector(".sessions-rail .rail-actions");
  if (sessionActions && !$("ouxRenameSessionBtn")) {
    const button = el("button", "icon-btn subtle-icon oux-rail-rename", "✎");
    button.id = "ouxRenameSessionBtn";
    button.type = "button";
    button.title = ouxText("renameSession");
    button.setAttribute("aria-label", button.title);
    button.disabled = !state.sessionId;
    button.addEventListener("click", ouxOpenSessionRename);
    const archive = $("archiveSessionBtn");
    sessionActions.insertBefore(button, archive || sessionActions.firstChild);
  }

  const workerActions = document.querySelector(".workers-rail .rail-actions");
  if (workerActions && !$("ouxRenameWorkerBtn")) {
    const button = el("button", "icon-btn subtle-icon oux-rail-rename", "✎");
    button.id = "ouxRenameWorkerBtn";
    button.type = "button";
    button.title = ouxText("renameWorker");
    button.setAttribute("aria-label", button.title);
    button.disabled = !state.workerId;
    button.addEventListener("click", () => {
      if (state.workerId && typeof openWorkerSettings === "function") openWorkerSettings();
    });
    const create = $("newWorkerBtn");
    workerActions.insertBefore(button, create || sessionActions?.firstChild || null);
  }
  ouxUpdateRenameControls();
}

function ouxUpdateRenameControls() {
  const sessionButton = $("ouxRenameSessionBtn");
  if (sessionButton) {
    sessionButton.disabled = !state.sessionId;
    sessionButton.title = ouxText("renameSession");
    sessionButton.setAttribute("aria-label", sessionButton.title);
  }
  const workerButton = $("ouxRenameWorkerBtn");
  if (workerButton) {
    const worker = state.workers.find((item) => item.worker_id === state.workerId);
    workerButton.disabled = !worker || worker.status === "RUNNING" || worker.status === "DISABLED";
    workerButton.title = ouxText("renameWorker");
    workerButton.setAttribute("aria-label", workerButton.title);
  }
}

function ouxEnsureSessionDialog() {
  let dialog = $("ouxSessionRenameDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "ouxSessionRenameDialog";
  dialog.className = "oux-session-dialog";
  const form = document.createElement("form");
  form.id = "ouxSessionRenameForm";
  form.method = "dialog";
  const head = el("div", "dialog-head");
  head.append(el("h2", "", ouxText("renameSession")));
  const close = el("button", "icon-btn", "×");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  head.append(close);
  form.append(head);
  const label = document.createElement("label");
  label.append(el("span", "", ouxText("sessionName")));
  const input = document.createElement("input");
  input.id = "ouxSessionRenameInput";
  input.maxLength = 160;
  input.required = true;
  label.append(input);
  form.append(label);
  const buttons = el("div", "dialog-actions");
  const cancel = el("button", "ghost", ouxText("cancel"));
  cancel.id = "ouxSessionRenameCancel";
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const save = el("button", "primary", ouxText("save"));
  save.id = "ouxSessionRenameSave";
  save.type = "submit";
  buttons.append(cancel, save);
  form.append(buttons);
  form.addEventListener("submit", ouxSaveSessionRename);
  dialog.append(form);
  document.body.append(dialog);
  return dialog;
}

function ouxRefreshSessionDialogLocale(dialog) {
  if (!dialog) return;
  const heading = dialog.querySelector("h2");
  const label = dialog.querySelector("label span");
  if (heading) heading.textContent = ouxText("renameSession");
  if (label) label.textContent = ouxText("sessionName");
  const cancel = $("ouxSessionRenameCancel");
  const save = $("ouxSessionRenameSave");
  if (cancel) cancel.textContent = ouxText("cancel");
  if (save) save.textContent = ouxText("save");
}

function ouxOpenSessionRename() {
  if (!state.sessionId) return;
  const session = state.sessions.find((item) => item.id === state.sessionId);
  if (!session) return;
  const dialog = ouxEnsureSessionDialog();
  ouxRefreshSessionDialogLocale(dialog);
  const input = $("ouxSessionRenameInput");
  input.value = session.title || session.name || session.id;
  dialog.showModal();
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

async function ouxSaveSessionRename(event) {
  event.preventDefault();
  if (!state.sessionId) return;
  const sid = safeId(state.sessionId);
  const title = $("ouxSessionRenameInput").value.trim();
  if (!title) return;
  try {
    await api("/api/harness/session-rename", {
      method: "POST",
      body: { session_id: sid, title },
    });
    $("ouxSessionRenameDialog").close();
    await loadSessions({ selectFirst: false });
    showToast(ouxText("sessionRenamed"));
  } catch (error) {
    showToast(`${ouxText("renameFailed")}: ${error.message}`, true);
  }
}

function ouxSpeechConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function ouxSpeechLocale() {
  return ({ en: "en-US", fr: "fr-FR", es: "es-ES", pt: "pt-PT", de: "de-DE", it: "it-IT" })[ouxLocale()] || "en-US";
}

function ouxInsertDictation(textarea, transcript) {
  const clean = String(transcript || "").trim();
  if (!clean) return;
  const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
  const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const leftSpace = before && !/\s$/.test(before) ? " " : "";
  const rightSpace = after && !/^\s/.test(after) ? " " : "";
  const inserted = leftSpace + clean + rightSpace;
  textarea.value = before + inserted + after;
  const cursor = before.length + inserted.length;
  textarea.setSelectionRange(cursor, cursor);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function ouxSetListening(listening) {
  ouxState.listening = !!listening;
  const button = $("ouxDictationBtn");
  if (!button) return;
  button.classList.toggle("oux-listening", ouxState.listening);
  const label = ouxText(ouxState.listening ? "dictationStop" : "dictation");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(ouxState.listening));
  button.textContent = ouxState.listening ? "■" : "🎙";
}

function ouxInstallDictation() {
  const actions = document.querySelector(".compose-actions");
  if (!actions || $("ouxDictationBtn")) return;
  const button = el("button", "ghost oux-compose-mic", "🎙");
  button.id = "ouxDictationBtn";
  button.type = "button";
  button.title = ouxText("dictation");
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", "false");
  const send = $("sendMessageBtn");
  actions.insertBefore(button, send || null);

  const SpeechRecognitionCtor = ouxSpeechConstructor();
  if (!SpeechRecognitionCtor) {
    button.disabled = true;
    button.title = ouxText("dictationUnsupported");
    button.setAttribute("aria-label", button.title);
    return;
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = ouxSpeechLocale();
  recognition.onstart = () => {
    ouxSetListening(true);
    showToast(ouxText("dictationListening"));
  };
  recognition.onresult = (event) => {
    const chunks = [];
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal && event.results[i][0]?.transcript) chunks.push(event.results[i][0].transcript);
    }
    if (chunks.length) ouxInsertDictation($("messageInput"), chunks.join(" "));
  };
  recognition.onerror = (event) => {
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      showToast(ouxText("dictationDenied"), true);
    } else if (event.error !== "aborted") {
      showToast(`${ouxText("dictation")}: ${event.error || "error"}`, true);
    }
  };
  recognition.onend = () => ouxSetListening(false);
  ouxState.recognition = recognition;

  button.addEventListener("click", () => {
    if (ouxState.listening) {
      recognition.stop();
      return;
    }
    recognition.lang = ouxSpeechLocale();
    try { recognition.start(); }
    catch (error) { showToast(`${ouxText("dictation")}: ${error.message}`, true); }
  });
}

function ouxRefreshDictationLocale() {
  const button = $("ouxDictationBtn");
  if (!button) return;
  if (button.disabled) {
    button.title = ouxText("dictationUnsupported");
    button.setAttribute("aria-label", button.title);
    return;
  }
  ouxSetListening(ouxState.listening);
}

function ouxActivationNode(activation) {
  const technical = [];
  if (activation.activation_id) technical.push(activation.activation_id);
  if (activation.subagent_id) technical.push(`subagent ${activation.subagent_id}`);
  if (activation.error) technical.push(`Error: ${activation.error}`);
  const duration = canonicalDurationSeconds(activation);
  const meta = duration !== null ? formatDuration(duration) : null;
  const body = technical.join("\n");
  const card = eventNode("ACTIVATION", activation.started_at, body, activation.state, body || null, meta);
  card.classList.add("oux-tech-event");
  if (activation.summary) {
    const details = document.createElement("details");
    details.className = "oux-activation-details";
    details.append(el("summary", "", ouxText("executionDetails")));
    details.append(el("div", "oux-activation-summary", activation.summary));
    card.append(details);
  }
  return card;
}

// Override only presentation. The activation source and lifecycle remain Hermes-owned.
renderActivations = function ouxRenderActivations(items) {
  const root = $("activationList");
  root.replaceChildren();
  if (!items.length) return root.append(el("div", "muted", t("noActivations")));
  for (const activation of items) root.append(ouxActivationNode(activation));
};

function ouxWrapRenderers() {
  if (renderSessions.__ouxWrapped) return;
  const previousSessions = renderSessions;
  renderSessions = function ouxRenderSessions() {
    const result = previousSessions.apply(this, arguments);
    ouxUpdateRenameControls();
    return result;
  };
  renderSessions.__ouxWrapped = true;

  const previousWorkers = renderWorkers;
  renderWorkers = function ouxRenderWorkers() {
    const result = previousWorkers.apply(this, arguments);
    ouxUpdateRenameControls();
    return result;
  };
  renderWorkers.__ouxWrapped = true;
}

function ouxRefreshLocale() {
  ouxApplyLayout();
  ouxUpdateRenameControls();
  ouxRefreshDictationLocale();
  const dialog = $("ouxSessionRenameDialog");
  if (dialog) ouxRefreshSessionDialogLocale(dialog);
}

function ouxInit() {
  ouxInstallStyles();
  ouxInstallWorkspaceControls();
  ouxInstallRenameControls();
  ouxInstallDictation();
  ouxWrapRenderers();
  ouxApplyLayout();
  window.addEventListener("hermes-harness-ui-change", (event) => {
    if (event.detail?.kind === "locale") ouxRefreshLocale();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ouxInit, { once: true });
else ouxInit();
