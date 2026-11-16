import { expect, it } from "vitest";
import { fitWorkspaceTabs } from "./tabOverflow";
it("keeps all tabs when they fit and reserves the overflow button only when necessary", () => {
  expect(
    fitWorkspaceTabs(
      ["start", "paint", "paper"],
      [70, 70, 70],
      210,
      80,
      "paint",
    ),
  ).toEqual(["start", "paint", "paper"]);
  expect(
    fitWorkspaceTabs(
      ["start", "paint", "paper"],
      [70, 70, 70],
      205,
      60,
      "paint",
    ),
  ).toEqual(["start", "paint"]);
});
it("keeps the active tab in preference order even at the end of a narrow strip", () => {
  expect(
    fitWorkspaceTabs(
      ["start", "paint", "games", "paper"],
      [70, 70, 70, 70],
      220,
      60,
      "paper",
    ),
  ).toEqual(["start", "paper"]);
  expect(
    fitWorkspaceTabs(
      ["start", "paint", "paper"],
      [70, 70, 70],
      70,
      60,
      "paper",
    ),
  ).toEqual(["paper"]);
});
it("waits for a real browser measurement rather than hiding unmeasured tabs", () => {
  expect(
    fitWorkspaceTabs(["start", "paint"], [0, 0], 200, 60, "paint"),
  ).toEqual(["start", "paint"]);
});
