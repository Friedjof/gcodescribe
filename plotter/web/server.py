from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    # NOTE: Keep this single-process (do NOT pass workers=N>1). The live-view
    # WebSocket stream (plotter/stream/session.py) keeps its sessions, publishers
    # and viewers in process memory, so publisher and viewer must hit the same
    # process. With multiple workers a viewer can land on a process that has no
    # record of the session and gets closed (1008). If horizontal scaling is ever
    # needed, move the stream onto Redis pub/sub (Redis is already a dependency).
    uvicorn.run(
        "plotter.web.app:app",
        host=os.environ.get("PLOTTER_HOST", "0.0.0.0"),
        port=int(os.environ.get("PLOTTER_PORT", "8000")),
    )


if __name__ == "__main__":
    main()
