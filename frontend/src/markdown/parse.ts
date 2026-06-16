// Minimal block-level Markdown parser for the designer's markdown editor.
// No external dependency: we only support the constructs that make sense for a
// pen plotter (headings, paragraphs, lists) and reduce inline emphasis to plain
// runs so the same AST can drive both the reading preview (React elements) and
// the plot geometry (flat text).

export type BlockKind = "h1" | "h2" | "h3" | "p" | "li";

export interface Block {
  kind: BlockKind;
  /** Inline tokens of the block's content (already trimmed). */
  inline: InlineToken[];
  /** List ordinal for ordered items (1-based); undefined for bullets/others. */
  ordinal?: number;
}

export type InlineToken =
  | { kind: "text" | "strong" | "em" | "code"; text: string }
  | { kind: "link"; text: string; href: string };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;

/** Parse Markdown source into a flat list of blocks. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    // A single newline is a hard line break (text continues on the next line);
    // a blank line starts a new paragraph block (handled by flushing here).
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ kind: "p", inline: parseInline(text) });
    paragraph = [];
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ kind: `h${level}` as BlockKind, inline: parseInline(heading[2].trim()) });
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      flush();
      blocks.push({ kind: "li", inline: parseInline(ordered[2].trim()), ordinal: Number(ordered[1]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: "li", inline: parseInline(bullet[1].trim()) });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

/** Tokenize inline emphasis. Unmatched markers stay as literal text. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text))) {
    if (match.index > last) tokens.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[2] != null) tokens.push({ kind: "strong", text: match[2] });
    else if (match[4] != null) tokens.push({ kind: "em", text: match[4] });
    else if (match[5] != null) tokens.push({ kind: "code", text: match[5] });
    else if (match[6] != null) tokens.push({ kind: "link", text: match[6], href: match[7] });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens.length ? tokens : [{ kind: "text", text }];
}

/** Flatten inline tokens to plain text for geometry generation. */
export function inlineText(tokens: InlineToken[]): string {
  return tokens.map((tok) => tok.text).join("");
}

/** Full plain text of a block including its list prefix. */
export function blockPlainText(block: Block): string {
  const body = inlineText(block.inline);
  if (block.kind !== "li") return body;
  return block.ordinal != null ? `${block.ordinal}. ${body}` : `• ${body}`;
}
