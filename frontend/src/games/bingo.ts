import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";
import { clamp, formatMm, rectOutline, centerText, usableArea, centeredOrigin, mulberry32, shuffle } from "./utils";

export function buildBingoTemplate(cal: Calibration, seed: number, t: Translator): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const gap = clamp(Math.min(usableWidth, usableHeight) * 0.05, 6, 12);
  let best: { across: number; down: number; cell: number } | null = null;

  for (let across = 1; across <= 3; across++) {
    for (let down = 1; down <= 3; down++) {
      if (across * down > 4) continue;
      const cell = Math.min(
        (usableWidth - gap * Math.max(0, across - 1)) / (across * 5),
        (usableHeight - gap * Math.max(0, down - 1)) / (down * 6),
      );
      if (cell < 8.5) continue;
      if (!best || across * down > best.across * best.down || (across * down === best.across * best.down && cell > best.cell)) {
        best = { across, down, cell };
      }
    }
  }

  const layout = best ?? { across: 1, down: 1, cell: Math.min(usableWidth / 5, usableHeight / 6) };
  const width = layout.across * 5 * layout.cell + gap * Math.max(0, layout.across - 1);
  const height = layout.down * 6 * layout.cell + gap * Math.max(0, layout.down - 1);
  const [x0, y0] = centeredOrigin(width, height, cal, t);
  const cardWidth = layout.cell * 5;
  const cardHeight = layout.cell * 6;
  const lines: Pt[][] = [];
  const rand = mulberry32(seed);
  let cardIndex = 0;

  for (let row = 0; row < layout.down; row++) {
    for (let col = 0; col < layout.across; col++) {
      const cardX = x0 + col * (cardWidth + gap);
      const cardY = y0 + row * (cardHeight + gap);
      const numbers = bingoCardNumbers(rand);
      cardIndex += 1;
      lines.push(rectOutline(cardX, cardY, cardWidth, cardHeight));
      for (let i = 1; i < 5; i++) lines.push([[cardX + i * layout.cell, cardY], [cardX + i * layout.cell, cardY + cardHeight]]);
      for (let i = 1; i < 6; i++) lines.push([[cardX, cardY + i * layout.cell], [cardX + cardWidth, cardY + i * layout.cell]]);
      for (let i = 0; i < 5; i++) {
        const letter = "BINGO"[i];
        lines.push(...centerText(letter, [cardX + (i + 0.5) * layout.cell, cardY + layout.cell * 0.52], layout.cell * 0.52, layout.cell * 0.68));
      }
      for (let numberRow = 0; numberRow < 5; numberRow++) {
        for (let numberCol = 0; numberCol < 5; numberCol++) {
          const center: [number, number] = [cardX + (numberCol + 0.5) * layout.cell, cardY + (numberRow + 1.5) * layout.cell];
          const text = numberRow === 2 && numberCol === 2 ? t("games.bingo.free") : String(numbers[numberCol][numberRow]);
          const fontSize = numberRow === 2 && numberCol === 2 ? layout.cell * 0.28 : layout.cell * 0.38;
          lines.push(...centerText(text, center, fontSize, layout.cell * 0.72));
        }
      }
      lines.push(...centerText(String(cardIndex), [cardX + cardWidth - layout.cell * 0.38, cardY + cardHeight - layout.cell * 0.3], layout.cell * 0.22, layout.cell * 0.36));
    }
  }

  return {
    name: t("game.bingo.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.cardCount"), value: String(layout.across * layout.down) },
      { label: t("games.param.cardsAcross"), value: String(layout.across) },
      { label: t("games.param.cardsDown"), value: String(layout.down) },
      { label: t("games.param.cellSize"), value: formatMm(layout.cell) },
    ],
  };
}

function bingoCardNumbers(rand: () => number): number[][] {
  const columns: number[][] = [];
  for (let col = 0; col < 5; col++) {
    const start = col * 15 + 1;
    const pool = Array.from({ length: 15 }, (_, index) => start + index);
    shuffle(pool, rand);
    columns.push(pool.slice(0, 5).sort((a, b) => a - b));
  }
  return columns;
}
