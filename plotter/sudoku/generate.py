from __future__ import annotations

import hashlib
import random
import threading
from dataclasses import dataclass
from typing import Literal

from dokusan import exceptions, generators, solvers, stats
from dokusan.boards import BoxSize, Sudoku

SudokuDifficulty = Literal["easy", "medium", "hard"]

_BOX_SIZE = BoxSize(3, 3)
_RNG_LOCK = threading.Lock()

_BULK_MARKING = "Bulk Pencil Marking"
_EASY_TECHNIQUES = frozenset({"Lone Single", "Hidden Single"})
_MEDIUM_TECHNIQUES = _EASY_TECHNIQUES | frozenset({
    "Naked Pair",
    "Naked Triplet",
    "Locked Candidate",
})
_HARD_TECHNIQUES = _MEDIUM_TECHNIQUES | frozenset({"XY Wing", "Unique Rectangle"})


@dataclass(frozen=True)
class SudokuResult:
    seed: str
    difficulty: SudokuDifficulty
    puzzle: list[list[int]]
    solution: list[list[int]]
    metadata: dict[str, str | int | bool | list[str]]


@dataclass(frozen=True)
class _DifficultyConfig:
    avg_rank: int
    allowed_techniques: frozenset[str]
    max_clues: int


_DIFFICULTIES: dict[SudokuDifficulty, _DifficultyConfig] = {
    "easy": _DifficultyConfig(50, _EASY_TECHNIQUES, 45),
    "medium": _DifficultyConfig(
        100,
        _MEDIUM_TECHNIQUES,
        32,
    ),
    "hard": _DifficultyConfig(
        120,
        _HARD_TECHNIQUES,
        29,
    ),
}


class SudokuGenerationError(RuntimeError):
    pass


def generate_sudoku(seed: str | int, difficulty: SudokuDifficulty) -> SudokuResult:
    seed_str = str(seed)
    config = _DIFFICULTIES[difficulty]

    for attempt in range(8):
        rng = random.Random(_derived_seed(seed_str, difficulty, attempt))
        puzzle = _random_sudoku(config.avg_rank, rng)

        try:
            steps = list(solvers.steps(puzzle))
        except (exceptions.Unsolvable, exceptions.NoCandidates, exceptions.InvalidSudoku):
            continue

        techniques = sorted(
            {step.combination.name for step in steps if step.combination.name != _BULK_MARKING}
        )
        technique_set = frozenset(techniques)
        if not technique_set <= config.allowed_techniques:
            continue
        clues = _count_clues(puzzle)
        has_non_single = bool(technique_set - _EASY_TECHNIQUES)
        if difficulty != "easy" and clues > config.max_clues and not has_non_single:
            continue

        try:
            rank = stats.rank(puzzle)
            solution = solvers.backtrack(puzzle)
        except (exceptions.MultipleSolutions, exceptions.NoCandidates, exceptions.InvalidSudoku):
            continue

        return SudokuResult(
            seed=seed_str,
            difficulty=difficulty,
            puzzle=_board_to_grid(puzzle),
            solution=_board_to_grid(solution),
            metadata={
                "rank": rank,
                "techniques": techniques,
                "clues": clues,
                "unique_solution": True,
                "attempts": attempt + 1,
            },
        )
    raise SudokuGenerationError(f"Could not generate {difficulty} sudoku for seed {seed_str!r}")


def _random_sudoku(avg_rank: int, rng: random.Random) -> Sudoku:
    with _RNG_LOCK:
        original_random = generators.random
        generators.random = rng
        try:
            return generators.random_sudoku(avg_rank=avg_rank, box_size=_BOX_SIZE)
        finally:
            generators.random = original_random


def _derived_seed(seed: str, difficulty: SudokuDifficulty, attempt: int) -> int:
    digest = hashlib.sha256(f"{seed}:{difficulty}:{attempt}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def _board_to_grid(sudoku: Sudoku) -> list[list[int]]:
    return [[cell.value or 0 for cell in row] for row in sudoku.rows()]


def _count_clues(sudoku: Sudoku) -> int:
    return sum(1 for cell in sudoku.cells() if cell.value)
