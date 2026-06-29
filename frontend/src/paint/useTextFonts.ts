import { useEffect, useState } from "react";
import { api, type FontItem } from "../api";
import { BUILTIN_FONT_LABEL_KEYS, DEFAULT_TEXT_FONTS } from "./text";

export function useTextFonts() {
  const [fonts, setFonts] = useState<FontItem[]>(DEFAULT_TEXT_FONTS.map(({ id, label, builtin }) => ({ id, label, builtin, mode: "plotter" })));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    setError(null);
    api.listFonts()
      .then((res) => setFonts(res.fonts))
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  return { fonts, loading, error, reload, setFonts };
}

export function fontLabel(font: FontItem, t: (key: string) => string) {
  const key = BUILTIN_FONT_LABEL_KEYS[font.id];
  return key ? t(key) : font.label;
}
