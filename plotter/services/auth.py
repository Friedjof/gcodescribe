from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
from pathlib import Path

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from ..calibration import data_dir
from ..state import create_store
from .errors import ServiceError


class AuthError(ServiceError):
    status_code = 401


class AuthConflict(ServiceError):
    status_code = 409


class AuthNotConfigured(ServiceError):
    status_code = 503


_lock = threading.RLock()
_hasher = PasswordHasher()
_store = None


def _atomic_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(path)


def _now() -> float:
    return time.time()


def _state():
    global _store
    if _store is None:
        _store = create_store()
    return _store


def _key(prefix: str, token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"auth_{prefix}_{digest}"


def _recovery_hash(code: str) -> str:
    normalized = code.strip().upper().replace(" ", "")
    return "sha256:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _new_recovery_codes(count: int = 8) -> list[str]:
    return [secrets.token_hex(4).upper() for _ in range(count)]


class AuthService:
    """Single-admin username/password/TOTP auth store."""

    SETUP_TTL_SECONDS = 15 * 60

    def __init__(self, root: Path | None = None):
        self.root = root or (data_dir() / "auth")
        self.path = self.root / "admin.json"

    def configured(self) -> bool:
        return self.path.exists()

    def status(self, token: str | None = None) -> dict:
        session = self.validate_session(token) if token else None
        admin = self._read_admin() if self.configured() else None
        return {
            "configured": self.configured(),
            "authenticated": session is not None,
            "username": admin.get("username") if admin else None,
        }

    def start_setup(self, username: str, password: str) -> dict:
        username = username.strip()
        if self.configured():
            raise AuthConflict("Admin ist bereits eingerichtet.")
        if not username:
            raise AuthError("Benutzername fehlt.")
        if len(password) < 10:
            raise AuthError("Passwort muss mindestens 10 Zeichen lang sein.")
        secret = pyotp.random_base32()
        setup_id = secrets.token_urlsafe(32)
        payload = {
            "username": username,
            "password_hash": _hasher.hash(password),
            "totp_secret": secret,
            "created": _now(),
            "expires": _now() + self.SETUP_TTL_SECONDS,
        }
        _state().set(_key("setup", setup_id), payload)
        return {
            "setupId": setup_id,
            "totpSecret": secret,
            "otpauthUri": self._totp_uri(username, secret),
        }

    def finish_setup(self, setup_id: str, code: str) -> dict:
        if self.configured():
            raise AuthConflict("Admin ist bereits eingerichtet.")
        pending = _state().get(_key("setup", setup_id)) if setup_id else None
        if not pending or pending.get("expires", 0) < _now():
            raise AuthError("Setup ist abgelaufen. Bitte neu starten.")
        if not self._verify_totp(pending["totp_secret"], code):
            raise AuthError("TOTP-Code ist ungültig.")
        recovery_codes = _new_recovery_codes()
        admin = {
            "username": pending["username"],
            "password_hash": pending["password_hash"],
            "totp_secret": pending["totp_secret"],
            "recovery_code_hashes": [_recovery_hash(code) for code in recovery_codes],
            "created": _now(),
            "modified": _now(),
        }
        with _lock:
            if self.configured():
                raise AuthConflict("Admin ist bereits eingerichtet.")
            _atomic_write(self.path, admin)
        token, expires = self.create_session(admin["username"])
        return {"token": token, "expires": expires, "recoveryCodes": recovery_codes}

    def login(
        self,
        username: str,
        password: str,
        totp_code: str | None = None,
        recovery_code: str | None = None,
    ) -> dict:
        admin = self._require_admin()
        if username.strip() != admin.get("username"):
            raise AuthError("Login fehlgeschlagen.")
        try:
            ok = _hasher.verify(admin["password_hash"], password)
        except VerifyMismatchError:
            ok = False
        if not ok:
            raise AuthError("Login fehlgeschlagen.")
        if recovery_code:
            self._consume_recovery_code(admin, recovery_code)
        elif not self._verify_totp(admin["totp_secret"], totp_code or ""):
            raise AuthError("TOTP-Code ist ungültig.")
        token, expires = self.create_session(admin["username"])
        return {"token": token, "expires": expires}

    def create_session(self, username: str) -> tuple[str, float]:
        token = secrets.token_urlsafe(32)
        ttl = session_ttl_seconds()
        expires = _now() + ttl
        _state().set(_key("session", token), {"username": username, "expires": expires})
        return token, expires

    def validate_session(self, token: str | None) -> dict | None:
        if not token or not self.configured():
            return None
        session = _state().get(_key("session", token))
        if not session or session.get("expires", 0) < _now():
            return None
        admin = self._read_admin()
        if not admin or session.get("username") != admin.get("username"):
            return None
        return {"username": admin["username"], "expires": session["expires"]}

    def logout(self, token: str | None) -> None:
        if token:
            _state().set(_key("session", token), {"expires": 0})

    def _require_admin(self) -> dict:
        admin = self._read_admin()
        if not admin:
            raise AuthNotConfigured("Admin ist noch nicht eingerichtet.")
        return admin

    def _read_admin(self) -> dict | None:
        if not self.path.exists():
            return None
        try:
            data = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def _write_admin(self, admin: dict) -> None:
        admin["modified"] = _now()
        _atomic_write(self.path, admin)

    def _totp_uri(self, username: str, secret: str) -> str:
        return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name="GCodeScribe")

    def _verify_totp(self, secret: str, code: str) -> bool:
        return pyotp.TOTP(secret).verify(code.strip().replace(" ", ""), valid_window=1)

    def _consume_recovery_code(self, admin: dict, code: str) -> None:
        digest = _recovery_hash(code)
        hashes = list(admin.get("recovery_code_hashes") or [])
        if digest not in hashes:
            raise AuthError("Recovery-Code ist ungültig.")
        hashes.remove(digest)
        admin["recovery_code_hashes"] = hashes
        self._write_admin(admin)


def session_ttl_seconds() -> int:
    raw = os.environ.get("PLOTTER_AUTH_SESSION_TTL", str(14 * 24 * 60 * 60))
    try:
        return max(60, int(raw))
    except ValueError:
        return 14 * 24 * 60 * 60
