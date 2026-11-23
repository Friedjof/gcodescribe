"""JSON-RPC plumbing for the MCP endpoint: auth gate, message dispatch and the
tool-call envelope."""

from __future__ import annotations

import json
import secrets
from importlib.metadata import version
from typing import Any

from fastapi import HTTPException

from plotter.core.config import load_settings
from plotter.core.events import hub
from plotter.mcp.args import ToolPayloadError
from plotter.mcp.handlers import MUTATING_TOOLS, TOOL_HANDLERS
from plotter.mcp.schemas import TOOLS
from plotter.services.settings_store import load_saved

JSONRPC_VERSION = "2.0"
MCP_PROTOCOL_VERSION = "2024-11-05"


def _settings():
    return load_settings(load_saved())


def require_mcp_enabled(authorization: str | None) -> None:
    cfg = _settings().mcp
    if not cfg.enabled:
        raise HTTPException(status_code=404, detail="MCP is disabled.")
    if not cfg.token:
        raise HTTPException(status_code=401, detail="MCP token is not configured.")

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(token, cfg.token):
        raise HTTPException(status_code=401, detail="Invalid MCP token.")


def error_response(request_id: Any, code: int, message: str) -> dict:
    return {
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _result(request_id: Any, result: dict) -> dict:
    return {"jsonrpc": JSONRPC_VERSION, "id": request_id, "result": result}


def _initialize_result() -> dict:
    return {
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "gcodescribe", "version": version("gcodescribe")},
    }


def _json_content(data: Any, *, is_error: bool = False) -> dict:
    return {
        "content": [
            {"type": "text", "text": json.dumps(data, ensure_ascii=False, indent=2, default=str)}
        ],
        "isError": is_error,
    }


def _tools_call(params: Any) -> dict:
    if not isinstance(params, dict):
        raise ValueError("tools/call params must be an object")
    name = params.get("name")
    if not isinstance(name, str) or name not in TOOL_HANDLERS:
        raise ValueError(f"unknown tool: {name}")
    args = params.get("arguments") or {}
    if not isinstance(args, dict):
        raise ValueError("tool arguments must be an object")
    try:
        content = _json_content(TOOL_HANDLERS[name](args))
    except ToolPayloadError as exc:
        content = _json_content(exc.payload, is_error=True)
    except Exception as exc:
        content = _json_content({"error": str(exc)}, is_error=True)
    # Let the UI surface which MCP tool ran (and whether it succeeded) live.
    # `changed` tells the open designer to also refresh the active page canvas,
    # not just the page list, so an agent's drawing appears immediately.
    ok = not content.get("isError", False)
    hub.publish("mcp", tool=name, ok=ok, changed=ok and name in MUTATING_TOOLS)
    return content


def handle_message(message: dict) -> dict | None:
    request_id = message.get("id")
    method = message.get("method")

    if not isinstance(method, str):
        return error_response(request_id, -32600, "Invalid Request")

    if request_id is None:
        # JSON-RPC notification: acknowledge by returning no response body.
        return None
    if method == "initialize":
        return _result(request_id, _initialize_result())
    if method == "ping":
        return _result(request_id, {})
    if method == "tools/list":
        return _result(request_id, {"tools": TOOLS})
    if method == "tools/call":
        try:
            return _result(request_id, _tools_call(message.get("params")))
        except ValueError as exc:
            return error_response(request_id, -32602, str(exc))
    return error_response(request_id, -32601, f"Method not found: {method}")
