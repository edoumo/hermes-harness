"use strict";

// Reliable dictation bridge for Harness.
//
// Browser SpeechRecognition is vendor-dependent and can fail with a generic
// `network` error even when microphone permission is granted. Harness instead
// records a short audio clip locally with MediaRecorder and sends it through
// the authenticated same-origin BFF to Hermes' canonical /api/audio/transcribe
// endpoint. Hermes remains the owner of STT provider/configuration.
//
// The BFF's normal JSON body cap is intentionally kept small. Recordings are
// therefore bounded and may be dictated in several consecutive chunks; every
// transcript is appended to the current field and never auto-submitted.

const HD_MAX_RECORDING_MS = 40000;
const HD_MAX_DATA_URL_BYTES = 240 * 1024;

const HD_TEXT = Object.freeze({
  en: {
    message: "Dictate message",
    task: "Dictate task description",
    stop: "Stop recording",
    listening: "Recording… click the microphone again to stop.",
    transcribing: "Transcribing…",
    inserted: "Dictation inserted.",
    insecure: "Microphone recording requires HTTPS or localhost.",
    unsupported: "Audio recording is not supported by this browser.",
    denied: "Microphone access was refused or is unavailable.",
    tooLong: "Recording is too large. Dictate in shorter chunks.",
    noSpeech: "No speech was detected.",
    failed: "Audio transcription failed",
    busy: "Another dictation is already recording.",
  },
  fr: {
    message: "Dicter le message",
    task: "Dicter la description de la tâche",
    stop: "Arrêter l’enregistrement",
    listening: "Enregistrement… recliquez sur le micro pour arrêter.",
    transcribing: "Transcription…",
    inserted: "Dictée insérée.",
    insecure: "L’enregistrement micro nécessite HTTPS ou localhost.",
    unsupported: "L’enregistrement audio n’est pas pris en charge par ce navigateur.",
    denied: "L’accès au microphone a été refusé ou est indisponible.",
    tooLong: "L’enregistrement est trop volumineux. Dictez en plusieurs morceaux plus courts.",
    noSpeech: "Aucune parole n’a été détectée.",
    failed: "Échec de la transcription audio",
    busy: "Une autre dictée est déjà en cours.",
  },
  es: {
    message: "Dictar mensaje",
    task: "Dictar la descripción de la tarea",
    stop: "Detener grabación",
    listening: "Grabando… vuelve a pulsar el micrófono para detener.",
    transcribing: "Transcribiendo…",
    inserted: "Dictado insertado.",
    insecure: "La grabación del micrófono requiere HTTPS o localhost.",
    unsupported: "Este navegador no admite la grabación de audio.",
    denied: "El acceso al micrófono fue rechazado o no está disponible.",
    tooLong: "La grabación es demasiado grande. Dicta en fragmentos más cortos.",
    noSpeech: "No se detectó voz.",
    failed: "Error de transcripción de audio",
    busy: "Ya hay otro dictado en curso.",
  },
  pt: {
    message: "Ditar mensagem",
    task: "Ditar a descrição da tarefa",
    stop: "Parar gravação",
    listening: "A gravar… clique novamente no microfone para parar.",
    transcribing: "A transcrever…",
    inserted: "Ditado inserido.",
    insecure: "A gravação do microfone requer HTTPS ou localhost.",
    unsupported: "A gravação de áudio não é suportada por este navegador.",
    denied: "O acesso ao microfone foi recusado ou está indisponível.",
    tooLong: "A gravação é demasiado grande. Dite em partes mais curtas.",
    noSpeech: "Não foi detetada fala.",
    failed: "Falha na transcrição de áudio",
    busy: "Já existe outro ditado em curso.",
  },
  de: {
    message: "Nachricht diktieren",
    task: "Aufgabenbeschreibung diktieren",
    stop: "Aufnahme stoppen",
    listening: "Aufnahme läuft… Mikrofon erneut anklicken zum Stoppen.",
    transcribing: "Transkription…",
    inserted: "Diktat eingefügt.",
    insecure: "Mikrofonaufnahme erfordert HTTPS oder localhost.",
    unsupported: "Audioaufnahme wird von diesem Browser nicht unterstützt.",
    denied: "Mikrofonzugriff wurde verweigert oder ist nicht verfügbar.",
    tooLong: "Die Aufnahme ist zu groß. Bitte in kürzeren Abschnitten diktieren.",
    noSpeech: "Keine Sprache erkannt.",
    failed: "Audiotranskription fehlgeschlagen",
    busy: "Ein anderes Diktat läuft bereits.",
  },
  it: {
    message: "Detta messaggio",
    task: "Detta la descrizione dell’attività",
    stop: "Interrompi registrazione",
    listening: "Registrazione… premi di nuovo il microfono per fermare.",
    transcribing: "Trascrizione…",
    inserted: "Dettatura inserita.",
    insecure: "La registrazione microfono richiede HTTPS o localhost.",
    unsupported: "La registrazione audio non è supportata da questo browser.",
    denied: "L’accesso al microfono è stato rifiutato o non è disponibile.",
    tooLong: "La registrazione è troppo grande. Detta in segmenti più brevi.",
    noSpeech: "Nessun parlato rilevato.",
    failed: "Trascrizione audio non riuscita",
    busy: "È già in corso un’altra dettatura.",
  },
});

const hdState = {
  recorder: null,
  stream: null,
  chunks: [],
  button: null,
  target: null,
  timer: null,
  kind: "message",
};

function hdLocale() {
  const raw = typeof ui?.locale === "function" ? ui.locale() : "en";
  return HD_TEXT[raw] ? raw : "en";
}

function hdText(key) {
  return HD_TEXT[hdLocale()]?.[key] || HD_TEXT.en[key] || key;
}

function hdToast(message, error = false) {
  if (typeof showToast === "function") showToast(message, error);
}

function hdCanRecord() {
  return !!(
    window.isSecureContext &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window.MediaRecorder === "function"
  );
}

function hdPreferredMimeType() {
  const supported = typeof MediaRecorder?.isTypeSupported === "function"
    ? MediaRecorder.isTypeSupported.bind(MediaRecorder)
    : () => false;
  for (const value of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ]) {
    if (supported(value)) return value;
  }
  return "";
}

function hdInsertText(target, transcript) {
  const clean = String(transcript || "").trim();
  if (!target || !clean) return false;
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
  return true;
}

function hdButtonLabel(button, kind, recording = false) {
  if (!button) return;
  const label = hdText(recording ? "stop" : kind);
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(recording));
  button.textContent = recording ? "■" : "🎙";
  button.classList.toggle("oux-listening", recording);
  button.classList.toggle("h63-listening", recording);
}

function hdResetActive() {
  if (hdState.timer) window.clearTimeout(hdState.timer);
  hdState.timer = null;
  if (hdState.stream) {
    for (const track of hdState.stream.getTracks()) track.stop();
  }
  hdButtonLabel(hdState.button, hdState.kind, false);
  hdState.recorder = null;
  hdState.stream = null;
  hdState.chunks = [];
  hdState.button = null;
  hdState.target = null;
}

function hdBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

async function hdTranscribe(blob, target) {
  hdToast(hdText("transcribing"));
  const dataUrl = await hdBlobAsDataUrl(blob);
  if (!dataUrl || dataUrl.length > HD_MAX_DATA_URL_BYTES) {
    hdToast(hdText("tooLong"), true);
    return;
  }
  const response = await api("/api/harness/audio-transcribe", {
    method: "POST",
    body: {
      data_url: dataUrl,
      mime_type: blob.type || "audio/webm",
    },
  });
  const transcript = String(response?.transcript || "").trim();
  if (!transcript) {
    hdToast(hdText("noSpeech"));
    return;
  }
  if (hdInsertText(target, transcript)) hdToast(hdText("inserted"));
}

async function hdFinishRecording() {
  const target = hdState.target;
  const type = hdState.recorder?.mimeType || hdPreferredMimeType() || "audio/webm";
  const blob = new Blob(hdState.chunks, { type });
  hdResetActive();
  if (!blob.size) {
    hdToast(hdText("noSpeech"));
    return;
  }
  try {
    await hdTranscribe(blob, target);
  } catch (error) {
    hdToast(`${hdText("failed")}: ${error?.message || "error"}`, true);
  }
}

function hdStopRecording() {
  if (!hdState.recorder) return;
  if (hdState.recorder.state !== "inactive") hdState.recorder.stop();
}

async function hdStartRecording(button, target, kind) {
  if (hdState.recorder) {
    if (hdState.button === button) hdStopRecording();
    else hdToast(hdText("busy"), true);
    return;
  }
  if (!window.isSecureContext) {
    hdToast(hdText("insecure"), true);
    return;
  }
  if (!hdCanRecord()) {
    hdToast(hdText("unsupported"), true);
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    hdToast(hdText("denied"), true);
    return;
  }

  const mimeType = hdPreferredMimeType();
  let recorder;
  try {
    const options = { audioBitsPerSecond: 32000 };
    if (mimeType) options.mimeType = mimeType;
    recorder = new MediaRecorder(stream, options);
  } catch (_) {
    try { recorder = new MediaRecorder(stream); }
    catch (_) {
      for (const track of stream.getTracks()) track.stop();
      hdToast(hdText("unsupported"), true);
      return;
    }
  }

  hdState.recorder = recorder;
  hdState.stream = stream;
  hdState.chunks = [];
  hdState.button = button;
  hdState.target = target;
  hdState.kind = kind;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) hdState.chunks.push(event.data);
  };
  recorder.onerror = () => {
    hdToast(hdText("failed"), true);
    hdResetActive();
  };
  recorder.onstop = () => { hdFinishRecording(); };

  hdButtonLabel(button, kind, true);
  hdToast(hdText("listening"));
  recorder.start(1000);
  hdState.timer = window.setTimeout(hdStopRecording, HD_MAX_RECORDING_MS);
}

function hdReplaceButton(id, targetResolver, kind) {
  const current = document.getElementById(id);
  if (!current || current.dataset.hdDictation === "hermes") return;

  // Clone removes the legacy SpeechRecognition listeners while preserving the
  // existing styling/placement from the operator/task UX layers.
  const button = current.cloneNode(true);
  button.dataset.hdDictation = "hermes";
  button.disabled = false;
  hdButtonLabel(button, kind, false);
  current.replaceWith(button);

  button.addEventListener("click", () => {
    const target = targetResolver();
    if (!target) return;
    hdStartRecording(button, target, kind);
  });
}

function hdInstall() {
  hdReplaceButton("ouxDictationBtn", () => document.getElementById("messageInput"), "message");
  hdReplaceButton(
    "h63TaskDictationBtn",
    () => document.getElementById("taskForm")?.querySelector('textarea[name="description"]'),
    "task",
  );
}

function hdRefreshLabels() {
  const message = document.getElementById("ouxDictationBtn");
  const task = document.getElementById("h63TaskDictationBtn");
  if (message?.dataset.hdDictation === "hermes" && hdState.button !== message) hdButtonLabel(message, "message", false);
  if (task?.dataset.hdDictation === "hermes" && hdState.button !== task) hdButtonLabel(task, "task", false);
}

function hdInit() {
  hdInstall();
  const root = document.body;
  if (root && !root.__hdDictationObserver) {
    const observer = new MutationObserver(() => hdInstall());
    observer.observe(root, { childList: true, subtree: true });
    root.__hdDictationObserver = observer;
  }
  window.addEventListener("hermes-harness-ui-change", (event) => {
    if (event.detail?.kind === "locale") hdRefreshLabels();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hdInit, { once: true });
else hdInit();