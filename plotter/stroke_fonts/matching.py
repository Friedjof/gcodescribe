"""Text → glyph-key tokenization for stroke fonts.

Longest-match: at each position the longest available key (e.g. a ligature or
word) wins over single characters. Whitespace is handled separately and unknown
characters are reported as missing. Pure and free of rendering concerns.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    kind: str  # "glyph" | "space" | "newline" | "missing"
    value: str


def tokenize(text: str, available_keys: Iterable[str]) -> list[Token]:
    keys = {k for k in available_keys if k}
    max_len = max((len(k) for k in keys), default=1)
    tokens: list[Token] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\n":
            tokens.append(Token("newline", "\n"))
            i += 1
            continue
        if ch == " ":
            tokens.append(Token("space", " "))
            i += 1
            continue
        matched: str | None = None
        hi = min(max_len, n - i)
        for length in range(hi, 0, -1):
            sub = text[i : i + length]
            if sub in keys:
                matched = sub
                break
        if matched is not None:
            tokens.append(Token("glyph", matched))
            i += len(matched)
        else:
            tokens.append(Token("missing", ch))
            i += 1
    return tokens


def missing_characters(tokens: list[Token]) -> list[str]:
    """Unique missing characters, in first-seen order."""
    seen: list[str] = []
    for token in tokens:
        if token.kind == "missing" and token.value not in seen:
            seen.append(token.value)
    return seen
