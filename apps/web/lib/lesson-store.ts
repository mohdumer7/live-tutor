"use client";

import type { Editor } from "tldraw";

const STORAGE_PREFIX = "live-tutor.lesson.";
const SAVE_DEBOUNCE_MS = 1000;
const SCHEMA_VERSION = 1;

export type LessonMeta = {
  subject?: string;
  grade?: string;
  topic?: string;
};

type StoredLesson = {
  v: number;
  roomId: string;
  meta: LessonMeta;
  // tldraw v4's getSnapshot returns a typed object; we serialize as JSON.
  snapshot: unknown;
  lastSavedAt: number;
};

export type RecentLesson = {
  roomId: string;
  meta: LessonMeta;
  lastSavedAt: number;
  shapeCount: number;
};

const isBrowser = typeof window !== "undefined";

function key(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

/**
 * Save a tldraw snapshot under the given room id. Side-effect free: silently
 * tolerates quota errors (storage full, private mode) by no-oping with a
 * warning.
 */
export function saveLesson(
  roomId: string,
  editor: Editor,
  meta: LessonMeta,
): void {
  if (!isBrowser) return;
  try {
    const snapshot = editor.getSnapshot();
    const payload: StoredLesson = {
      v: SCHEMA_VERSION,
      roomId,
      meta,
      snapshot,
      lastSavedAt: Date.now(),
    };
    window.localStorage.setItem(key(roomId), JSON.stringify(payload));
  } catch (err) {
    console.warn("[lesson-store] save failed:", err);
  }
}

/**
 * Load a previously-saved snapshot for a room. Returns null if there's no
 * record, or if it's a different schema version we don't understand.
 */
export function loadLesson(roomId: string): StoredLesson | null {
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem(key(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLesson;
    if (parsed.v !== SCHEMA_VERSION) return null;
    return parsed;
  } catch (err) {
    console.warn("[lesson-store] load failed:", err);
    return null;
  }
}

/**
 * List all saved lessons, most recent first. Used by the landing page's
 * "Resume" section.
 */
export function listRecentLessons(limit = 6): RecentLesson[] {
  if (!isBrowser) return [];
  const out: RecentLesson[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as StoredLesson;
        if (parsed.v !== SCHEMA_VERSION) continue;
        const snapshot = parsed.snapshot as
          | { document?: { store?: Record<string, { typeName?: string }> } }
          | undefined;
        const records = snapshot?.document?.store ?? {};
        const shapeCount = Object.values(records).filter(
          (r) => r?.typeName === "shape",
        ).length;
        out.push({
          roomId: parsed.roomId,
          meta: parsed.meta,
          lastSavedAt: parsed.lastSavedAt,
          shapeCount,
        });
      } catch {
        /* skip corrupt entry */
      }
    }
  } catch (err) {
    console.warn("[lesson-store] list failed:", err);
  }
  out.sort((a, b) => b.lastSavedAt - a.lastSavedAt);
  return out.slice(0, limit);
}

/** Forget a single saved lesson — used by the "Forget" button. */
export function deleteLesson(roomId: string): void {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(key(roomId));
  } catch (err) {
    console.warn("[lesson-store] delete failed:", err);
  }
}

/**
 * Subscribe to tldraw store changes and auto-save the canvas snapshot under
 * the given room id, debounced. Returns a cleanup function.
 */
export function wireLessonAutoSave(
  roomId: string,
  editor: Editor,
  meta: LessonMeta,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    saveLesson(roomId, editor, meta);
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  // Save once immediately so a brand-new lesson is recorded even if the
  // student leaves before drawing anything.
  saveLesson(roomId, editor, meta);

  const cleanupDoc = editor.store.listen(schedule, { scope: "document" });
  const cleanupSession = editor.store.listen(schedule, { scope: "session" });

  return () => {
    if (timer) clearTimeout(timer);
    cleanupDoc();
    cleanupSession();
    // Final write before the listener detaches (e.g. on session disconnect).
    saveLesson(roomId, editor, meta);
  };
}
