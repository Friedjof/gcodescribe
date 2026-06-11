import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";
import { clamp, centerText, usableArea, centeredOrigin } from "./utils";

export function buildHangmanTemplate(cal: Calibration, t: Translator): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const width = usableWidth;
  const height = usableHeight * 0.86;
  const [x0, y0] = centeredOrigin(width, height, cal, t);
  const lines: Pt[][] = [];
  const gallowsWidth = width * 0.34;
  const baseY = y0 + height * 0.88;
  const topY = y0 + height * 0.08;
  const poleX = x0 + gallowsWidth * 0.28;
  const beamEndX = x0 + gallowsWidth * 0.78;
  const ropeX = x0 + gallowsWidth * 0.66;
  const ropeBottomY = y0 + height * 0.28;
  const wordAreaX = x0 + gallowsWidth + width * 0.06;
  const wordAreaW = width - (wordAreaX - x0);
  const wordSlots = clamp(Math.floor(wordAreaW / 14), 6, 12);
  const slotLen = Math.min((wordAreaW - (wordSlots - 1) * 4) / wordSlots, 12);
  const wordY = y0 + height * 0.62;
  const missY = y0 + height * 0.3;
  const missW = wordAreaW * 0.72;

  lines.push([[x0 + gallowsWidth * 0.04, baseY], [x0 + gallowsWidth * 0.56, baseY]]);
  lines.push([[poleX, baseY], [poleX, topY]]);
  lines.push([[poleX, topY], [beamEndX, topY]]);
  lines.push([[ropeX, topY], [ropeX, ropeBottomY]]);
  lines.push(...centerText(t("games.hangman.misses"), [wordAreaX + missW / 2, missY - height * 0.06], height * 0.04, missW));
  lines.push([[wordAreaX, missY], [wordAreaX + missW, missY]]);
  lines.push(...centerText(t("games.hangman.word"), [wordAreaX + wordAreaW / 2, wordY - height * 0.08], height * 0.04, wordAreaW));
  for (let i = 0; i < wordSlots; i++) {
    const sx = wordAreaX + i * (slotLen + 4);
    lines.push([[sx, wordY], [sx + slotLen, wordY]]);
  }

  return {
    name: t("game.hangman.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.wordSlots"), value: String(wordSlots) },
      { label: t("games.param.rows"), value: "1" },
    ],
  };
}
