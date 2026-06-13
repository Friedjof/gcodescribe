from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query

from ...sudoku import SudokuDifficulty, generate_sudoku
from ...sudoku.generate import SudokuGenerationError

router = APIRouter(tags=["sudoku"])


@router.get("/sudoku")
def sudoku(
    seed: str = Query("12345", min_length=1, max_length=64),
    difficulty: SudokuDifficulty = Query("medium"),
) -> dict:
    try:
        result = _generate_cached(seed, difficulty)
    except SudokuGenerationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "seed": result.seed,
        "difficulty": result.difficulty,
        "puzzle": result.puzzle,
        "solution": result.solution,
        "metadata": result.metadata,
    }


@lru_cache(maxsize=128)
def _generate_cached(seed: str, difficulty: SudokuDifficulty):
    return generate_sudoku(seed, difficulty)
