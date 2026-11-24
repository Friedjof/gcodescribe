"""Serve fresh SPA entry points while retaining conditional caching for assets."""

from pathlib import Path

from starlette.responses import FileResponse
from starlette.staticfiles import StaticFiles

HTML_HEADERS = {"Cache-Control": "no-store"}


class FrontendFiles(StaticFiles):
    def file_response(self, full_path, stat_result, scope, status_code=200):
        if Path(full_path).suffix.lower() == ".html":
            # OSTree normalises mtimes. Equal-length HTML from two releases can
            # otherwise share an ETag and incorrectly produce HTTP 304.
            return FileResponse(
                full_path, status_code=status_code, stat_result=stat_result,
                headers=HTML_HEADERS,
            )
        return super().file_response(full_path, stat_result, scope, status_code)
