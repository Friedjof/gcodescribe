from __future__ import annotations


class ServiceError(RuntimeError):
    """Domain error; the web layer maps it to its ``status_code``."""

    status_code = 422


class NotHomedError(ServiceError):
    status_code = 409

    def __init__(self, message: str = "Position unbekannt — bitte zuerst alle Achsen homen."):
        super().__init__(message)
