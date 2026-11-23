"""A persistent loopback endpoint for desktop clients, including MCP."""

from __future__ import annotations

import json
import socket
from pathlib import Path


def desktop_port(data_dir: Path) -> int:
    path = data_dir / "desktop-endpoint.json"
    try:
        saved = json.loads(path.read_text()).get("port")
    except (OSError, ValueError, AttributeError):
        saved = None
    if type(saved) is not int or not 1024 <= saved <= 65535:
        saved = None
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind(("127.0.0.1", saved or 0))
        except OSError as exc:
            raise RuntimeError(
                f"Der lokale Port {saved} ist belegt. Beende die andere Instanz "
                "oder den Dienst auf diesem Port und starte GCodeScribe erneut."
            ) from exc
        port = listener.getsockname()[1]
    if saved is None:
        data_dir.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"port": port}) + "\n")
        temporary.chmod(0o600)
        temporary.replace(path)
    return port
