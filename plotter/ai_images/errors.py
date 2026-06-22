from __future__ import annotations

from ..services.errors import ServiceError

# Machine-readable categories shared with the frontend so it can show a useful
# message per failure instead of a raw SDK exception. Kept stable on purpose.
CATEGORIES = (
    "not_configured",
    "auth_failed",
    "rate_limited",
    "policy_rejected",
    "timeout",
    "bad_response",
    "unsupported_file",
    "file_too_large",
    "vectorization_failed",
)

_STATUS = {
    "not_configured": 503,
    "auth_failed": 502,
    "rate_limited": 429,
    "policy_rejected": 422,
    "timeout": 504,
    "bad_response": 502,
    "unsupported_file": 415,
    "file_too_large": 413,
    "vectorization_failed": 422,
}


class AiImageError(ServiceError):
    """Expected AI-designer failure with a stable, machine-readable category.

    The category is carried in ``category`` and also prefixed onto the message
    (``"category: message"``) so it survives the existing ``{"detail": ...}``
    error contract without a schema change.
    """

    def __init__(self, category: str, message: str):
        self.category = category if category in CATEGORIES else "bad_response"
        self.status_code = _STATUS.get(self.category, 422)
        super().__init__(f"{self.category}: {message}")
