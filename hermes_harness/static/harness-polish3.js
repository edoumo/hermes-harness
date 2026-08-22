"use strict";

// H6.3 is the third human-UAT polish layer. It deliberately stays browser-only:
// it improves model discovery, locale presentation and DAG/task ergonomics
// without taking ownership of auth, SSE, task state or durable-worker storage.

const H63_LOCALE_FLAGS = Object.freeze({
  en: "🇬🇧",
  fr: "🇫🇷",
  es: "🇪🇸",
  pt: "🇵🇹",
  de: "🇩🇪",
  it: "🇮🇹",
});

const H63_TASK_TEXT = Object.freeze({
  en: { dictate: "Dictate task description", stop: "Stop dictation", listening: "Listening…", unsupported: "Voice dictation is not available in this browser.", denied: "Voice dictation is unavailable here. Check microphone permission or use a secure origin.", showDone: "Show completed", hideDone: "Hide completed" },
  fr: { dictate: "Dicter la description de la tâche", stop: "Arrêter la dictée", listening: "Écoute…", unsupported: "La dictée vocale n’est pas disponible dans ce navigateur.", denied: "La dictée vocale est indisponible ici. Vérifiez l’autorisation micro ou utilisez une origine sécurisée.", showDone: "Afficher les terminées", hideDone: "Masquer les terminées" },
  es: { dictate: "Dictar la descripción de la tarea", stop: "Detener dictado", listening: "Escuchando…", unsupported: "El dictado por voz no está disponible en este navegador.", denied: "El dictado por voz no está disponible aquí. Comprueba el permiso del micrófono o usa un origen seguro.", showDone: "Mostrar completadas", hideDone: "Ocultar completadas" },
  pt: { dictate: "Ditar a descrição da tarefa", stop: "Parar ditado", listening: "A ouvir…", unsupported: "O ditado por voz não está disponível neste navegador.", denied: "O ditado por voz não está disponível aqui. Verifique a permissão do microfone ou use uma origem segura.", showDone: "Mostrar concluídas", hideDone: "Ocultar concluídas" },
  de: { dictate: "Aufgabenbeschreibung diktieren", stop: "Diktat stoppen", listening: "Hört zu…", unsupported: "Sprachdiktat ist in diesem Browser nicht verfügbar.", denied: "Sprachdiktat ist hier nicht verfügbar. Mikrofonberechtigung prüfen oder einen sicheren Ursprung verwenden.", showDone: "Erledigte anzeigen", hideDone: "Erledigte ausblenden" },
  it: { dictate: "Detta la descrizione dell’attività", stop: "Ferma dettatura", listening: "In ascolto…", unsupported: "La dettatura vocale non è disponibile in questo browser.", denied: "La dettatura vocale non è disponibile qui. Controlla il permesso del microfono o usa un'origine sicura.", showDone: "Mostra completate", hideDone: "Nascondi completate" },
});

const H63_HIDE_COMPLETED_KEY = "hermesHarness.ui.hideCompletedTasks";
let h63TaskRecognition = null;
let h63TaskListening = false;

function h63Locale() {
  const raw = typeof ui?.locale === "function" ? ui.locale() : "en";
  return H63_TASK_TEXT[raw] ? raw : "en";
}

function h63TaskText(key) {
  return H63_TASK_TEXT[h63Locale()]?.[key] || H63_TASK_TEXT.en[key] || key;
}

function h63ProviderSlug(row) {
  return String(row?.slug || row?.provider || row?.id || row?.name || "").trim();
}

function h63ModelId(item) {
  if (typeof item === "string") return item.trim();
  return String(item?.id || item?.model || item?.name || "").trim();
}

function h63ProviderModels(row) {
  return h62UniqueStrings((Array.isArray(row?.models) ? row.models : []).map(h63ModelId));
}

function h63RuntimeModelHints() {
  const hints = [];
  const add = (value) => {
    const clean = String(value || "").trim();
    if (clean && !hints.includes(clean)) hints.push(clean);
  };
  add(state.currentWorker?.model);
  for (const worker of state.workers || []) add(worker?.model);
  const selectedSession = (state.sessions || []).find((session) => session.id === state.sessionId);
  add(selectedSession?.model || selectedSession?.model_id);
  add(state.h62ModelCatalog?.currentModel);
  return hints;
}

function h63RowsContainingModels(providers, hints) {
  if (!hints.length) return [];
  return providers.filter((row) => {
    const models = new Set(h63ProviderModels(row));
    return hints.some((hint) => models.has(hint));
  });
}

function h63PreferredProviderRow(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const rootProvider = String(payload?.provider || "").trim().toLowerCase();
  const rootModel = String(payload?.model || "").trim();

  if (rootProvider) {
    const exact = providers.find((row) => h63ProviderSlug(row).toLowerCase() === rootProvider);
    if (exact) return exact;
  }

  const modelHints = h62UniqueStrings([rootModel, ...h63RuntimeModelHints()]);
  const matching = h63RowsContainingModels(providers, modelHints);
  if (matching.length === 1) return matching[0];

  const explicitlyActive = providers.filter((row) =>
    h63ProviderModels(row).length &&
    (row?.active === true || row?.current === true || row?.selected === true)
  );
  if (explicitlyActive.length === 1) return explicitlyActive[0];

  const authenticated = providers.filter((row) =>
    h63ProviderModels(row).length && (row?.authenticated === true || row?.configured === true)
  );
  if (authenticated.length === 1) return authenticated[0];

  return null;
}

function h63CatalogFromPayload(payload) {
  const row = h63PreferredProviderRow(payload);
  const rootModel = String(payload?.model || "").trim();
  const runtimeHints = h63RuntimeModelHints();
  const models = h63ProviderModels(row);
  let currentModel = rootModel;
  if (!currentModel) currentModel = runtimeHints.find((model) => models.includes(model)) || "";
  if (currentModel && !models.includes(currentModel)) models.unshift(currentModel);
  return {
    provider: h63ProviderSlug(row) || String(payload?.provider || "").trim(),
    currentModel,
    models,
  };
}

function h63ApplyModelCatalog(catalog) {
  state.h62ModelCatalog = catalog;
  state.models = h62UniqueStrings(catalog?.models || []);
  h62FillModelSelect("workerModelSelect", "workerCustomModelInput", catalog?.currentModel || "");
  const settingsValue = state.currentWorker?.model || h62SelectedModel("workerSettingsModelSelect", "workerSettingsCustomModelInput") || "";
  h62FillModelSelect("workerSettingsModelSelect", "workerSettingsCustomModelInput", settingsValue);
  h62UpdateModelHelp();
}

state.h63ModelOptionsPayload = null;

loadModels = async function h63LoadModels() {
  try {
    const payload = await api("/api/harness/model-options");
    state.h63ModelOptionsPayload = payload;
    h63ApplyModelCatalog(h63CatalogFromPayload(payload));
  } catch (_) {
    state.h63ModelOptionsPayload = null;
    state.h62ModelCatalog = { provider: "", currentModel: "", models: [] };
    state.models = [];
    h63ApplyModelCatalog(state.h62ModelCatalog);
  }
};

function h63RefreshCatalogFromKnownWorkers() {
  if (!state.h63ModelOptionsPayload) return;
  const next = h63CatalogFromPayload(state.h63ModelOptionsPayload);
  const current = state.h62ModelCatalog || {};
  if (
    next.provider !== current.provider ||
    next.currentModel !== current.currentModel ||
    next.models.join("\n") !== (current.models || []).join("\n")
  ) {
    h63ApplyModelCatalog(next);
  }
}

const h63PreviousLoadSessionData = loadSessionData;
loadSessionData = async function h63LoadSessionData() {
  const result = await h63PreviousLoadSessionData();
  h63RefreshCatalogFromKnownWorkers();
  return result;
};

function h63DecorateLocaleSelect() {
  const selector = $("localeSelect");
  const locales = window.HermesHarnessLocales || {};
  if (!selector) return;
  for (const option of selector.options) {
    const definition = locales[option.value] || {};
    const flag = H63_LOCALE_FLAGS[option.value] || "🌐";
    const label = definition.label || option.value.toUpperCase();
    option.textContent = `${flag} ${label}`;
  }
}

function h63ReadHideCompleted() {
  try {
    const raw = window.localStorage.getItem(H63_HIDE_COMPLETED_KEY);
    return raw === null ? true : raw === "1" || raw === "true";
  } catch (_) {
    return true;
  }
}

function h63WriteHideCompleted(value) {
  try { window.localStorage.setItem(H63_HIDE_COMPLETED_KEY, value ? "1" : "0"); } catch (_) {}
}

function h63InstallDagStyles() {
  if ($("h63DagStyle")) return;
  const style = document.createElement("style");
  style.id = "h63DagStyle";
  style.textContent = `
    .h5-dag-canvas.h63-single-stage{overflow-x:hidden!important;scrollbar-gutter:auto!important;width:100%;max-width:100%}
    .h5-dag-canvas.h63-single-stage .h5-dag-levels{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important}
    .h5-dag-canvas.h63-single-stage .h5-dag-level{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important}
    .h5-dag-canvas.h63-single-stage .h5-dag-level-title{margin-bottom:.75rem}
    .h5-dag-canvas.h63-single-stage .h5-dag-group{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;width:100%!important;min-width:0!important;max-width:none!important}
    .h5-dag-canvas.h63-single-stage .h5-task-node{width:100%;min-width:0;max-width:100%}
    .h5-dag-canvas.h63-single-stage .h5-task-node[hidden]{display:none!important}
    .h63-task-dictation-row{display:flex;align-items:center;justify-content:space-between;gap:.75rem}
    .h63-task-dictation-btn{min-width:40px;flex:0 0 auto}
    .h63-task-dictation-btn.h63-listening{border-color:var(--danger);color:var(--danger)}
  `;
  document.head.appendChild(style);
}

function h63WrapTaskNodeStatus() {
  if (typeof h5TaskNode !== "function" || h5TaskNode.__h63StatusWrapped) return;
  const previous = h5TaskNode;
  h5TaskNode = function h63TaskNodeWithStatus(task, allTasks) {
    const node = previous(task, allTasks);
    node.dataset.h5Status = String(task?.status || "");
    return node;
  };
  h5TaskNode.__h63StatusWrapped = true;
}

function h63InstallTaskHistoryControl() {
  const head = document.querySelector(".tasks-card .card-head");
  if (!head || $("h63CompletedTasksToggle")) return;
  const button = el("button", "ghost", "");
  button.id = "h63CompletedTasksToggle";
  button.type = "button";
  button.addEventListener("click", () => {
    h63WriteHideCompleted(!h63ReadHideCompleted());
    h63NormalizeDag();
  });
  const newTask = $("newTaskBtn");
  head.insertBefore(button, newTask || null);
}

function h63SyncRenderedTaskStatus(canvas) {
  const tasks = new Map((Array.isArray(state.h5Graph?.tasks) ? state.h5Graph.tasks : []).map((task) => [String(task?.task_id || ""), task]));
  for (const node of canvas?.querySelectorAll(".h5-task-node") || []) {
    const task = tasks.get(String(node.dataset.h5TaskId || ""));
    if (task) node.dataset.h5Status = String(task.status || "");
  }
}

function h63UpdateTaskHistoryControl(canvas, singleStage) {
  const button = $("h63CompletedTasksToggle");
  const tasks = Array.isArray(state.h5Graph?.tasks) ? state.h5Graph.tasks : [];
  const completed = tasks.filter((task) => task?.status === "completed").length;
  const hidden = singleStage && completed > 0 && h63ReadHideCompleted();
  canvas?.classList.toggle("h63-hide-completed", hidden);
  for (const node of canvas?.querySelectorAll(".h5-task-node") || []) {
    node.hidden = hidden && node.dataset.h5Status === "completed";
  }
  if (button) {
    button.hidden = !singleStage || completed === 0;
    button.textContent = `${h63TaskText(hidden ? "showDone" : "hideDone")} (${completed})`;
    button.setAttribute("aria-pressed", String(!hidden));
  }
  return hidden;
}

function h63ApplySingleStageColumns(canvas, singleStage) {
  if (!singleStage) return;
  const group = canvas.querySelector(".h5-dag-level .h5-dag-group");
  if (!group) return;
  const visibleTasks = [...group.querySelectorAll(".h5-task-node")].filter((node) => !node.hidden).length;
  const width = Math.max(canvas.clientWidth || 0, canvas.getBoundingClientRect?.().width || 0);
  const responsiveCap = width && width <= 900 ? 1 : (width && width <= 1500 ? 2 : 3);
  const columns = Math.max(1, Math.min(responsiveCap, visibleTasks || 1));
  group.style.setProperty("grid-template-columns", `repeat(${columns},minmax(0,1fr))`, "important");
}

function h63NormalizeDag() {
  const canvas = $("taskList")?.querySelector(".h5-dag-canvas");
  if (!canvas) return;
  const levels = canvas.querySelectorAll(".h5-dag-level");
  const singleStage = levels.length <= 1;
  canvas.classList.toggle("h63-single-stage", singleStage);
  h63SyncRenderedTaskStatus(canvas);
  h63UpdateTaskHistoryControl(canvas, singleStage);
  h63ApplySingleStageColumns(canvas, singleStage);
  if (singleStage || canvas.scrollWidth <= canvas.clientWidth + 1) canvas.scrollLeft = 0;
  requestAnimationFrame(() => {
    if (singleStage) canvas.scrollLeft = 0;
    if (typeof h5DrawEdges === "function") h5DrawEdges();
  });
}

function h63ObserveTaskGraph() {
  const root = $("taskList");
  if (!root || root.__h63Observer) return;
  const observer = new MutationObserver(() => requestAnimationFrame(h63NormalizeDag));
  observer.observe(root, { childList: true, subtree: true });
  root.__h63Observer = observer;
}

function h63InsertText(target, transcript) {
  const clean = String(transcript || "").trim();
  if (!target || !clean) return;
  const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
  const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
  const before = target.value.slice(0, start);
  const after = target.value.slice(end);
  const leftSpace = before && !/\s$/.test(before) ? " " : "";
  const rightSpace = after && !/^\s/.test(after) ? " " : "";
  const inserted = leftSpace + clean + rightSpace;
  target.value = before + inserted + after;
  const cursor = before.length + inserted.length;
  target.setSelectionRange(cursor, cursor);
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function h63TaskSpeechLocale() {
  return ({ en: "en-US", fr: "fr-FR", es: "es-ES", pt: "pt-PT", de: "de-DE", it: "it-IT" })[h63Locale()] || "en-US";
}

function h63SetTaskListening(listening) {
  h63TaskListening = !!listening;
  const button = $("h63TaskDictationBtn");
  if (!button) return;
  button.classList.toggle("h63-listening", h63TaskListening);
  button.textContent = h63TaskListening ? "■" : "🎙";
  const label = h63TaskText(h63TaskListening ? "stop" : "dictate");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(h63TaskListening));
}

function h63InstallTaskDictation() {
  const form = $("taskForm");
  const textarea = form?.querySelector('textarea[name="description"]');
  const label = textarea?.closest("label");
  const title = label?.querySelector("span");
  if (!form || !textarea || !label || !title || $("h63TaskDictationBtn")) return;

  const row = el("div", "h63-task-dictation-row");
  title.replaceWith(row);
  row.append(title);
  const button = el("button", "ghost h63-task-dictation-btn", "🎙");
  button.id = "h63TaskDictationBtn";
  button.type = "button";
  button.title = h63TaskText("dictate");
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", "false");
  row.append(button);

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  if (!SpeechRecognitionCtor) {
    button.disabled = true;
    button.title = h63TaskText("unsupported");
    button.setAttribute("aria-label", button.title);
    return;
  }

  h63TaskRecognition = new SpeechRecognitionCtor();
  h63TaskRecognition.continuous = true;
  h63TaskRecognition.interimResults = false;
  h63TaskRecognition.lang = h63TaskSpeechLocale();
  h63TaskRecognition.onstart = () => {
    h63SetTaskListening(true);
    if (typeof showToast === "function") showToast(h63TaskText("listening"));
  };
  h63TaskRecognition.onresult = (event) => {
    const chunks = [];
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal && event.results[i][0]?.transcript) chunks.push(event.results[i][0].transcript);
    }
    if (chunks.length) h63InsertText(textarea, chunks.join(" "));
  };
  h63TaskRecognition.onerror = (event) => {
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      if (typeof showToast === "function") showToast(h63TaskText("denied"), true);
    } else if (event.error !== "aborted" && typeof showToast === "function") {
      showToast(`${h63TaskText("dictate")}: ${event.error || "error"}`, true);
    }
  };
  h63TaskRecognition.onend = () => h63SetTaskListening(false);

  button.addEventListener("click", () => {
    if (h63TaskListening) return h63TaskRecognition.stop();
    h63TaskRecognition.lang = h63TaskSpeechLocale();
    try { h63TaskRecognition.start(); }
    catch (error) { if (typeof showToast === "function") showToast(`${h63TaskText("dictate")}: ${error.message}`, true); }
  });

  $("taskDialog")?.addEventListener("close", () => {
    if (h63TaskListening && h63TaskRecognition) h63TaskRecognition.stop();
  });
}

function h63EnsureOperatorUx() {
  // Recovery normally loads the operator layer after Models. If the deployed
  // package is stale or that dynamic chain is interrupted, the absence is very
  // visible (no Focus/session rename/message mic and duplicated activation
  // summaries). Use the already-established H6.3 asset as a one-shot watchdog.
  window.setTimeout(() => {
    if (typeof ouxInit === "function") return;
    if (document.querySelector('script[data-h63-operator-fallback="1"]')) return;
    const script = document.createElement("script");
    script.src = "/harness-operator-ux.js";
    script.dataset.h63OperatorFallback = "1";
    script.addEventListener("error", () => console.error("Hermes Harness operator UX asset failed to load"));
    document.head.appendChild(script);
  }, 1000);
}

function h63RefreshTaskLocale() {
  h63NormalizeDag();
  const button = $("h63TaskDictationBtn");
  if (button) {
    const label = button.disabled ? h63TaskText("unsupported") : h63TaskText(h63TaskListening ? "stop" : "dictate");
    button.title = label;
    button.setAttribute("aria-label", label);
  }
}

function h63Init() {
  h63DecorateLocaleSelect();
  h63InstallDagStyles();
  h63WrapTaskNodeStatus();
  h63InstallTaskHistoryControl();
  h63InstallTaskDictation();
  h63ObserveTaskGraph();
  h63NormalizeDag();
  h63EnsureOperatorUx();
  window.addEventListener("resize", () => requestAnimationFrame(h63NormalizeDag));
  window.addEventListener("hermes-harness-ui-change", (event) => {
    if (event.detail?.kind === "locale") {
      h63DecorateLocaleSelect();
      h63RefreshTaskLocale();
    }
    if (["locale", "layout"].includes(event.detail?.kind)) requestAnimationFrame(h63NormalizeDag);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", h63Init, { once: true });
else h63Init();