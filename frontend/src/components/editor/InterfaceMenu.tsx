import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useInterface } from "../../interface/InterfaceProvider";
import type { Experience, InterfaceDensity, ThemePreference } from "../../interface/preferences";
import EditorIcon from "./EditorIcon";
export default function InterfaceMenu({ onCustomize }: { onCustomize: () => void }) {
  const { t } = useI18n(), { preferences, update } = useInterface();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [open]);
  return <div className="interface-menu" ref={root}>
    <button type="button" className="app-menu-button" aria-label={t("interface.view")} title={t("interface.view")} aria-expanded={open} onClick={() => setOpen(!open)}>{t("interface.view")}</button>
    {open && <div className="interface-menu-popover">
      <label>{t("interface.appearance")}<select value={preferences.theme} onChange={event => update(prefs => ({ ...prefs, theme: event.target.value as ThemePreference }))}>
        <option value="light">{t("interface.light")}</option><option value="dark">{t("interface.dark")}</option><option value="system">{t("interface.system")}</option></select></label>
      <label>{t("interface.density")}<select value={preferences.density} onChange={event => update(prefs => ({ ...prefs, density: event.target.value as InterfaceDensity }))}>
        <option value="comfortable">{t("interface.comfortable")}</option><option value="compact">{t("interface.compact")}</option></select></label>
      <label>{t("interface.experience")}<select value={preferences.experience} onChange={event => update(prefs => ({ ...prefs, experience: event.target.value as Experience }))}>
        <option value="guided">{t("interface.guided")}</option><option value="full">{t("interface.full")}</option></select></label>
      <button onClick={() => { setOpen(false); onCustomize(); }}><EditorIcon name="tabs" size={16} />{t("interface.customizeTabs")}</button>
    </div>}
  </div>;
}
