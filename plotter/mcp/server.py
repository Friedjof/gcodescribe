"""FastAPI endpoint for the MCP (Model Context Protocol) JSON-RPC transport.

The tool surface lives in :mod:`plotter.mcp.schemas` (public schemas),
:mod:`plotter.mcp.handlers` (implementations) and :mod:`plotter.mcp.rpc`
(JSON-RPC plumbing); this module only wires HTTP to the dispatcher.
"""

from __future__ import annotations

import ipaddress
import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from plotter.mcp.rpc import error_response, handle_message, require_mcp_enabled
from plotter.mcp.schemas import TOOLS

router = APIRouter(tags=["mcp"])


def require_desktop_loopback(request: Request) -> None:
    if os.environ.get("GCODESCRIBE_PACKAGING", "").lower() != "flatpak":
        return
    host = request.client.host if request.client else ""
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = False
    if not local:
        raise HTTPException(403, "Desktop MCP accepts loopback connections only.")
    origin = request.headers.get("origin")
    if origin and (urlsplit(origin).scheme, urlsplit(origin).netloc) != (
        request.url.scheme, request.url.netloc
    ):
        raise HTTPException(403, "Invalid MCP origin.")


@router.post("/mcp")
async def mcp_rpc(request: Request, authorization: str | None = Header(default=None)) -> Response:
    require_desktop_loopback(request)
    require_mcp_enabled(authorization)
    payload = await request.json()

    if isinstance(payload, list):
        responses = []
        for item in payload:
            if not isinstance(item, dict):
                responses.append(error_response(None, -32600, "Invalid Request"))
                continue
            response = handle_message(item)
            if response is not None:
                responses.append(response)
        if not responses:
            return Response(status_code=202)
        return JSONResponse(responses)

    if not isinstance(payload, dict):
        return JSONResponse(error_response(None, -32600, "Invalid Request"), status_code=400)
    response = handle_message(payload)
    if response is None:
        return Response(status_code=202)
    return JSONResponse(response)


@router.get("/mcp")
def mcp_get(request: Request, authorization: str | None = Header(default=None)) -> dict:
    require_desktop_loopback(request)
    require_mcp_enabled(authorization)
    if "text/event-stream" in request.headers.get("accept", ""):
        raise HTTPException(405, "SSE is not provided; use stateless JSON POST requests.")
    return {"ok": True, "transport": "json-rpc", "tools": len(TOOLS)}
