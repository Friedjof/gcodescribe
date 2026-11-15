"""Wire contracts shared by printer backends, services and the web layer.

These describe the fields consumed by GCodeScribe. OctoPrint may return extra
fields; keep its payload intact rather than filtering it through a response model.
"""

from typing import Literal, NotRequired, TypedDict

JobOutcome = Literal["completed", "cancelled", "failed"]


class PrinterFile(TypedDict, total=False):
    name: str | None


class JobFile(TypedDict, total=False):
    file: PrinterFile | None


class JobProgress(TypedDict, total=False):
    completion: float | None


class PrinterJob(TypedDict, total=False):
    id: str | None
    state: str | None
    progress: JobProgress | None
    job: JobFile | None


class PrinterJobResult(TypedDict):
    id: str
    filename: str
    outcome: JobOutcome


class PrinterConnection(TypedDict, total=False):
    state: str | None


class PrinterState(TypedDict, total=False):
    text: str | None


class PrinterInfo(TypedDict, total=False):
    state: PrinterState | None


class PrinterStatus(TypedDict):
    configured: bool
    backend: NotRequired[str]
    online: NotRequired[bool]
    url: NotRequired[str]
    connection: NotRequired[PrinterConnection | None]
    printer: NotRequired[PrinterInfo | None]
    job: NotRequired[PrinterJob | None]
    last_job: NotRequired[PrinterJobResult | None]
    error: NotRequired[str | None]
    motion_locked: NotRequired[bool]


class PrinterBackendInfo(TypedDict):
    id: str
    configured: bool
    online: bool
    active: bool
