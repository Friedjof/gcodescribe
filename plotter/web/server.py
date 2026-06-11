from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    uvicorn.run(
        "plotter.web.app:app",
        host=os.environ.get("PLOTTER_HOST", "0.0.0.0"),
        port=int(os.environ.get("PLOTTER_PORT", "8000")),
    )


if __name__ == "__main__":
    main()
