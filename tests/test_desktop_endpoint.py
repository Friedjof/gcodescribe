import json
import socket

import pytest

from plotter.desktop.endpoint import desktop_port


def test_keeps_local_endpoint_across_restarts(tmp_path):
    first = desktop_port(tmp_path)
    assert desktop_port(tmp_path) == first
    assert json.loads((tmp_path / "desktop-endpoint.json").read_text()) == {"port": first}


def test_does_not_silently_change_an_occupied_endpoint(tmp_path):
    with socket.socket() as other:
        other.bind(("127.0.0.1", 0))
        (tmp_path / "desktop-endpoint.json").write_text(
            json.dumps({"port": other.getsockname()[1]})
        )
        with pytest.raises(RuntimeError, match="belegt"):
            desktop_port(tmp_path)


def test_invalid_state_gets_a_new_local_endpoint(tmp_path):
    (tmp_path / "desktop-endpoint.json").write_text("not json")
    assert desktop_port(tmp_path) >= 1024


def test_reuses_endpoint_immediately_after_a_real_connection(tmp_path):
    with socket.socket() as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        with socket.create_connection(("127.0.0.1", port)) as client:
            connection, _ = server.accept()
            connection.close()
            assert client.recv(1) == b""
    (tmp_path / "desktop-endpoint.json").write_text(json.dumps({"port": port}))
    assert desktop_port(tmp_path) == port
