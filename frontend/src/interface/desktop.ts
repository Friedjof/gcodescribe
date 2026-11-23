import type { ThemePreference } from "./preferences";

declare global {
  interface Window {
    __GCODESCRIBE_DESKTOP__?: { dark: boolean };
    webkit?: { messageHandlers?: { gcsAppearance?: { postMessage: (theme: string) => void } } };
  }
}
export const isDesktop = () => typeof window !== "undefined" && (
  !!window.__GCODESCRIBE_DESKTOP__ || document.documentElement.dataset.desktop === "true"
);
export const systemIsDark = () => window.__GCODESCRIBE_DESKTOP__?.dark
  ?? window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
export const syncDesktopTheme = (theme: ThemePreference) => {
  window.webkit?.messageHandlers?.gcsAppearance?.postMessage(theme);
};
