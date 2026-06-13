from __future__ import annotations

from fastapi.testclient import TestClient

from plotter.sudoku.generate import generate_sudoku
from plotter.web.app import create_app


def test_sudoku_generation_is_deterministic():
    a = generate_sudoku("12345", "medium")
    b = generate_sudoku("12345", "medium")
    c = generate_sudoku("54321", "medium")

    assert a.puzzle == b.puzzle
    assert a.solution == b.solution
    assert a.puzzle != c.puzzle
    assert a.metadata["unique_solution"] is True


def test_sudoku_solution_matches_puzzle():
    result = generate_sudoku("12345", "hard")

    for row in range(9):
        assert sorted(result.solution[row]) == list(range(1, 10))
        assert sorted(result.solution[col][row] for col in range(9)) == list(range(1, 10))

    for box_row in range(0, 9, 3):
        for box_col in range(0, 9, 3):
            values = [
                result.solution[row][col]
                for row in range(box_row, box_row + 3)
                for col in range(box_col, box_col + 3)
            ]
            assert sorted(values) == list(range(1, 10))

    for row in range(9):
        for col in range(9):
            if result.puzzle[row][col]:
                assert result.puzzle[row][col] == result.solution[row][col]


def test_sudoku_route_returns_board_payload(workspace):
    client = TestClient(create_app())
    payload = client.get("/api/sudoku", params={"seed": "12345", "difficulty": "easy"}).json()

    assert payload["seed"] == "12345"
    assert payload["difficulty"] == "easy"
    assert len(payload["puzzle"]) == 9
    assert len(payload["solution"]) == 9
    assert payload["metadata"]["unique_solution"] is True
    assert isinstance(payload["metadata"]["techniques"], list)
