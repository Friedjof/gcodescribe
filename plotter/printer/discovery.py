from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from serial.tools import list_ports

_PROBE_BAUD = 115200

# Common USB-serial chips and controller boards found in Marlin printers. These
# are hints, not proof: the UI still presents them as candidates for the user.
_KNOWN_VIDS = {
    0x1A86: "QinHeng (CH340/CH341)",
    0x0403: "FTDI",
    0x067B: "Prolific (PL2303)",
    0x2341: "Arduino",
    0x2A03: "Arduino (old)",
    0x10C4: "Silicon Labs (CP210x)",
    0x1D50: "OpenMoko",
    0x0483: "STMicroelectronics",
}


@dataclass(frozen=True)
class SerialCandidate:
    device: str
    by_id: str | None
    description: str | None
    manufacturer: str | None
    serial_number: str | None
    vid: int | None
    pid: int | None
    likely_printer: bool
    score: int

    def as_dict(self) -> dict:
        return {
            "device": self.device,
            "byId": self.by_id,
            "description": self.description,
            "manufacturer": self.manufacturer,
            "serialNumber": self.serial_number,
            "vid": _hex_or_none(self.vid),
            "pid": _hex_or_none(self.pid),
            "likelyPrinter": self.likely_printer,
            "score": self.score,
        }


def list_candidates() -> list[SerialCandidate]:
    """Return passive USB serial candidates without opening any device."""
    by_id = _by_id_map()
    out: list[SerialCandidate] = []
    for port in list_ports.comports():
        if port.vid is None:
            continue
        score = _score(port)
        out.append(
            SerialCandidate(
                device=port.device,
                by_id=by_id.get(_realpath(port.device)),
                description=port.description,
                manufacturer=port.manufacturer,
                serial_number=port.serial_number,
                vid=port.vid,
                pid=port.pid,
                likely_printer=score >= 2,
                score=score,
            )
        )
    out.sort(key=lambda c: (-c.score, c.by_id or c.device))
    return out


def resolve_auto_port() -> str | None:
    candidates = [c for c in list_candidates() if c.likely_printer]
    if len(candidates) == 1:
        return candidates[0].by_id or candidates[0].device
    return None


def _score(port) -> int:
    score = 0
    if port.vid in _KNOWN_VIDS:
        score += 2
    text = " ".join(
        str(value or "")
        for value in (port.description, port.manufacturer, getattr(port, "product", None))
    ).lower()
    if any(
        keyword in text
        for keyword in (
            "marlin",
            "3d",
            "printer",
            "ramps",
            "creality",
            "prusa",
            "anycubic",
            "ender",
        )
    ):
        score += 3
    if str(port.device).startswith(("/dev/ttyUSB", "/dev/ttyACM")):
        score += 1
    return score


def _default_opener(device: str, baud: int):
    import serial

    return serial.Serial(device, baud, timeout=1.0)


def probe(
    device: str,
    baud: int = _PROBE_BAUD,
    timeout: float = 8.0,
    opener: Callable | None = None,
) -> dict:
    """Actively identify a port via M115. Opens the port — this resets the board.

    Caller must ensure the serial worker does not currently hold the port.
    """
    opener = opener or _default_opener
    try:
        port = opener(device, baud)
    except Exception as exc:  # noqa: BLE001 - open failure means "not usable"
        return {"device": device, "marlin": False, "firmware": None, "error": str(exc)}
    try:
        try:
            port.reset_input_buffer()
        except Exception:  # noqa: BLE001
            pass
        # Give the board a moment to finish its reset banner, then query.
        _read_lines(port, min(timeout, 3.0), stop_on_ok=False)
        port.write(b"M115\n")
        lines = _read_lines(port, timeout, stop_on_ok=True)
    except Exception as exc:  # noqa: BLE001
        return {"device": device, "marlin": False, "firmware": None, "error": str(exc)}
    finally:
        try:
            port.close()
        except Exception:  # noqa: BLE001
            pass
    firmware = _parse_firmware(lines)
    marlin = firmware is not None or any("marlin" in ln.lower() for ln in lines)
    return {"device": device, "marlin": marlin, "firmware": firmware}


def _read_lines(port, timeout: float, *, stop_on_ok: bool) -> list[str]:
    deadline = time.monotonic() + timeout
    lines: list[str] = []
    while time.monotonic() < deadline:
        raw = port.readline()
        if not raw:
            if not stop_on_ok:
                # banner drain: a quiet read means the board is done talking
                break
            continue
        text = raw.decode(errors="replace").strip()
        if text:
            lines.append(text)
            if stop_on_ok and text.lower().startswith("ok"):
                break
    return lines


def _parse_firmware(lines: list[str]) -> str | None:
    for line in lines:
        if "FIRMWARE_NAME:" in line:
            after = line.split("FIRMWARE_NAME:", 1)[1]
            m = re.match(r"(.*?)(?:\s+[A-Z_]+:|$)", after)
            name = (m.group(1) if m else after).strip()
            return name or None
    return None


def _by_id_map() -> dict[str, str]:
    root = Path("/dev/serial/by-id")
    if not root.exists():
        return {}
    out: dict[str, str] = {}
    for entry in root.iterdir():
        if entry.is_symlink():
            out[_realpath(str(entry))] = str(entry)
    return out


def _realpath(path: str) -> str:
    return str(Path(path).resolve(strict=False))


def _hex_or_none(value: int | None) -> str | None:
    return f"0x{value:04x}" if value is not None else None
