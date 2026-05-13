"use client";

import type { Editor, TLShapeId, TLShapePartial } from "tldraw";
import {
  AssetRecordType,
  createShapeId,
  getHashForString,
  toRichText,
} from "tldraw";
import type { Room } from "livekit-client";
import {
  TOPIC_TOOL_CALL,
  TOPIC_TOOL_RESULT,
  toolCallEnvelope,
  type ToolCallEnvelope,
  type ToolResultEnvelope,
} from "@live-tutor/schema";
import { richTextToPlain } from "./rich-text";

/**
 * Wires the agent's tool-call data channel to the tldraw editor.
 *
 * Listens on the LiveKit room's data channel for `tool_call` envelopes,
 * validates them with Zod, applies the requested operation via tldraw's
 * Editor API, and publishes a `tool_result` envelope back so the agent
 * can resolve its pending RPC.
 *
 * Returns a cleanup function that removes listeners.
 */
export function wireCanvasDispatcher(
  room: Room,
  editor: Editor,
  options: {
    onPointAt?: (target: { x: number; y: number; durationMs: number }) => void;
  } = {},
): () => void {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const handler = (
    payload: Uint8Array,
    _participant: unknown,
    _kind: unknown,
    topic?: string,
  ) => {
    if (topic !== TOPIC_TOOL_CALL) return;

    let envelope: ToolCallEnvelope;
    try {
      const json = JSON.parse(decoder.decode(payload));
      envelope = toolCallEnvelope.parse(json);
    } catch (err) {
      console.warn("[dispatcher] invalid tool_call envelope:", err);
      return;
    }

    handleToolCall(editor, envelope, options)
      .then((result) => publishResult(room, encoder, result))
      .catch((err) => {
        console.error("[dispatcher] tool execution threw:", err);
        publishResult(room, encoder, {
          kind: "tool_result",
          callId: envelope.callId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };

  // livekit-client's `dataReceived` callback signature has variants — cast
  // through unknown to avoid the overload mismatch.
  room.on(
    "dataReceived" as Parameters<Room["on"]>[0],
    handler as unknown as Parameters<Room["on"]>[1],
  );

  return () => {
    room.off(
      "dataReceived" as Parameters<Room["off"]>[0],
      handler as unknown as Parameters<Room["off"]>[1],
    );
  };
}

// Wrapper that stamps every dispatcher-created shape with createdBy='agent'.
// scene-sync reads this in toSummary so the agent (and the digest text view)
// can distinguish its own work from student-drawn shapes.
function createAgentShape(editor: Editor, partial: TLShapePartial): void {
  const existing =
    (partial as { meta?: Record<string, unknown> }).meta ?? {};
  editor.createShape({
    ...(partial as Record<string, unknown>),
    meta: { ...existing, createdBy: "agent" },
  } as unknown as TLShapePartial);
}

async function handleToolCall(
  editor: Editor,
  envelope: ToolCallEnvelope,
  options: {
    onPointAt?: (target: { x: number; y: number; durationMs: number }) => void;
  },
): Promise<ToolResultEnvelope> {
  const { callId, payload } = envelope;

  switch (payload.tool) {
    case "create_text": {
      const id = createShapeId();
      // Estimate text shape size for overlap detection. Real text shapes
      // size to content but we don't know the rendered metrics until
      // after tldraw lays them out.
      const estW = Math.max(80, Math.min(480, payload.args.text.length * 9));
      const estH = (payload.args.fontSize ?? 28) + 12;
      const placed = placeArgs(editor, payload.args, { w: estW, h: estH });
      createAgentShape(editor, {
        id,
        type: "text",
        x: placed.x,
        y: placed.y,
        props: {
          // tldraw v4 stores text as a TipTap document under `richText`. The
          // exported `toRichText(string)` builds a minimal valid one for us.
          richText: toRichText(payload.args.text),
          color: mapColor(payload.args.color),
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [
          placed.warning,
          offscreenWarning(placed.x, placed.y),
        ]),
      };
    }

    case "update_shape": {
      const id = payload.args.id as TLShapeId;
      const shape = editor.getShape(id);
      if (!shape) return shapeNotFound(callId, id);
      const update: Record<string, unknown> = { id, type: shape.type };
      if (typeof payload.args.x === "number") update.x = payload.args.x;
      if (typeof payload.args.y === "number") update.y = payload.args.y;
      const propPatch: Record<string, unknown> = {};
      if (typeof payload.args.text === "string")
        propPatch.richText = toRichText(payload.args.text);
      if (payload.args.color) propPatch.color = mapColor(payload.args.color);
      if (Object.keys(propPatch).length > 0) update.props = propPatch;
      editor.updateShape(update as unknown as TLShapePartial);
      return { kind: "tool_result", callId, ok: true, data: { ok: true } };
    }

    case "delete_shape": {
      const id = payload.args.id as TLShapeId;
      const shape = editor.getShape(id);
      if (!shape) return shapeNotFound(callId, id);
      editor.deleteShape(id);
      return { kind: "tool_result", callId, ok: true, data: { ok: true } };
    }

    case "clear_canvas": {
      const ids = editor.getCurrentPageShapeIds();
      if (ids.size > 0) editor.deleteShapes([...ids]);
      return { kind: "tool_result", callId, ok: true, data: { ok: true } };
    }

    case "point_at": {
      const target = resolvePointTarget(editor, payload.args);
      if (!target) return errResult(callId, "could not resolve point target");
      options.onPointAt?.(target);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: { ok: true },
      };
    }

    case "list_shapes": {
      const shapes = [...editor.getCurrentPageShapes()].map((s) => {
        const bounds = editor.getShapePageBounds(s.id);
        return {
          id: s.id,
          kind: s.type,
          x: bounds?.x ?? s.x,
          y: bounds?.y ?? s.y,
          w: bounds?.w,
          h: bounds?.h,
          summary: extractSummary(s),
        };
      });
      return { kind: "tool_result", callId, ok: true, data: { shapes } };
    }

    case "get_focus": {
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
        kind: "tool_result",
        callId,
        ok: true,
        data: {
          viewport: { x: vp.x, y: vp.y, w: vp.w, h: vp.h, zoom: cam.z },
          selectedIds,
          hoveredId,
          cursor,
        },
      };
    }

    case "create_shape": {
      const id = createShapeId();
      const args = payload.args;
      const placed = placeArgs(editor, args, { w: args.w, h: args.h });
      args.x = placed.x;
      args.y = placed.y;
      const warning = offscreenWarning(args.x, args.y, args.w, args.h);
      if (args.kind === "arrow" || args.kind === "line") {
        createAgentShape(editor, {
          id,
          type: "arrow",
          x: args.x,
          y: args.y,
          props: {
            start: { x: 0, y: 0 },
            end: { x: args.w, y: args.h },
            color: mapColor(args.color),
          } as Partial<Record<string, unknown>>,
        } as unknown as TLShapePartial);
      } else {
        // rect | ellipse → tldraw 'geo' shape with the right `geo` prop.
        const geo = args.kind === "ellipse" ? "ellipse" : "rectangle";
        createAgentShape(editor, {
          id,
          type: "geo",
          x: args.x,
          y: args.y,
          props: {
            geo,
            w: args.w,
            h: args.h,
            color: mapColor(args.color),
            fill: args.fill ?? "none",
          } as Partial<Record<string, unknown>>,
        } as unknown as TLShapePartial);
      }
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [placed.warning, warning]),
      };
    }

    case "create_highlight": {
      // Use a translucent geo rectangle. tldraw's first-class "highlight" is
      // limited to text strokes; a semi-filled yellow rect mimics a marker
      // overlay reliably.
      const id = createShapeId();
      const a = payload.args;
      createAgentShape(editor, {
        id,
        type: "geo",
        x: a.x,
        y: a.y,
        props: {
          geo: "rectangle",
          w: a.w,
          h: a.h,
          color: mapColor(a.color ?? "yellow"),
          fill: "semi",
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      // Send the highlight to the back so it doesn't cover labels.
      editor.sendToBack([id]);
      const warning = offscreenWarning(a.x, a.y, a.w, a.h);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: warning ? { id, warning } : { id },
      };
    }

    case "pan_to": {
      const a = payload.args;
      if (a.targetId) {
        const bounds = editor.getShapePageBounds(a.targetId as TLShapeId);
        if (!bounds) return errResult(callId, "could not resolve pan target");
        editor.zoomToBounds(bounds, { animation: { duration: 300 } });
      } else if (typeof a.x === "number" && typeof a.y === "number") {
        editor.centerOnPoint(
          { x: a.x, y: a.y },
          { animation: { duration: 300 } },
        );
        if (typeof a.zoom === "number") {
          editor.setCamera(
            { ...editor.getCamera(), z: a.zoom },
            { animation: { duration: 300 } },
          );
        }
      } else {
        return errResult(callId, "pan_to needs either targetId or x and y");
      }
      return { kind: "tool_result", callId, ok: true, data: { ok: true } };
    }

    case "zoom_to": {
      const z = payload.args.zoom;
      editor.setCamera(
        { ...editor.getCamera(), z },
        { animation: { duration: 300 } },
      );
      return { kind: "tool_result", callId, ok: true, data: { ok: true } };
    }

    case "create_equation": {
      const id = createShapeId();
      const a = payload.args;
      const w = a.w ?? 240;
      const h = a.h ?? 80;
      const placed = placeArgs(editor, { x: a.x, y: a.y, w, h }, { w, h });
      createAgentShape(editor, {
        id,
        type: "equation",
        x: placed.x,
        y: placed.y,
        props: {
          latex: a.latex,
          w,
          h,
          fontSize: a.fontSize ?? 36,
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [
          placed.warning,
          offscreenWarning(placed.x, placed.y, w, h),
        ]),
      };
    }

    case "create_plot": {
      const id = createShapeId();
      const a = payload.args;
      const placed = placeArgs(editor, a, { w: a.w, h: a.h });
      createAgentShape(editor, {
        id,
        type: "plot",
        x: placed.x,
        y: placed.y,
        props: {
          expression: a.expression,
          xMin: a.xMin,
          xMax: a.xMax,
          yMin: typeof a.yMin === "number" ? a.yMin : null,
          yMax: typeof a.yMax === "number" ? a.yMax : null,
          title: a.title ?? "",
          w: a.w,
          h: a.h,
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [
          placed.warning,
          offscreenWarning(placed.x, placed.y, a.w, a.h),
        ]),
      };
    }

    case "label_shape": {
      const id = payload.args.id as TLShapeId;
      const shape = editor.getShape(id);
      if (!shape) return shapeNotFound(callId, id);
      // tldraw stores arbitrary semantic data on `meta`. We persist the
      // tutor's label there so list_shapes / get_focus reads return it.
      editor.updateShape({
        id,
        type: shape.type,
        meta: { ...(shape.meta ?? {}), label: payload.args.label },
      } as unknown as TLShapePartial);
      return { kind: "tool_result", callId, ok: true, data: { ok: true } };
    }

    case "create_image": {
      const a = payload.args;
      // tldraw image shapes need a backing asset record. Hash the URL so the
      // same image isn't registered twice and shapes can share one asset.
      const assetId = AssetRecordType.createId(getHashForString(a.url));
      const existing = editor.getAsset(assetId);
      if (!existing) {
        editor.createAssets([
          {
            id: assetId,
            typeName: "asset",
            type: "image",
            meta: {},
            props: {
              name: a.alt ?? "tutor image",
              src: a.url,
              w: a.w,
              h: a.h,
              mimeType: "image/jpeg",
              isAnimated: false,
            },
          },
        ]);
      }
      const id = createShapeId();
      const placedImg = placeArgs(editor, a, { w: a.w, h: a.h });
      createAgentShape(editor, {
        id,
        type: "image",
        x: placedImg.x,
        y: placedImg.y,
        props: {
          assetId,
          w: a.w,
          h: a.h,
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [
          placedImg.warning,
          offscreenWarning(placedImg.x, placedImg.y, a.w, a.h),
        ]),
      };
    }

    case "create_svg": {
      const a = payload.args;
      const id = createShapeId();
      const placed = placeArgs(editor, a, { w: a.w, h: a.h });
      createAgentShape(editor, {
        id,
        type: "svg",
        x: placed.x,
        y: placed.y,
        props: {
          svg: a.svg,
          w: a.w,
          h: a.h,
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [
          placed.warning,
          offscreenWarning(placed.x, placed.y, a.w, a.h),
        ]),
      };
    }

    case "create_page": {
      const { name, switchTo } = payload.args;
      // tldraw assigns the page id internally when not provided.
      const before = new Set(editor.getPages().map((p) => p.id as string));
      editor.createPage({ name: name ?? `Page ${before.size + 1}` });
      const after = editor.getPages();
      const created = after.find((p) => !before.has(p.id as string));
      if (!created) {
        return errResult(callId, "tldraw did not return a new page");
      }
      if (switchTo) editor.setCurrentPage(created.id);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: {
          id: created.id as string,
          name: created.name,
          switched: switchTo,
        },
      };
    }

    case "switch_page": {
      const { pageId, name } = payload.args;
      const pages = editor.getPages();
      let target = pageId
        ? pages.find((p) => (p.id as string) === pageId)
        : undefined;
      if (!target && name) {
        const lower = name.toLowerCase();
        target = pages.find((p) => p.name.toLowerCase() === lower);
      }
      if (!target) {
        return errResult(
          callId,
          `Page not found. Call list_pages() to see ids and names.`,
        );
      }
      editor.setCurrentPage(target.id);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: { id: target.id as string, name: target.name },
      };
    }

    case "list_pages": {
      const pages = editor.getPages().map((p) => ({
        id: p.id as string,
        name: p.name,
      }));
      const currentId = editor.getCurrentPageId() as string;
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: { pages, currentId },
      };
    }

    case "create_curriculum": {
      const a = payload.args;
      const id = createShapeId();
      const placed = placeArgs(editor, a, { w: a.w, h: a.h });
      createAgentShape(editor, {
        id,
        type: "curriculum",
        x: placed.x,
        y: placed.y,
        props: {
          title: a.title,
          prerequisites: a.prerequisites,
          modules: a.modules,
          notes: a.notes,
          w: a.w,
          h: a.h,
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [placed.warning]),
      };
    }

    case "update_curriculum": {
      const id = payload.args.id as TLShapeId;
      const shape = editor.getShape(id);
      if (!shape) return shapeNotFound(callId, id);
      // tldraw's TLShape union doesn't include our custom shape types, so
      // cast through unknown to compare on `type`.
      const shapeType = (shape as unknown as { type: string }).type;
      if (shapeType !== "curriculum") {
        return errResult(
          callId,
          `shape ${id} is a ${shapeType}, not a curriculum`,
        );
      }
      const props = (shape as unknown as { props: unknown }).props as {
        modules?: Array<{
          title: string;
          objectives: string[];
          subtopics: string[];
          suggestedTools: string[];
          estimatedMinutes?: number;
          status: "pending" | "in_progress" | "complete";
        }>;
        notes?: string[];
        title?: string;
        prerequisites?: string[];
        w?: number;
        h?: number;
      };
      const nextModules = (props.modules ?? []).map((m, i) => {
        if (
          payload.args.moduleIndex === i &&
          payload.args.status !== undefined
        ) {
          return { ...m, status: payload.args.status };
        }
        return m;
      });
      const nextNotes = payload.args.note
        ? [...(props.notes ?? []), payload.args.note]
        : (props.notes ?? []);
      editor.updateShape({
        id,
        type: shapeType,
        props: {
          ...props,
          modules: nextModules,
          notes: nextNotes,
        },
      } as unknown as TLShapePartial);
      return { kind: "tool_result", callId, ok: true, data: { ok: true } };
    }

    case "create_video": {
      const a = payload.args;
      const id = createShapeId();
      const placed = placeArgs(editor, a, { w: a.w, h: a.h });
      createAgentShape(editor, {
        id,
        type: "video-tutor",
        x: placed.x,
        y: placed.y,
        props: {
          url: a.url,
          alt: a.alt ?? "tutor video",
          w: a.w,
          h: a.h,
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [
          placed.warning,
          offscreenWarning(placed.x, placed.y, a.w, a.h),
        ]),
      };
    }

    case "create_minigame": {
      const a = payload.args;
      const id = createShapeId();
      const placed = placeArgs(editor, a, { w: a.w, h: a.h });
      createAgentShape(editor, {
        id,
        type: "minigame",
        x: placed.x,
        y: placed.y,
        props: {
          html: a.html,
          title: a.title ?? "Minigame",
          description: a.description ?? "",
          w: a.w,
          h: a.h,
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: buildCreateData(id, [
          placed.warning,
          offscreenWarning(placed.x, placed.y, a.w, a.h),
        ]),
      };
    }

    case "create_skeleton": {
      const a = payload.args;
      const id = createShapeId();
      const placed = placeArgs(editor, a, { w: a.w, h: a.h });
      createAgentShape(editor, {
        id,
        type: "skeleton",
        x: placed.x,
        y: placed.y,
        props: {
          kind: a.kind,
          label: a.label ?? "",
          w: a.w,
          h: a.h,
        } as Partial<Record<string, unknown>>,
      } as unknown as TLShapePartial);
      // Skeletons return their actual placed coords so the agent can
      // remove the skeleton and drop the real content into the exact
      // same slot afterwards (no second nudge, no visual jump).
      return {
        kind: "tool_result",
        callId,
        ok: true,
        data: { id, x: placed.x, y: placed.y, w: a.w, h: a.h },
      };
    }

    case "replace_minigame_html": {
      const a = payload.args;
      const existing = editor.getShape(a.id as never) as unknown as
        | { type?: string; props?: { title?: string } }
        | undefined;
      if (!existing) {
        return errResult(callId, `shape ${a.id} not found`);
      }
      if (existing.type !== "minigame") {
        return errResult(callId, `shape ${a.id} is not a minigame`);
      }
      editor.updateShape({
        id: a.id,
        type: "minigame",
        props: {
          html: a.html,
          title: a.title ?? existing.props?.title ?? "Minigame",
        },
      } as unknown as TLShapePartial);
      return { kind: "tool_result", callId, ok: true, data: { id: a.id } };
    }

    case "look_at_canvas": {
      // Serialize the entire current page to a PNG data URL, then strip the
      // prefix so we can ship just the base64 payload to the agent.
      const ids = [...editor.getCurrentPageShapeIds()];
      if (ids.length === 0) {
        return errResult(callId, "canvas is empty");
      }
      try {
        const result = await editor.toImageDataUrl(ids, {
          format: "png",
          background: true,
          padding: 16,
          scale: 1,
        });
        const url = result.url;
        const comma = url.indexOf(",");
        const pngBase64 = comma > -1 ? url.slice(comma + 1) : url;
        return {
          kind: "tool_result",
          callId,
          ok: true,
          data: {
            pngBase64,
            width: Math.round(result.width),
            height: Math.round(result.height),
          },
        };
      } catch (err) {
        return errResult(
          callId,
          `canvas snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

function resolvePointTarget(
  editor: Editor,
  args: {
    targetId?: string;
    x?: number;
    y?: number;
    durationMs: number;
  },
): { x: number; y: number; durationMs: number } | null {
  if (args.targetId) {
    const shape = editor.getShape(args.targetId as TLShapeId);
    if (!shape) return null;
    const bounds = editor.getShapePageBounds(shape.id);
    if (!bounds) return null;
    const screen = editor.pageToScreen({
      x: bounds.center.x,
      y: bounds.center.y,
    });
    return { x: screen.x, y: screen.y, durationMs: args.durationMs };
  }
  if (typeof args.x === "number" && typeof args.y === "number") {
    const screen = editor.pageToScreen({ x: args.x, y: args.y });
    return { x: screen.x, y: screen.y, durationMs: args.durationMs };
  }
  return null;
}

function extractSummary(shape: { type: string; props?: unknown }): string | undefined {
  const props = shape.props as { richText?: unknown; text?: unknown } | undefined;
  const fromRich = richTextToPlain(props?.richText);
  if (fromRich) return fromRich.slice(0, 80);
  if (typeof props?.text === "string") return props.text.slice(0, 80);
  return undefined;
}

function publishResult(
  room: Room,
  encoder: TextEncoder,
  result: ToolResultEnvelope,
): void {
  const data = encoder.encode(JSON.stringify(result));
  void room.localParticipant.publishData(data, {
    reliable: true,
    topic: TOPIC_TOOL_RESULT,
  });
}

function errResult(callId: string, error: string): ToolResultEnvelope {
  return { kind: "tool_result", callId, ok: false, error };
}

/* ------------------------------------------------------------------------- */
/* Auto-layout: avoid overlapping existing shapes                              */
/* ------------------------------------------------------------------------- */

const PLACEMENT_PADDING = 16;
const MAX_NUDGE_ITERATIONS = 12;

type Box = { x: number; y: number; w: number; h: number };

function boxesIntersect(a: Box, b: Box): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

/**
 * Shift a requested (x,y) downward until the resulting bounding box no
 * longer overlaps any existing shape on the current page. Picks the
 * "lowest blocker" each iteration so the new shape lands just below
 * whatever it was about to crash into.
 *
 * Returns the adjusted coordinates and a `nudged` flag so callers can
 * surface that information to the model (which then learns to space
 * future shapes properly).
 */
function findFreeSpot(
  editor: Editor,
  requested: Box,
): { x: number; y: number; nudged: boolean } {
  const cur: Box = { ...requested };
  let nudged = false;

  for (let i = 0; i < MAX_NUDGE_ITERATIONS; i++) {
    let lowestBlocker: Box | null = null;
    for (const shape of editor.getCurrentPageShapes()) {
      const b = editor.getShapePageBounds(shape.id);
      if (!b) continue;
      const other: Box = { x: b.x, y: b.y, w: b.w, h: b.h };
      if (!boxesIntersect(cur, other)) continue;
      if (
        !lowestBlocker ||
        other.y + other.h > lowestBlocker.y + lowestBlocker.h
      ) {
        lowestBlocker = other;
      }
    }
    if (!lowestBlocker) break;
    cur.y = lowestBlocker.y + lowestBlocker.h + PLACEMENT_PADDING;
    nudged = true;
  }

  return { x: cur.x, y: cur.y, nudged };
}

/**
 * Common entry point each create_* case calls. Estimates the bounding box
 * from the args (using the supplied size or a fallback), runs the
 * auto-nudge, and returns coordinates ready for editor.createShape plus
 * a human-readable warning the model can act on.
 */
function placeArgs(
  editor: Editor,
  args: { x: number; y: number; w?: number; h?: number },
  fallbackSize: { w: number; h: number },
): { x: number; y: number; warning?: string } {
  const w = typeof args.w === "number" ? args.w : fallbackSize.w;
  const h = typeof args.h === "number" ? args.h : fallbackSize.h;
  const placed = findFreeSpot(editor, { x: args.x, y: args.y, w, h });
  const warning = placed.nudged
    ? `Position auto-adjusted from (${Math.round(args.x)}, ${Math.round(args.y)}) to (${Math.round(placed.x)}, ${Math.round(placed.y)}) to avoid overlapping existing shapes. Next time, check list_shapes() for current y-bottoms and pick a clear spot.`
    : undefined;
  return { x: placed.x, y: placed.y, warning };
}

/**
 * Merge multiple warning strings into the result.data payload, attaching
 * `id` and any other fields. Avoids the if/else ladders inside each case.
 */
function buildCreateData(
  id: string,
  warnings: Array<string | undefined>,
): Record<string, unknown> {
  const filtered = warnings.filter((w): w is string => Boolean(w));
  if (filtered.length === 0) return { id };
  return { id, warning: filtered.join(" ") };
}

/* ------------------------------------------------------------------------- */
/* A2: actionable error helpers                                                */
/* ------------------------------------------------------------------------- */

// Same shape as errResult but with a contextual hint the model can act on.
function shapeNotFound(callId: string, id: string): ToolResultEnvelope {
  return errResult(
    callId,
    `Shape ${id} not found — it may have just been deleted, or the id is hallucinated. Call list_shapes() to see current ids and try again.`,
  );
}

/* ------------------------------------------------------------------------- */
/* A5: coordinate sanity warning                                               */
/* ------------------------------------------------------------------------- */

// Generous bounding box in tldraw page space. Anything outside is almost
// certainly off the student's view and likely a hallucinated coordinate.
const COORD_LIMIT = 5000;

function offscreenWarning(
  x: number,
  y: number,
  w = 0,
  h = 0,
): string | undefined {
  if (
    x < -COORD_LIMIT ||
    y < -COORD_LIMIT ||
    x + w > COORD_LIMIT ||
    y + h > COORD_LIMIT
  ) {
    return `Heads up: this shape lands at (${Math.round(x)}, ${Math.round(y)}), far outside the typical view. The student may not see it without panning. Use get_focus() if you want to know what's currently on screen.`;
  }
  return undefined;
}

/* ------------------------------------------------------------------------- */
/* A3: tldraw color palette + soft-match aliases                                */
/* ------------------------------------------------------------------------- */

// tldraw's text/shape colors are a constrained set. Map any reasonable color
// name a model might emit to the closest one, instead of silently defaulting
// to black on unrecognized input.
const TLDRAW_COLORS = new Set([
  "black",
  "blue",
  "green",
  "grey",
  "light-blue",
  "light-green",
  "light-red",
  "light-violet",
  "orange",
  "red",
  "violet",
  "white",
  "yellow",
]);

const COLOR_ALIASES: Record<string, string> = {
  // grey
  gray: "grey",
  silver: "grey",
  charcoal: "grey",
  // blue family
  navy: "blue",
  indigo: "blue",
  cyan: "light-blue",
  turquoise: "light-blue",
  sky: "light-blue",
  azure: "light-blue",
  // green family
  teal: "green",
  emerald: "green",
  forest: "green",
  lime: "light-green",
  mint: "light-green",
  // red family
  crimson: "red",
  maroon: "red",
  scarlet: "red",
  pink: "light-red",
  rose: "light-red",
  salmon: "light-red",
  // violet family
  purple: "violet",
  magenta: "violet",
  lavender: "light-violet",
  lilac: "light-violet",
  // yellow / orange
  gold: "yellow",
  amber: "orange",
  tangerine: "orange",
  // misc
  brown: "orange",
  tan: "orange",
};

function mapColor(input: string | undefined): string {
  if (!input) return "black";
  const lower = input.toLowerCase().trim();
  if (TLDRAW_COLORS.has(lower)) return lower;
  if (lower in COLOR_ALIASES) return COLOR_ALIASES[lower] as string;
  // Strip "dark"/"light" prefixes the model might add.
  const stripped = lower.replace(/^(dark|light|bright|deep|pale)\s+/, "");
  if (TLDRAW_COLORS.has(stripped)) return stripped;
  if (stripped in COLOR_ALIASES) return COLOR_ALIASES[stripped] as string;
  return "black";
}
