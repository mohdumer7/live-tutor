"use client";

import type { Editor, TLShape } from "tldraw";
import type { Room } from "livekit-client";
import {
  TOPIC_SCENE_STATE,
  TOPIC_STUDENT_DREW,
  type Focus,
  type SceneStateEnvelope,
  type ShapeKind,
  type ShapeSummary,
  type StudentDrewEnvelope,
} from "@live-tutor/schema";
import { richTextToPlain } from "./rich-text";

const PUBLISH_DEBOUNCE_MS = 250;
const MAX_RECENTLY_TOUCHED = 8;
// How long we wait after the last student-drawn shape was added before
// nudging the agent. Long enough to capture multi-stroke writing (someone
// writing "x²+1" lifts the pen between strokes), short enough to feel live.
const STUDENT_DREW_DEBOUNCE_MS = 1500;
const encoder = new TextEncoder();

/**
 * Subscribes to tldraw store changes and publishes a compact scene digest
 * (shapes + focus block) to the agent over the LiveKit data channel.
 * Debounced so a flurry of edits coalesces into one publish.
 *
 * The focus block answers "what is the student looking at right now" so the
 * tutor can correctly interpret "here / there / this".
 */
export function wireSceneSync(room: Room, editor: Editor): () => void {
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const recentlyTouched: string[] = [];

  // Buffer of student-drawn shape ids accumulating since the last nudge,
  // plus the timer that flushes them once the student pauses.
  const pendingStudentShapeIds = new Set<string>();
  let studentDrewTimer: ReturnType<typeof setTimeout> | null = null;

  const touch = (ids: Iterable<string>) => {
    for (const id of ids) {
      const idx = recentlyTouched.indexOf(id);
      if (idx !== -1) recentlyTouched.splice(idx, 1);
      recentlyTouched.unshift(id);
    }
    if (recentlyTouched.length > MAX_RECENTLY_TOUCHED) {
      recentlyTouched.length = MAX_RECENTLY_TOUCHED;
    }
  };

  const forget = (ids: Iterable<string>) => {
    for (const id of ids) {
      const idx = recentlyTouched.indexOf(id);
      if (idx !== -1) recentlyTouched.splice(idx, 1);
    }
  };

  const publish = () => {
    timer = null;
    const shapes = collectShapeSummaries(editor);
    const focus = readFocus(editor, recentlyTouched);
    const pages = editor.getPages().map((p) => ({
      id: p.id as string,
      name: p.name,
      // Cheap shape count — querying ids per page; tldraw caches.
      shapeCount: editor.getPageShapeIds(p.id as never).size,
    }));
    const currentPageId = editor.getCurrentPageId() as string;
    version += 1;
    const envelope: SceneStateEnvelope = {
      kind: "scene_state",
      digest: { version, shapes, focus, pages, currentPageId },
    };
    void room.localParticipant.publishData(
      encoder.encode(JSON.stringify(envelope)),
      { reliable: true, topic: TOPIC_SCENE_STATE },
    );
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(publish, PUBLISH_DEBOUNCE_MS);
  };

  // Initial publish so the agent has state from t=0.
  publish();

  // Flush the pending student-drew nudge: emit a single envelope covering
  // all the shape ids that landed in the debounce window.
  const flushStudentDrew = () => {
    studentDrewTimer = null;
    if (pendingStudentShapeIds.size === 0) return;
    const ids = [...pendingStudentShapeIds];
    pendingStudentShapeIds.clear();

    // Compute a union bounding box over the affected shapes. If a shape was
    // deleted between buffer and flush we just skip it.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const id of ids) {
      const b = editor.getShapePageBounds(id as never);
      if (!b) continue;
      any = true;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    if (!any) return;

    const env: StudentDrewEnvelope = {
      kind: "student_drew",
      shapeIds: ids,
      bounds: {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      },
      timestamp: Date.now(),
    };
    void room.localParticipant.publishData(
      encoder.encode(JSON.stringify(env)),
      { reliable: true, topic: TOPIC_STUDENT_DREW },
    );
  };

  const scheduleStudentDrew = () => {
    if (studentDrewTimer) clearTimeout(studentDrewTimer);
    studentDrewTimer = setTimeout(flushStudentDrew, STUDENT_DREW_DEBOUNCE_MS);
  };

  // Document-level changes (shapes added/updated/removed).
  const cleanupShapes = editor.store.listen(
    ({ changes, source }) => {
      // Update the recently-touched buffer based on what changed.
      const added = Object.keys(changes.added ?? {}).filter((k) =>
        k.startsWith("shape:"),
      );
      const updated = Object.keys(changes.updated ?? {}).filter((k) =>
        k.startsWith("shape:"),
      );
      const removed = Object.keys(changes.removed ?? {}).filter((k) =>
        k.startsWith("shape:"),
      );
      if (removed.length) forget(removed);
      if (added.length) touch(added);
      if (updated.length) touch(updated);
      if (added.length + updated.length + removed.length > 0) schedule();

      // tldraw's store emits source='user' for direct interactions (pen,
      // shape tools, drag). Agent-driven createShape calls come through with
      // source='user' too in our setup, but they're tagged createdBy='agent'
      // in meta — filter on that to identify genuine student strokes.
      if (source !== "user") return;
      for (const id of added) {
        const shape = editor.getShape(id as never);
        if (!shape) continue;
        const meta = shape.meta as { createdBy?: unknown } | undefined;
        if (meta?.createdBy === "agent") continue;
        // Only proactively notify for ink-style strokes; geo/arrow/etc. that
        // the student drags out get caught via scene digest naturally.
        if (shape.type !== "draw") continue;
        pendingStudentShapeIds.add(id);
      }
      if (pendingStudentShapeIds.size > 0) scheduleStudentDrew();
    },
    { scope: "document" },
  );

  // Session-level changes (selection, camera, hover) — these don't change
  // shapes but still affect the focus block. The 'session' scope also fires
  // on camera moves (pan/zoom), so we don't need a separate poll for that.
  const cleanupSession = editor.store.listen(schedule, { scope: "session" });

  return () => {
    if (timer) clearTimeout(timer);
    if (studentDrewTimer) clearTimeout(studentDrewTimer);
    cleanupShapes();
    cleanupSession();
  };
}

function readFocus(editor: Editor, recentlyTouched: string[]): Focus {
  const cam = editor.getCamera();
  const vp = editor.getViewportPageBounds();
  const selectedIds = editor.getSelectedShapeIds().map((id) => id);
  const hoveredId = editor.getHoveredShapeId() ?? undefined;
  const cursor = editor.inputs.currentPagePoint
    ? {
        x: editor.inputs.currentPagePoint.x,
        y: editor.inputs.currentPagePoint.y,
      }
    : undefined;

  return {
    viewport: { x: vp.x, y: vp.y, w: vp.w, h: vp.h, zoom: cam.z },
    selectedIds,
    hoveredId,
    cursor,
    recentlyTouchedIds: [...recentlyTouched],
  };
}

function collectShapeSummaries(editor: Editor): ShapeSummary[] {
  // Filter out skeleton placeholders — they're transient loading indicators
  // and would just pollute the scene digest the agent reads. The agent
  // already knows it placed a skeleton (it's the one that asked for it).
  const shapes = [...editor.getCurrentPageShapes()].filter(
    (s) => (s.type as string) !== "skeleton",
  );
  return shapes.map((s) => toSummary(editor, s));
}

function toSummary(editor: Editor, shape: TLShape): ShapeSummary {
  const bounds = editor.getShapePageBounds(shape.id);
  const kind = mapKind(shape.type);
  const summary = extractSummary(shape);
  const meta = shape.meta as
    | { label?: unknown; createdBy?: unknown }
    | undefined;
  // Anything the dispatcher creates is tagged createdBy='agent'. Untagged
  // shapes were drawn by the student via tldraw's native pen / shape tools.
  const createdBy: "agent" | "student" =
    meta?.createdBy === "agent" ? "agent" : "student";
  return {
    id: shape.id,
    kind,
    x: bounds?.x ?? shape.x,
    y: bounds?.y ?? shape.y,
    w: bounds?.w ?? getDimension(shape, "w"),
    h: bounds?.h ?? getDimension(shape, "h"),
    summary,
    label: typeof meta?.label === "string" ? meta.label : undefined,
    createdBy,
  };
}

function mapKind(type: string): ShapeKind {
  switch (type) {
    case "text":
      return "text";
    case "draw":
      return "stroke";
    case "geo":
      return "rect";
    case "arrow":
      return "arrow";
    case "highlight":
      return "highlight";
    case "image":
      return "image";
    case "equation":
      return "equation";
    case "plot":
      return "plot";
    case "svg":
      return "svg";
    case "video-tutor":
      return "image"; // closest existing kind in the schema enum
    case "minigame":
      return "svg"; // bucket as an interactive embed
    case "curriculum":
      return "text"; // bucket curriculum panel as text-heavy in the digest
    default:
      return "rect";
  }
}

function getDimension(shape: TLShape, key: "w" | "h"): number {
  const props = shape.props as Record<string, unknown> | undefined;
  if (props && typeof props[key] === "number") return props[key] as number;
  return 0;
}

function extractSummary(shape: TLShape): string | undefined {
  // tldraw's TLShape union doesn't include our custom types; cast for the
  // comparison and prop access.
  const looseShape = shape as unknown as { type: string; props: unknown };

  // Curriculum gets a compact, status-bearing summary so the agent sees
  // exactly where it is in the lesson on every turn.
  if (looseShape.type === "curriculum") {
    const props = looseShape.props as {
      title?: unknown;
      modules?: Array<{ status?: unknown; title?: unknown }>;
    };
    const modules = props.modules ?? [];
    const statusGlyph = (s: unknown): string =>
      s === "complete" ? "✓" : s === "in_progress" ? "◐" : "○";
    const trail = modules.map((m) => statusGlyph(m.status)).join("");
    const activeIndex = modules.findIndex(
      (m) => m.status === "in_progress",
    );
    const active = activeIndex >= 0 ? modules[activeIndex] : undefined;
    const title =
      typeof props.title === "string" ? props.title : "Lesson plan";
    const activeTitle =
      active && typeof active.title === "string"
        ? ` · now: ${active.title}`
        : "";
    return `${title} · ${trail}${activeTitle}`.slice(0, 200);
  }

  const props = shape.props as
    | { richText?: unknown; text?: unknown }
    | undefined;
  const fromRich = richTextToPlain(props?.richText);
  if (fromRich) return fromRich.slice(0, 80);
  if (typeof props?.text === "string") return props.text.slice(0, 80);
  return undefined;
}
