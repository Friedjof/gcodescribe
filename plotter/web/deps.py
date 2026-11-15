"""FastAPI dependency providers for the domain services.

Routes take these via ``Depends(...)`` instead of instantiating services
mid-function, so every route module obtains its collaborators the same way and
tests can override them through FastAPI's dependency overrides.
"""

from __future__ import annotations

from plotter.core.document import DocumentStore, get_document_store
from plotter.services import PaperService, PrinterController
from plotter.services.gallery import GalleryService
from plotter.services.profiles import ProfileService
from plotter.services.sources import SourceService


def document_store() -> DocumentStore:
    return get_document_store()


def gallery_service() -> GalleryService:
    return GalleryService()


def profile_service() -> ProfileService:
    return ProfileService()


def paper_service(profile_id: str | None = None) -> PaperService:
    return PaperService(profile_id=profile_id)


def printer_controller() -> PrinterController:
    return PrinterController()


def source_service() -> SourceService:
    return SourceService()
