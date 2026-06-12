from __future__ import annotations

import os

from fastapi import HTTPException, Request, Response

from ..services.auth import AuthService, session_ttl_seconds

SESSION_COOKIE = "gcodescribe_session"


def cookie_secure() -> bool:
    value = os.environ.get("PLOTTER_AUTH_COOKIE_SECURE", "false").lower()
    return value in ("1", "true", "yes", "on")


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=session_ttl_seconds(),
        httponly=True,
        secure=cookie_secure(),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def session_token(request: Request) -> str | None:
    return request.cookies.get(SESSION_COOKIE)


def require_admin(request: Request) -> dict:
    if os.environ.get("PLOTTER_AUTH_TEST_BYPASS", "").lower() in ("1", "true", "yes"):
        return {"username": "test", "expires": 0}
    session = AuthService().validate_session(session_token(request))
    if session is None:
        raise HTTPException(status_code=401, detail="Login erforderlich.")
    return session
