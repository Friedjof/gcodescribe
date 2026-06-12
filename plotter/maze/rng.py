from __future__ import annotations

import random


def create_rng(*parts: object) -> random.Random:
    return random.Random(":".join(str(part) for part in parts))
