from __future__ import annotations

import hashlib
import random


def normalize_seed(seed: int | str) -> int:
    if isinstance(seed, int):
        return seed
    seed_bytes = str(seed).encode("utf-8")
    digest = hashlib.sha256(seed_bytes).hexdigest()
    return int(digest[:16], 16)


def create_rng(seed: int | str) -> tuple[int, random.Random]:
    normalized = normalize_seed(seed)
    return normalized, random.Random(normalized)
