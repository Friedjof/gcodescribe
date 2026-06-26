from __future__ import annotations

import pyotp
from fastapi.testclient import TestClient

from plotter.services.auth import AuthService
from plotter.web.app import create_app


def client(workspace, monkeypatch) -> TestClient:
    monkeypatch.delenv("PLOTTER_AUTH_TEST_BYPASS", raising=False)
    return TestClient(create_app())


def setup_admin(
    c: TestClient,
    username: str = "admin",
    password: str = "supersecret12",
) -> list[str]:
    start = c.post("/api/auth/setup/start", json={"username": username, "password": password})
    assert start.status_code == 200
    data = start.json()
    code = pyotp.TOTP(data["totpSecret"]).now()
    finish = c.post("/api/auth/setup/finish", json={"setupId": data["setupId"], "code": code})
    assert finish.status_code == 200
    return finish.json()["recoveryCodes"]


class TestAuthSetup:
    def test_session_reports_unconfigured(self, workspace, monkeypatch):
        c = client(workspace, monkeypatch)
        assert c.get("/api/auth/session").json() == {
            "configured": False,
            "authenticated": False,
            "username": None,
        }

    def test_setup_creates_admin_and_session(self, workspace, monkeypatch):
        c = client(workspace, monkeypatch)
        recovery = setup_admin(c)
        assert len(recovery) == 8
        session = c.get("/api/auth/session").json()
        assert session["configured"] is True
        assert session["authenticated"] is True
        assert session["username"] == "admin"
        assert (workspace / "auth" / "admin.json").exists()

    def test_second_setup_is_rejected(self, workspace, monkeypatch):
        c = client(workspace, monkeypatch)
        setup_admin(c)
        r = c.post("/api/auth/setup/start", json={"username": "x", "password": "supersecret12"})
        assert r.status_code == 409


class TestAuthLogin:
    def test_dev_bypass_reports_authenticated_session(self, workspace, monkeypatch):
        monkeypatch.delenv("PLOTTER_AUTH_TEST_BYPASS", raising=False)
        monkeypatch.setenv("PLOTTER_AUTH_DEV_BYPASS", "1")
        c = TestClient(create_app())

        assert c.get("/api/auth/session").json() == {
            "configured": True,
            "authenticated": True,
            "username": "dev",
        }
        assert c.get("/api/jobs").status_code == 200

    def test_protected_route_requires_login(self, workspace, monkeypatch):
        c = client(workspace, monkeypatch)
        assert c.get("/api/jobs").status_code == 401

    def test_login_with_totp_allows_protected_route(self, workspace, monkeypatch):
        c = client(workspace, monkeypatch)
        setup_admin(c)
        c.post("/api/auth/logout")
        secret = AuthService()._read_admin()["totp_secret"]
        r = c.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "supersecret12",
                "totpCode": pyotp.TOTP(secret).now(),
            },
        )
        assert r.status_code == 200
        assert c.get("/api/jobs").status_code == 200

    def test_login_with_recovery_code_consumes_code(self, workspace, monkeypatch):
        c = client(workspace, monkeypatch)
        recovery = setup_admin(c)
        c.post("/api/auth/logout")
        r = c.post(
            "/api/auth/login",
            json={"username": "admin", "password": "supersecret12", "recoveryCode": recovery[0]},
        )
        assert r.status_code == 200
        c.post("/api/auth/logout")
        again = c.post(
            "/api/auth/login",
            json={"username": "admin", "password": "supersecret12", "recoveryCode": recovery[0]},
        )
        assert again.status_code == 401

    def test_gallery_upload_stays_public(self, workspace, cal, monkeypatch):
        monkeypatch.setenv("GALLERY_UPLOAD_ENABLED", "1")
        c = client(workspace, monkeypatch)
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm">'
            b'<line x1="0" y1="0" x2="5" y2="5" stroke="black"/></svg>'
        )
        r = c.post(
            "/api/gallery",
            files={"file": ("art.svg", svg, "image/svg+xml")},
            data={"title": "Art"},
        )
        assert r.status_code == 200
        assert c.get("/api/gallery").status_code == 401
