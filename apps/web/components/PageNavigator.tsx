"use client";

import { useEffect, useState } from "react";
import type { Editor, TLPageId } from "tldraw";

type PageNavigatorProps = {
  editor: Editor | null;
};

type PageEntry = { id: string; name: string };

const POLL_MS = 250;

/**
 * Compact page tabs at the bottom-left of the canvas. Mirrors tldraw's page
 * state so a click switches pages, and a "+ Page" chip creates a new one.
 * Polls editor state because tldraw's TS bindings don't expose a simple
 * "page list changed" event we can subscribe to.
 */
export function PageNavigator({ editor }: PageNavigatorProps) {
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [currentId, setCurrentId] = useState<string>("");

  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      const next = editor.getPages().map((p) => ({
        id: p.id as string,
        name: p.name,
      }));
      const cur = editor.getCurrentPageId() as string;
      setPages((prev) => {
        if (
          prev.length === next.length &&
          prev.every((p, i) => {
            const n = next[i];
            return n !== undefined && p.id === n.id && p.name === n.name;
          })
        ) {
          return prev;
        }
        return next;
      });
      setCurrentId(cur);
    };
    refresh();
    const cleanup = editor.store.listen(refresh, { scope: "all" });
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, [editor]);

  if (!editor) return null;

  const switchTo = (id: string) => {
    editor.setCurrentPage(id as TLPageId);
  };

  const createPage = () => {
    const before = new Set(editor.getPages().map((p) => p.id as string));
    editor.createPage({ name: `Page ${before.size + 1}` });
    const created = editor
      .getPages()
      .find((p) => !before.has(p.id as string));
    if (created) editor.setCurrentPage(created.id);
  };

  return (
    <div className="pointer-events-auto absolute bottom-20 left-4 z-10 flex max-w-[60vw] flex-wrap items-center gap-1.5 rounded-2xl border border-white/10 bg-black/60 p-1.5 shadow-lg backdrop-blur">
      {pages.map((p) => {
        const isActive = p.id === currentId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => switchTo(p.id)}
            title={p.name}
            className={
              "max-w-[12rem] truncate rounded-xl px-3 py-1 text-xs transition-colors " +
              (isActive
                ? "bg-emerald-400 text-black"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")
            }
          >
            {p.name}
          </button>
        );
      })}
      <button
        type="button"
        onClick={createPage}
        title="Add page"
        className="rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
      >
        + Page
      </button>
    </div>
  );
}
