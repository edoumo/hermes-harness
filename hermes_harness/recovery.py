"""H5 recovery plus H6.1/H6.2/H6.3 human-UAT polish extensions for Harness."""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from hermes_harness import bff as foundation
from hermes_harness import operations
from hermes_harness import tasks
from hermes_harness.http import j

_SAFE_ID = r"[A-Za-z0-9._:-]{1,256}"

_RECOVERY_ROUTE = (
    "POST",
    re.compile(rf"^/sessions/(?P<session_id>{_SAFE_ID})/worker-tasks/(?P<task_id>{_SAFE_ID})/recover$"),
    "/api/sessions/{session_id}/worker-tasks/{task_id}/recover",
)

_H61_WORKER_ROUTES: tuple[tuple[str, re.Pattern[str], str], ...] = (
    ("POST", re.compile(rf"^/sessions/(?P<session_id>{_SAFE_ID})/workers/(?P<worker_id>{_SAFE_ID})/edit$"), "/api/sessions/{session_id}/workers/{worker_id}/edit"),
    ("POST", re.compile(rf"^/sessions/(?P<session_id>{_SAFE_ID})/workers/(?P<worker_id>{_SAFE_ID})/archive$"), "/api/sessions/{session_id}/workers/{worker_id}/archive"),
    ("POST", re.compile(rf"^/sessions/(?P<session_id>{_SAFE_ID})/workers/(?P<worker_id>{_SAFE_ID})/restore$"), "/api/sessions/{session_id}/workers/{worker_id}/restore"),
)

# Hermes owns the model inventory and assignment persistence. Harness only
# exposes these existing contracts through the authenticated BFF.
_H62_ROUTES: tuple[tuple[str, re.Pattern[str], str], ...] = (
    ("GET", re.compile(r"^/model-options$"), "/api/model/options"),
    ("GET", re.compile(r"^/model-auxiliary$"), "/api/model/auxiliary"),
    ("POST", re.compile(r"^/model-set$"), "/api/model/set"),
)

_H5_RECOVERY_BOOT = """s.onload=function(){
      var h4=document.createElement('script');
      h4.src='/harness-operations.js';
      h4.onload=function(){
        var h5=document.createElement('script');
        h5.src='/harness-tasks.js';
        h5.onload=function(){
          var h5r=document.createElement('script');
          h5r.src='/harness-task-recovery.js';
          h5r.onload=function(){
            var h62=document.createElement('script');
            h62.src='/harness-polish2.js';
            h62.onload=function(){
              var h63=document.createElement('script');
              h63.src='/harness-polish3.js';
              h63.onload=function(){
                var hm=document.createElement('script');
                hm.src='/harness-models.js';
                hm.onload=function(){
                  var houx=document.createElement('script');
                  houx.src='/harness-operator-ux.js';
                  houx.onload=function(){
                    if(document.readyState!=='loading')document.dispatchEvent(new Event('DOMContentLoaded'));
                  };
                  document.head.appendChild(houx);
                };
                document.head.appendChild(hm);
              };
              document.head.appendChild(h63);
            };
            document.head.appendChild(h62);
          };
          document.head.appendChild(h5r);
        };
        document.head.appendChild(h5);
      };
      document.head.appendChild(h4);
    };"""


def resolve_upstream(method: str, browser_path: str) -> Optional[str]:
    method = str(method or "").upper()
    prefix = "/api/harness"
    if browser_path.startswith(prefix):
        suffix = browser_path[len(prefix):] or "/"
        if method == _RECOVERY_ROUTE[0]:
            match = _RECOVERY_ROUTE[1].fullmatch(suffix)
            if match:
                return _RECOVERY_ROUTE[2].format(**match.groupdict())
        for route_method, pattern, template in _H61_WORKER_ROUTES + _H62_ROUTES:
            if route_method != method:
                continue
            match = pattern.fullmatch(suffix)
            if match:
                return template.format(**match.groupdict())
    return tasks.resolve_upstream(method, browser_path)


def _proxy_session_rename(handler, parsed) -> bool:
    """Expose a rename-only adapter to Hermes' broader session PATCH model.

    Current Hermes owns session metadata at ``PATCH /api/sessions/{id}``. The
    upstream SessionRename body can also archive/pin/mark read, but Harness
    deliberately forwards only ``title`` so this discoverable rename action
    cannot smuggle lifecycle mutations.
    """
    if parsed.query:
        j(handler, {"error": "Session rename does not accept query parameters"}, status=400)
        return True
    try:
        raw = foundation._read_json_body(handler)
        payload = json.loads(raw.decode("utf-8"))
    except foundation.HarnessConfigError as exc:
        j(handler, {"error": str(exc)}, status=400)
        return True

    if set(payload) - {"session_id", "title"}:
        j(handler, {"error": "Session rename accepts only session_id and title"}, status=400)
        return True
    session_id = payload.get("session_id")
    title = payload.get("title")
    if not isinstance(session_id, str) or re.fullmatch(_SAFE_ID, session_id) is None:
        j(handler, {"error": "Invalid session_id"}, status=400)
        return True
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 160:
        j(handler, {"error": "Session title must contain 1 to 160 characters"}, status=400)
        return True

    body = json.dumps(
        {"title": title.strip()},
        separators=(",", ":"),
    ).encode("utf-8")
    try:
        request = urllib.request.Request(
            f"{foundation._gateway_base_url()}/api/sessions/{session_id}",
            data=body,
            headers={
                "Authorization": "Bearer " + foundation._gateway_api_key(),
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "Hermes-Harness/0.2",
            },
            method="PATCH",
        )
        try:
            response = foundation._OPENER.open(request, timeout=foundation._NORMAL_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as exc:
            data = foundation._read_bounded_response(exc)
            foundation._send_bytes(handler, exc.code, data, exc.headers)
            return True
        with response:
            data = foundation._read_bounded_response(response)
            foundation._send_bytes(handler, response.status, data, response.headers)
            return True
    except foundation.HarnessConfigError as exc:
        j(handler, {"error": str(exc), "code": "harness_configuration"}, status=503)
        return True
    except (urllib.error.URLError, TimeoutError, OSError):
        j(handler, {"error": "Hermes API is unavailable", "code": "harness_upstream_unavailable"}, status=502)
        return True


def handle_harness_request(handler, parsed, *, method: str) -> bool:
    if not foundation.harness_enabled():
        return False
    if method == "POST" and parsed.path == "/api/harness/session-rename":
        return _proxy_session_rename(handler, parsed)
    upstream = resolve_upstream(method, parsed.path)
    inherited = tasks.resolve_upstream(method, parsed.path)
    if upstream is None:
        return False
    if upstream != inherited:
        proxy_parsed = parsed
        proxy_upstream = upstream
        if parsed.query:
            # Explicitly permit only the model picker refresh hint.
            if method == "GET" and parsed.path == "/api/harness/model-options" and parsed.query == "refresh=true":
                proxy_parsed = parsed._replace(query="")
                proxy_upstream = upstream + "?refresh=true"
            else:
                j(handler, {"error": "Harness operator/catalog routes do not accept query parameters"}, status=400)
                return True
        return foundation._proxy_json(handler, proxy_parsed, method=method, upstream_path=proxy_upstream)
    return tasks.handle_harness_request(handler, parsed, method=method)


def _serve_recovery_html(handler) -> bool:
    target = Path(__file__).resolve().parent / "static" / "harness.html"
    if not target.is_file():
        j(handler, {"error": "Harness asset missing"}, status=500)
        return True
    html = target.read_text(encoding="utf-8")
    if operations._H3_BOOT not in html:
        j(handler, {"error": "Harness H3 bootstrap contract changed"}, status=500)
        return True
    data = html.replace(operations._H3_BOOT, _H5_RECOVERY_BOOT, 1).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)
    return True


def _serve_js_asset(handler, filename: str) -> bool:
    target = Path(__file__).resolve().parent / "static" / filename
    if not target.is_file():
        j(handler, {"error": "Harness asset missing"}, status=500)
        return True
    data = target.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", "application/javascript; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)
    return True


def serve_harness_asset(handler, path: str) -> bool:
    if path in {"/harness", "/harness/"}:
        return _serve_recovery_html(handler)
    assets = {
        "/harness-task-recovery.js": "harness-task-recovery.js",
        "/harness-preferences.js": "harness-preferences.js",
        "/harness-locales.js": "harness-locales.js",
        "/harness-polish2.js": "harness-polish2.js",
        "/harness-polish3.js": "harness-polish3.js",
        "/harness-models.js": "harness-models.js",
        "/harness-operator-ux.js": "harness-operator-ux.js",
    }
    if path in assets:
        return _serve_js_asset(handler, assets[path])
    return tasks.serve_harness_asset(handler, path)


harness_enabled = foundation.harness_enabled

__all__ = ["handle_harness_request", "harness_enabled", "resolve_upstream", "serve_harness_asset"]