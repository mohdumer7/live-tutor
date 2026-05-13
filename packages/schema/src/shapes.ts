import { z } from "zod";

// `shape:<ulid>` — the agent never has to invent these. Every create tool
// returns one and every mutate tool takes one.
export const shapeIdSchema = z
  .string()
  .min(1)
  .describe("Stable id of a shape on the canvas, e.g. 'shape:abc123'");

export const shapeKindSchema = z.enum([
  "text",
  "equation", // Phase 4
  "stroke", // Phase 4
  "rect", // Phase 4
  "circle", // Phase 4
  "arrow", // Phase 4
  "plot", // Phase 4
  "image", // Phase 5
  "svg", // Phase 5
  "highlight", // Phase 4
]);

export type ShapeKind = z.infer<typeof shapeKindSchema>;

// Compact summary of a shape — what the agent sees in scene digests. Keep
// this small: one row per shape, no nested geometry data.
export const shapeSummarySchema = z.object({
  id: shapeIdSchema,
  kind: shapeKindSchema,
  // Center point (page coordinates).
  x: z.number(),
  y: z.number(),
  // Bounding box, relative to the shape's own frame.
  w: z.number(),
  h: z.number(),
  // Type-specific brief — e.g. text content, equation source, image prompt.
  summary: z.string().optional(),
  createdBy: z.enum(["agent", "student"]).default("agent"),
  // Optional semantic label the agent attached via `label_shape` in Phase 4.
  label: z.string().optional(),
});

export type ShapeSummary = z.infer<typeof shapeSummarySchema>;

// What the student is currently paying attention to. The FE refreshes this
// whenever selection, hover, viewport, or pointer changes — so when the
// student says "here / there / this", the agent can read this block instead
// of having to guess.
export const focusSchema = z.object({
  // The visible area in canvas page space.
  viewport: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    zoom: z.number(),
  }),
  // Shapes the student has explicitly selected.
  selectedIds: z.array(z.string()),
  // Shape currently under the student's cursor, if any.
  hoveredId: z.string().optional(),
  // Last-known cursor location in page space (helps with "here").
  cursor: z
    .object({ x: z.number(), y: z.number() })
    .optional(),
  // Last few shapes that were created or modified — useful for "this", "that",
  // "the one I just drew". Most recent first, capped at ~8 entries.
  recentlyTouchedIds: z.array(z.string()),
});
export type Focus = z.infer<typeof focusSchema>;

// Compact summary of one whiteboard page.
export const pageSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  shapeCount: z.number().int().nonnegative(),
});
export type PageSummary = z.infer<typeof pageSummarySchema>;

// Full scene snapshot the FE publishes whenever shapes change.
export const sceneDigestSchema = z.object({
  version: z.number().int().nonnegative(),
  shapes: z.array(shapeSummarySchema),
  focus: focusSchema,
  pages: z.array(pageSummarySchema).default([]),
  currentPageId: z.string().default(""),
});

export type SceneDigest = z.infer<typeof sceneDigestSchema>;
