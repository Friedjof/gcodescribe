"""Copy explicit slide stores into a new private, read-only-test input directory.

Reads only paint index/page keys and calibration profiles. Never instantiates
application stores, migrates data, reads auth settings, or contacts a printer.
Redis URLs are taken from an environment variable and never included in reports.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*\Z")


class SnapshotChanged(RuntimeError):
    """Concurrent editing prevented a consistent capture; originals are unchanged."""


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def profile_paths(root: Path) -> list[Path]:
    return sorted((root / "profiles").glob("*.json"))


def source_paths(root: Path) -> list[Path]:
    return [root / "state" / "paint_index.json",
            *sorted((root / "state").glob("paint_page_*.json")), *profile_paths(root)]


def read_files(root: Path, *, profiles_only: bool = False) -> dict[str, bytes]:
    paths = profile_paths(root) if profiles_only else source_paths(root)
    return {str(path.relative_to(root)): path.read_bytes() for path in paths}


def file_snapshot(root: Path) -> dict[str, bytes]:
    captured = read_files(root)
    if read_files(root) != captured:
        raise SnapshotChanged("File store changed while reading; retry the snapshot")
    return captured


def redis_snapshot(client, profiles_root: Path) -> dict[str, bytes]:
    """MGET captures index and pages atomically; profiles must remain stable."""
    profiles = read_files(profiles_root, profiles_only=True)
    keys = sorted(client.scan_iter(match="plotter:paint_page_*"))
    selected = [b"plotter:paint_index", *keys]
    values = client.mget(selected)
    if values[0] is None:
        raise ValueError("Redis has no plotter paint index")
    if (keys != sorted(client.scan_iter(match="plotter:paint_page_*"))
            or values[0] != client.get(selected[0])
            or profiles != read_files(profiles_root, profiles_only=True)):
        raise SnapshotChanged("Redis index, page keys or profiles changed; retry the snapshot")
    captured = dict(profiles)
    for key, raw in zip(selected, values, strict=True):
        if raw is None:
            raise SnapshotChanged("A Redis page disappeared during capture")
        name = key.decode().removeprefix("plotter:")
        if "/" in name or "\\" in name or not name.startswith("paint_"):
            raise ValueError("Unexpected paint key name")
        captured[f"state/{name}.json"] = raw
    return captured


def write_snapshot(output: Path, sources: dict[str, dict[str, bytes]]) -> dict:
    """Exclusively create a destination; an existing snapshot is never overwritten."""
    if not sources or any(not LABEL.fullmatch(label) for label in sources):
        raise ValueError("Sources need unique safe labels")
    for records in sources.values():
        for relative, raw in records.items():
            path = Path(relative)
            if (not path.parts or path.is_absolute() or ".." in path.parts
                    or path.parts[0] not in ("state", "profiles")):
                raise ValueError("Snapshot paths must remain inside their source directory")
            json.loads(raw)  # Never label malformed captures as a valid snapshot.
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    marker = output / ".incomplete"
    marker.write_text("Snapshot not complete until this marker is removed.\n")
    manifest = {"complete": False, "sources": []}
    for label, records in sources.items():
        hashes = {}
        for relative, raw in records.items():
            destination = output / label / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
            hashes[relative] = sha(raw)
        manifest["sources"].append({"label": label, "hashes": hashes})
    manifest["complete"] = True
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    marker.unlink()
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file-source", action="append", default=[], metavar="LABEL=DATA_DIR")
    parser.add_argument("--redis-source", metavar="LABEL")
    parser.add_argument("--redis-url-env", default="REDIS_URL",
                        help="Environment variable holding the URL; never printed")
    parser.add_argument("--profiles-from", type=Path, help="Data root for Redis profile files")
    parser.add_argument("--output", type=Path, required=True, help="New directory, must not exist")
    args = parser.parse_args()
    if not args.file_source and not args.redis_source:
        parser.error("Provide at least one explicit source")
    if args.output.exists():
        parser.error("Output already exists; choose a new directory")
    sources = {}
    roots = []

    def register(label: str, records: dict[str, bytes]) -> None:
        if not LABEL.fullmatch(label) or label in sources:
            parser.error("Source labels must be safe and unique")
        sources[label] = records

    for spec in args.file_source:
        label, directory = spec.split("=", 1)
        root = Path(directory).resolve()
        roots.append(root)
        register(label, file_snapshot(root))
    if args.redis_source:
        if not args.profiles_from or not os.environ.get(args.redis_url_env):
            parser.error("Redis needs --profiles-from and a configured URL environment variable")
        import redis

        root = args.profiles_from.resolve()
        roots.append(root)
        try:
            client = redis.Redis.from_url(os.environ[args.redis_url_env],
                                          socket_connect_timeout=3, socket_timeout=10)
            register(args.redis_source, redis_snapshot(client, root))
        except (redis.RedisError, ValueError) as exc:
            # Exception strings from network clients can contain credentials.
            parser.error(f"Redis snapshot failed ({type(exc).__name__}); no original data changed")
    if any(args.output.resolve().is_relative_to(root) for root in roots):
        parser.error("Output must be outside all source directories")
    manifest = write_snapshot(args.output, sources)
    print(json.dumps({"output": str(args.output), "sources": [
        {"label": item["label"], "files": len(item["hashes"])}
        for item in manifest["sources"]
    ]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
