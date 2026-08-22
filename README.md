# Hermes Harness

Standalone control plane and UI for Hermes Durable Workers.

Hermes Harness is a lightweight operator/observability interface for
[Hermes Agent](https://github.com/edoumo/hermes-agent) Durable Workers.
It talks to the canonical Hermes API through a strict server-side BFF
(browser → BFF → Hermes Agent). It does **not** require Hermes WebUI.

## Architecture

```
~/.hermes/config.yaml + ~/.hermes/.env
                ↓
          Hermes Agent / CLI
                ↓
           Hermes API
                ↓
          Hermes Harness (this repo)
```

Hermes Agent remains the source of truth for configuration, providers,
credentials, model catalog, sessions, messages, durable workers,
activations and tasks. Hermes Harness is only a control plane and
observability surface.

## Requirements

- Python >= 3.11
- A running Hermes Agent API server (the canonical gateway exposes
  `/api/sessions`, `/api/model/options`, durable-worker routes, …)

## Installation

```bash
pip install .
# or, for development:
pip install -e .[test]
```

The `hermes-webui` package is **not** required and must not be present
in `PYTHONPATH`.

## Usage

```bash
hermes-harness
```

Configuration is done through environment variables (all optional unless
noted):

| Variable | Default | Meaning |
|---|---|---|
| `HERMES_HARNESS_HOST` | `127.0.0.1` | Bind host (loopback by default) |
| `HERMES_HARNESS_PORT` | `8790` | Bind port |
| `HERMES_HARNESS_PASSWORD` | — | Required for non-loopback binds (and recommended always) |
| `HERMES_HARNESS_ALLOW_REMOTE` | — | Set to `1` to allow a non-loopback bind (requires password) |
| `HERMES_HARNESS_STATE_DIR` | `~/.hermes/harness` | Auth/session state directory |
| `HERMES_HARNESS_GATEWAY_BASE_URL` | `http://127.0.0.1:8642` | Hermes Agent API origin |
| `HERMES_HARNESS_GATEWAY_API_KEY` | — | Hermes API key (server-side only, never sent to the browser) |
| `HERMES_HARNESS_SECURE_COOKIE` | — | Set to `1` for `Secure` cookies (HTTPS deployments) |
| `HERMES_HARNESS_ACCESS_LOG` | — | Set to `1` to log access |

Open http://127.0.0.1:8790/harness in a browser.

## Provenance

This repository was extracted from `edoumo/hermes-webui` at commit
`1e9896b7e607dece13b8cc4cd514c3b8e1b36bfd` (branch
`experimental/hermes-harness-standalone-models`). The Harness components
(`harness_server.py`, `harness_runtime/`, `api/harness_ui_operations.py`,
`api/harness_ui_tasks.py`, `api/harness_ui_task_recovery.py`, and the
`static/harness*` assets) were relocated into the standalone
`hermes_harness/` package, with imports and asset paths adapted. The
`hermes-webui` tree was not copied wholesale and no WebUI runtime module
is imported by this package.

License: MIT (see `LICENSE`).
