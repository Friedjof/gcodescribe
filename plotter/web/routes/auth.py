from __future__ import annotations

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from ...services.auth import AuthService
from ..auth import auth_bypass_enabled, clear_session_cookie, session_token, set_session_cookie

router = APIRouter(tags=["auth"])


class SetupStartRequest(BaseModel):
    username: str
    password: str


class SetupFinishRequest(BaseModel):
    setupId: str
    code: str


class LoginRequest(BaseModel):
    username: str
    password: str
    totpCode: str = ""
    recoveryCode: str = ""


@router.get("/auth/session")
def auth_session(request: Request) -> dict:
    if auth_bypass_enabled():
        return {"configured": True, "authenticated": True, "username": "dev"}
    return AuthService().status(session_token(request))


@router.post("/auth/setup/start")
def setup_start(req: SetupStartRequest) -> dict:
    return AuthService().start_setup(req.username, req.password)


@router.post("/auth/setup/finish")
def setup_finish(req: SetupFinishRequest, response: Response) -> dict:
    result = AuthService().finish_setup(req.setupId, req.code)
    set_session_cookie(response, result.pop("token"))
    return result


@router.post("/auth/login")
def login(req: LoginRequest, response: Response) -> dict:
    result = AuthService().login(
        req.username,
        req.password,
        totp_code=req.totpCode,
        recovery_code=req.recoveryCode,
    )
    set_session_cookie(response, result.pop("token"))
    return result


@router.post("/auth/logout")
def logout(request: Request, response: Response) -> dict:
    AuthService().logout(session_token(request))
    clear_session_cookie(response)
    return {"ok": True}
