import { useState } from "react";
import type { GameId } from "../lib/types";
import { SEEDED_GAMES } from "../lib/constants";
import { randomMazeSeed } from "../lib/utils";

export function validTemplateSeed(input: string) {
  return /^\d{5}$/.test(input);
}
export function useTemplateSeeds() {
  const [inputs, setInputs] = useState<Partial<Record<GameId, string>>>(() =>
    Object.fromEntries(
      [...SEEDED_GAMES].map((id) => [id, String(randomMazeSeed())]),
    ),
  );
  const input = (id: GameId) => inputs[id] ?? "";
  const set = (id: GameId, value: string) =>
    setInputs((all) => ({ ...all, [id]: value }));
  const resolve = (id: GameId) =>
    !SEEDED_GAMES.has(id)
      ? 1
      : validTemplateSeed(input(id))
        ? Number(input(id))
        : null;
  return {
    input,
    resolve,
    set,
    value: (id: GameId) => resolve(id) ?? 1,
    randomize: (id: GameId) => {
      const seed = randomMazeSeed();
      set(id, String(seed));
      return seed;
    },
  };
}
