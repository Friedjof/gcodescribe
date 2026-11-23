import { useEffect, useState } from "react";
import { useInterface } from "../../interface/InterfaceProvider";
import { useI18n } from "../../i18n";
import EditorIcon from "./EditorIcon";

export default function ThemeToggle() {
  const { update } = useInterface(), { t } = useI18n();
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === "dark"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const label = t("desktop.themeToggle", { next: t(dark ? "interface.light" : "interface.dark") });
  return <button type="button" className="app-menu-button theme-toggle" aria-label={label} title={label}
    onClick={() => update(p => ({ ...p, theme: dark ? "light" : "dark" }))}>
    <EditorIcon name={dark ? "moon" : "sun"} size={15}/>
  </button>;
}
