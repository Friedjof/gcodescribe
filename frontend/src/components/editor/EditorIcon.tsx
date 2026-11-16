const PATHS = {
  search: "M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  dice: "M3 3h18v18H3V3ZM7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01",
  previous: "m15 5-7 7 7 7", next: "m9 5 7 7-7 7", map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16",
  open: "M14 3h7v7M21 3 10 14M10 3H3v18h18v-7",
  grip: "M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01",
  plug: "M8 2v5M16 2v5M5 7h14v4a7 7 0 0 1-14 0V7ZM12 18v4",
  copy: "M8 3h13v13H8V3ZM3 8v13h13",
  cut: "m8 8 12 12M8 16 20 4M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  paste: "M9 5H5v16h14V5h-4M9 3h6v4H9V3Z",
  trash: "M3 6h18M9 3h6M6 6l1 15h10l1-15M10 10v7M14 10v7",
  center: "M12 2v20M2 12h20M6 6h12v12H6V6Z",
  fit: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M7 7h10v10H7V7Z",
  group: "M3 3h7v7H3V3ZM14 14h7v7h-7v-7ZM14 3h7v7h-7V3ZM3 14h7v7H3v-7Z",
  circle: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  semicircle: "M3 12a9 9 0 1 1 18 0H3Z",
  eraser: "m3 14 11-11 7 7-11 11H8l-5-7ZM9 8l7 7M10 21h11",
  bucket: "m4 11 8-8 9 9-8 8-9-9ZM4 11h17M10 3l-3-3M3 17l-2 4h4l-2-4Z",

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
  return <svg className="editor-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>;
}
