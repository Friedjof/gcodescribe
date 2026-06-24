from __future__ import annotations

import os

from fastapi import HTTPException, Request, Response

from ..services.auth import AuthService, session_ttl_seconds

SESSION_COOKIE = "gcodescribe_session"


def auth_bypass_enabled() -> bool:
    # Desktop (Flatpak) runs locally for a single user — no login needed.
    if os.environ.get("GCODESCRIBE_PACKAGING", "").lower() == "flatpak":
        return True
    for name in ("PLOTTER_AUTH_DEV_BYPASS", "PLOTTER_AUTH_TEST_BYPASS"):
        if os.environ.get(name, "").lower() in ("1", "true", "yes"):
            return True
    return False


def bypass_session() -> dict:
    return {"username": "dev", "expires": 0}


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
    if auth_bypass_enabled():
        return bypass_session()
    session = AuthService().validate_session(session_token(request))
    if session is None:
        raise HTTPException(status_code=401, detail="Login erforderlich.")
    return session


def optional_admin(request: Request) -> dict | None:
    """Like ``require_admin`` but returns ``None`` instead of raising when there
    is no valid admin session. For endpoints that stay public yet behave
    differently for a logged-in admin (e.g. tagging gallery uploads)."""
    if auth_bypass_enabled():
        return bypass_session()
    return AuthService().validate_session(session_token(request))
