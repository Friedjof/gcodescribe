"""Durable, single-conversion queue owned by the one API process."""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from plotter.core.calibration import data_dir
from plotter.core.document import DocumentStore, get_document_store
from plotter.core.events import hub
from plotter.services.asset_task_worker import write_json
from plotter.services.errors import ServiceError
from plotter.services.gallery import GalleryService

TERMINAL = {"done", "failed", "cancelled", "interrupted"}


class AssetTasks:
    def __init__(
        self,
        root: Path | None = None,
        gallery: GalleryService | None = None,
        documents: DocumentStore | None = None,
    ):
        self.root = root or data_dir() / "asset-tasks"
        self.root.mkdir(parents=True, exist_ok=True)
        self.gallery = gallery or GalleryService()
        self.documents = documents or get_document_store()
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.stopped = False
        self.process: subprocess.Popen | None = None
        self.active: str | None = None
        self.thread: threading.Thread | None = None
        for task in self.list():
            if task["state"] not in TERMINAL:
                self._update(task["id"], state="interrupted", phase="interrupted")

    def list(self) -> list[dict]:
        with self.lock:
            tasks = []
            for path in self.root.glob("*/task.json"):
                try:
                    task = json.loads(path.read_text())
                    if not task.get("dismissed"):
                        tasks.append(task)
                except (OSError, ValueError):
                    continue
            return sorted(tasks, key=lambda t: t["created"], reverse=True)

    def get(self, task_id: str) -> dict:
        if not task_id or any(c not in "0123456789abcdef" for c in task_id):
            raise KeyError(task_id)
        try:
            return json.loads((self.root / task_id / "task.json").read_text())
        except FileNotFoundError as exc:
            raise KeyError(task_id) from exc

    def _update(self, task_id: str, **changes) -> dict:
        with self.lock:
            task = {**self.get(task_id), **changes, "updated": time.time()}
            write_json(self.root / task_id / "task.json", task)
            hub.publish("asset-task", task=task)
            return task

    def start(self) -> None:
        with self.lock:
            if self.thread is None:
                self.thread = threading.Thread(target=self._run, name="asset-tasks", daemon=True)
                self.thread.start()

    def submit(self, request: dict, data: bytes | None = None) -> dict:
        with self.lock:
            task_id = request.get("id") or uuid.uuid4().hex
            if (self.root / task_id / "task.json").exists():
                return self.get(task_id)
            if sum(t["state"] not in TERMINAL for t in self.list()) >= 20:
                raise ServiceError("Die Warteschlange ist voll. Bitte kurz warten.")
            folder = self.root / task_id
            folder.mkdir()
            request = {**request, "id": task_id, "gallery_root": str(self.gallery.root.resolve())}
            if data is not None:
                (folder / "source").write_bytes(data)
            write_json(folder / "request.json", request)
            task = {
                "id": task_id,
                "kind": request["kind"],
                "state": "queued",
                "phase": "queued",
                "created": time.time(),
                "updated": time.time(),
                "filename": request.get("filename", ""),
                "item_id": request.get("item_id"),
                "target": request.get("target"),
                "error": None,
            }
            write_json(folder / "task.json", task)
            hub.publish("asset-task", task=task)
            self.start()
            self.wake.set()
            return task

    @staticmethod
    def _terminate(process: subprocess.Popen) -> None:
        # A converter may itself spawn potrace/LibreOffice: terminate its group.
        try:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()

    def cancel(self, task_id: str) -> dict:
        with self.lock:
            task = self.get(task_id)
            if task["state"] in TERMINAL:
                return task
            task = self._update(task_id, state="cancelled", phase="cancelled")
            if self.active == task_id and self.process is not None:
                self._terminate(self.process)
            return task

    def retry(self, task_id: str) -> dict:
        with self.lock:
            task = self.get(task_id)
            if task["state"] not in {"failed", "cancelled", "interrupted"}:
                return task
            folder = self.root / task_id
            request = json.loads((folder / "request.json").read_text())
            if request["kind"] == "render":
                current = self.gallery.get(request["item_id"])
                revision = current.get("render_revision", current["created"])
                if revision != task_id and revision != request.get("expected_revision"):
                    request["expected_revision"] = revision
                    write_json(folder / "request.json", request)
                    (folder / "result.json").unlink(missing_ok=True)
            # A staged result is reusable after a crash during publication.
            task = self._update(task_id, state="queued", phase="queued", error=None)
            self.start()
            self.wake.set()
            return task

    def dismiss(self, task_id: str) -> None:
        with self.lock:
            if self.get(task_id)["state"] not in TERMINAL:
                raise ValueError("Auftrag läuft noch.")
            if self.active == task_id:
                self._update(task_id, dismissed=True)
            else:
                shutil.rmtree(self.root / task_id)

    def close(self) -> None:
        with self.lock:
            self.stopped = True
            if self.active:
                self._update(self.active, state="interrupted", phase="interrupted")
            if self.process:
                self._terminate(self.process)
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=3)

    def _run(self) -> None:
        while not self.stopped:
            queued = [t for t in self.list() if t["state"] == "queued"]
            if not queued:
                self.wake.wait(timeout=1)
                self.wake.clear()
                continue
            task = queued[-1]
            task_id = task["id"]
            folder = self.root / task_id
            try:
                with self.lock:
                    if self.get(task_id)["state"] != "queued" or self.stopped:
                        continue
                    self.active = task_id
                    self._update(task_id, state="running", phase="preparing")
                    if not (folder / "result.json").exists():
                        for name in ("error.json", "progress.json"):
                            (folder / name).unlink(missing_ok=True)
                        self.process = subprocess.Popen(
                            [
                                sys.executable,
                                "-m",
                                "plotter.services.asset_task_worker",
                                str(folder.resolve()),
                            ],
                            start_new_session=True,
                            env={
                                **os.environ,
                                "PLOTTER_TASK_PARENT": str(os.getpid()),
                                "OMP_NUM_THREADS": "1",
                                "OPENBLAS_NUM_THREADS": "1",
                                "MKL_NUM_THREADS": "1",
                            },
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                process = self.process
                last_phase = ""
                if process:
                    while process.poll() is None and not self.stopped:
                        try:
                            progress = json.loads((folder / "progress.json").read_text())
                            if progress["phase"] != last_phase:
                                last_phase = progress["phase"]
                                with self.lock:
                                    if self.get(task_id)["state"] == "running":
                                        self._update(task_id, phase=last_phase)
                        except (OSError, ValueError):
                            pass
                        try:
                            process.wait(timeout=0.25)
                        except subprocess.TimeoutExpired:
                            pass
                with self.lock:
                    if self.get(task_id)["state"] != "running":
                        continue
                    if not (folder / "result.json").exists():
                        error = (
                            json.loads((folder / "error.json").read_text())
                            if (folder / "error.json").exists()
                            else {}
                        )
                        raise ValueError(error.get("error", "Konvertierung wurde unterbrochen."))
                    self._update(task_id, phase="publishing")
                    result = json.loads((folder / "result.json").read_text())
                    request = json.loads((folder / "request.json").read_text())
                    items = result.get("items") or [result["item"]]
                    item = items[0]
                    for created in items:
                        self.gallery.publish_task(
                            folder / "staging" / created["id"], created, task_id,
                            request.get("expected_revision"),
                        )
                    target = request.get("target")
                    attached = None
                    if target:
                        attached = self.documents.append_import(
                            target["page_id"],
                            target.get("profile_id"),
                            target.get("fingerprint"),
                            task_id,
                            result["object"],
                            project_id=target.get("project_id"),
                        )
                    self._update(
                        task_id, state="done", phase="done", item_id=item["id"],
                        item_ids=[created["id"] for created in items], attached=attached
                    )
                    shutil.rmtree(folder / "staging", ignore_errors=True)
                    (folder / "source").unlink(missing_ok=True)
                    (folder / "result.json").unlink(missing_ok=True)
            except Exception as exc:
                with self.lock:
                    if self.get(task_id)["state"] == "running":
                        self._update(task_id, state="failed", phase="failed", error=str(exc)[:1000])
            finally:
                with self.lock:
                    self.process = None
                    self.active = None
                    if (folder / "task.json").exists() and self.get(task_id).get("dismissed"):
                        shutil.rmtree(folder, ignore_errors=True)


_service: AssetTasks | None = None
_service_lock = threading.Lock()


def asset_tasks() -> AssetTasks:
    global _service
    with _service_lock:
        if _service is None:
            _service = AssetTasks()
        return _service


def shutdown_tasks() -> None:
    global _service
    with _service_lock:
        if _service is not None:
            _service.close()
            _service = None
