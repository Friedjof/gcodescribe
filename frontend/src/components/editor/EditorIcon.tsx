const PATHS = {
  bell: "M18 8a6 6 0 0 0-12 0v5l-2 4h16l-2-4V8ZM10 21h4",
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9", settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  tabs: "M3 7V4h7l2 3h9v13H3V7ZM3 7h18", more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "m6 6 12 12M6 18 18 6", up: "m6 14 6-6 6 6", down: "m6 10 6 6 6-6",
  pages: "M6 3h9l4 4v14H6V3ZM15 3v5h4M3 7v14", panel: "M3 4h18v16H3V4ZM15 4v16",
  undo: "M8 4 3 9l5 5M3 9h10a7 7 0 0 1 7 7", redo: "m16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7",
  help: "M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0",
  select: "m5 3 14 10-7 1-3 7L5 3Z", hand: "M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v9a6 6 0 0 1-11 3l-5-6a2 2 0 0 1 3-2l1 2",
  draw: "m4 16 12-12 4 4L8 20H4v-4ZM14 6l4 4", shape: "M4 4h16v16H4V4Z", text: "M4 5h16M12 5v15M8 20h8",
  line: "m4 20 16-16", preview: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  play: "m8 4 12 8-12 8V4Z", check: "m5 12 4 4L19 6", add: "M12 4v16M4 12h16", folder: "M3 5h7l2 3h9v12H3V5Z",
  image: "M3 4h18v16H3V4Zm0 13 6-6 4 4 3-3 5 5M8 8h.01", grid: "M3 3h18v18H3V3ZM3 9h18M3 15h18M9 3v18M15 3v18",
  measure: "m3 17 14-14 4 4L7 21l-4-4ZM7 13l3 3M11 9l3 3M15 5l3 3", sun: "M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
} as const;
export type EditorIconName = keyof typeof PATHS;
export default function EditorIcon({ name, size = 18 }: { name: EditorIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>;
}
