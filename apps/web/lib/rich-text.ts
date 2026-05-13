// Minimal plaintext extractor for tldraw v4's TipTap rich-text documents.
// Avoids dragging the editor reference into scene-sync just to flatten text.

type TipTapNode = {
  type?: string;
  text?: string;
  content?: TipTapNode[];
};

export function richTextToPlain(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: string[] = [];
  walk(value as TipTapNode, out);
  const joined = out.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

function walk(node: TipTapNode | undefined, out: string[]): void {
  if (!node) return;
  if (typeof node.text === "string") out.push(node.text);
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, out);
  }
}
