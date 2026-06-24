import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import en from "./en";
import de from "./de";
import ba from "./ba";
import fr from "./fr";
import es from "./es";

type Lang = "de" | "en" | "ba" | "fr" | "es";
type Dict = Record<string, string>;

const dict: Record<Lang, Dict> = { en, de, ba, fr, es };

const I18nContext = createContext<{
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
} | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem("lang");
    return saved === "de" || saved === "ba" || saved === "fr" || saved === "es" ? saved : "en";
  });
  const value = useMemo(() => ({
    lang,
    setLang: (next: Lang) => {
      localStorage.setItem("lang", next);
      setLangState(next);
    },
    t: (key: string, vars?: Record<string, string | number>) => {
      let text = dict[lang][key] ?? dict.en[key] ?? key;
      for (const [name, value] of Object.entries(vars ?? {})) {
        text = text.split(`{${name}}`).join(String(value));
      }
      return text;
    },
  }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
