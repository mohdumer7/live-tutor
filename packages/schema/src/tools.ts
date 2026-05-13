import { z } from "zod";
import { shapeIdSchema } from "./shapes";

// A safe color string. We don't enforce the format strictly — tldraw accepts
// CSS color names and hex.
const colorSchema = z.string().min(1).max(32).optional();

/* ------------------------------------------------------------------------- */
/* Phase 2 tool argument schemas                                              */
/* ------------------------------------------------------------------------- */

export const createTextArgs = z.object({
  text: z.string().min(1).max(500),
  x: z.number().describe("Page x coordinate (canvas space)."),
  y: z.number().describe("Page y coordinate (canvas space)."),
  fontSize: z.number().int().positive().max(256).optional(),
  color: colorSchema,
});
export type CreateTextArgs = z.infer<typeof createTextArgs>;

export const updateShapeArgs = z.object({
  id: shapeIdSchema,
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().max(500).optional(),
  color: colorSchema,
});
export type UpdateShapeArgs = z.infer<typeof updateShapeArgs>;

export const deleteShapeArgs = z.object({
  id: shapeIdSchema,
});
export type DeleteShapeArgs = z.infer<typeof deleteShapeArgs>;

export const clearCanvasArgs = z.object({}).strict();
export type ClearCanvasArgs = z.infer<typeof clearCanvasArgs>;

// NOTE: kept as a plain z.object — LiveKit's `llm.tool()` rejects `.refine`-
// wrapped schemas. The (targetId XOR x/y) invariant is checked at the tool
// execute boundary instead.
export const pointAtArgs = z.object({
  targetId: shapeIdSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  durationMs: z.number().int().positive().max(10_000).default(2000),
});
export type PointAtArgs = z.infer<typeof pointAtArgs>;

export const listShapesArgs = z.object({}).strict();
export type ListShapesArgs = z.infer<typeof listShapesArgs>;

/* ------------------------------------------------------------------------- */
/* Spatial awareness                                                          */
/* ------------------------------------------------------------------------- */

export const getFocusArgs = z.object({}).strict();
export type GetFocusArgs = z.infer<typeof getFocusArgs>;

/* ------------------------------------------------------------------------- */
/* Phase 4 rich primitives                                                    */
/* ------------------------------------------------------------------------- */

export const shapePrimitiveKind = z.enum([
  "rect",
  "ellipse", // includes "circle" — pass equal w + h
  "arrow",
  "line",
]);
export type ShapePrimitiveKind = z.infer<typeof shapePrimitiveKind>;

export const fillKind = z.enum(["none", "semi", "solid"]);
export type FillKind = z.infer<typeof fillKind>;

export const createShapeArgs = z.object({
  kind: shapePrimitiveKind,
  x: z.number().describe("Top-left x in page space."),
  y: z.number().describe("Top-left y in page space."),
  w: z.number().positive().max(10_000),
  h: z.number().positive().max(10_000),
  color: colorSchema,
  fill: fillKind.optional(),
});
export type CreateShapeArgs = z.infer<typeof createShapeArgs>;

export const createHighlightArgs = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(10_000),
  h: z.number().positive().max(10_000),
  color: colorSchema,
});
export type CreateHighlightArgs = z.infer<typeof createHighlightArgs>;

export const panToArgs = z.object({
  targetId: shapeIdSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  zoom: z.number().positive().max(8).optional(),
});
export type PanToArgs = z.infer<typeof panToArgs>;

export const zoomToArgs = z.object({
  zoom: z.number().positive().max(8),
});
export type ZoomToArgs = z.infer<typeof zoomToArgs>;

/* ------------------------------------------------------------------------- */
/* Equations & plots                                                          */
/* ------------------------------------------------------------------------- */

export const createEquationArgs = z.object({
  latex: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "LaTeX source for the equation. Examples: 'x^2 + y^2 = r^2', '\\\\frac{a}{b}', '\\\\pi r^2'.",
    ),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(2000).optional(),
  h: z.number().positive().max(800).optional(),
  fontSize: z.number().int().positive().max(96).optional(),
});
export type CreateEquationArgs = z.infer<typeof createEquationArgs>;

export const createPlotArgs = z.object({
  expression: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Math expression in `x`, e.g. 'x^2', 'sin(x)', '2*x + 1', 'sqrt(x)'. function-plot syntax (no LaTeX).",
    ),
  xMin: z.number().default(-5),
  xMax: z.number().default(5),
  yMin: z.number().optional(),
  yMax: z.number().optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(2000).default(360),
  h: z.number().positive().max(2000).default(260),
  title: z.string().max(60).optional(),
});
export type CreatePlotArgs = z.infer<typeof createPlotArgs>;

/* ------------------------------------------------------------------------- */
/* Convenience                                                                */
/* ------------------------------------------------------------------------- */

export const labelShapeArgs = z.object({
  id: shapeIdSchema,
  label: z.string().min(1).max(80),
});
export type LabelShapeArgs = z.infer<typeof labelShapeArgs>;

/* ------------------------------------------------------------------------- */
/* Pages (multi-page whiteboard)                                              */
/* ------------------------------------------------------------------------- */

export const createPageArgs = z.object({
  name: z.string().min(1).max(60).optional(),
  switchTo: z.boolean().default(true),
});
export type CreatePageArgs = z.infer<typeof createPageArgs>;

export const switchPageArgs = z
  .object({
    pageId: z.string().min(1).optional(),
    name: z.string().min(1).max(60).optional(),
  })
  .strict();
export type SwitchPageArgs = z.infer<typeof switchPageArgs>;

export const listPagesArgs = z.object({}).strict();
export type ListPagesArgs = z.infer<typeof listPagesArgs>;

/* ------------------------------------------------------------------------- */
/* Images & SVG                                                               */
/* ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- */
/* Curriculum                                                                 */
/* ------------------------------------------------------------------------- */

export const moduleStatus = z.enum(["pending", "in_progress", "complete"]);
export type ModuleStatus = z.infer<typeof moduleStatus>;

export const suggestedToolSchema = z.enum([
  "image",
  "video",
  "equation",
  "plot",
  "minigame",
  "svg",
]);
export type SuggestedTool = z.infer<typeof suggestedToolSchema>;

export const curriculumModuleSchema = z.object({
  title: z.string().min(1).max(120),
  objectives: z.array(z.string().min(1).max(200)).max(8).default([]),
  subtopics: z.array(z.string().min(1).max(160)).max(10).default([]),
  suggestedTools: z.array(suggestedToolSchema).max(8).default([]),
  estimatedMinutes: z.number().int().positive().max(120).optional(),
  status: moduleStatus.default("pending"),
});
export type CurriculumModule = z.infer<typeof curriculumModuleSchema>;

// Wire-format args for placing a curriculum on the canvas. The agent calls
// plan_lesson which generates the JSON, then dispatches this to the FE.
export const createCurriculumArgs = z.object({
  title: z.string().min(1).max(160),
  prerequisites: z.array(z.string().min(1).max(120)).max(8).default([]),
  modules: z.array(curriculumModuleSchema).min(1).max(15),
  notes: z.array(z.string().min(1).max(280)).max(20).default([]),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(2000).default(360),
  h: z.number().positive().max(2000).default(440),
});
export type CreateCurriculumArgs = z.infer<typeof createCurriculumArgs>;

// Update a single module's status and/or append a student note.
export const updateCurriculumArgs = z.object({
  id: shapeIdSchema,
  moduleIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("0-based module index to update. Omit to leave statuses alone."),
  status: moduleStatus
    .optional()
    .describe("New status for the module at moduleIndex."),
  note: z
    .string()
    .min(1)
    .max(280)
    .optional()
    .describe(
      "Optional student-specific note to append (e.g. 'student got stuck on dot product').",
    ),
});
export type UpdateCurriculumArgs = z.infer<typeof updateCurriculumArgs>;

// Wire-format args for video. fal hosts the file and returns an https URL
// — typically much larger than an image so we don't allow data: URIs here.
export const createVideoArgs = z.object({
  url: z.string().url(),
  alt: z.string().max(200).optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(2000),
  h: z.number().positive().max(2000),
});
export type CreateVideoArgs = z.infer<typeof createVideoArgs>;

// Wire-format args for a minigame. The HTML payload is a complete document
// the FE will load into a sandboxed iframe via `srcdoc`.
export const createMinigameArgs = z.object({
  html: z
    .string()
    .min(1)
    .max(120_000)
    .describe(
      "Complete self-contained HTML document with inline CSS and JS. No external network access available.",
    ),
  title: z.string().max(80).optional(),
  // Original natural-language description that drove the generation. We
  // persist this on the shape so the auto-repair loop can ask Claude to
  // regenerate against the same spec when the iframe throws at runtime.
  description: z.string().max(2000).optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(2000).default(420),
  h: z.number().positive().max(2000).default(360),
});
export type CreateMinigameArgs = z.infer<typeof createMinigameArgs>;

// Used only by the FE→agent auto-repair loop. NOT registered as an LLM tool —
// the agent invokes this via rpc.call() after Claude returns patched HTML.
export const replaceMinigameHtmlArgs = z.object({
  id: shapeIdSchema,
  html: z.string().min(1).max(120_000),
  title: z.string().max(80).optional(),
});
export type ReplaceMinigameHtmlArgs = z.infer<typeof replaceMinigameHtmlArgs>;

// Wire-format args (FE applies this after the agent has resolved a real URL
// from fal / image-gen). fal returns hosted https URLs; we keep the validator
// permissive enough to also accept data: URIs in case we swap providers.
export const createImageArgs = z.object({
  url: z
    .string()
    .min(1)
    .max(5_000_000)
    .refine(
      (s) =>
        /^https?:\/\//.test(s) ||
        /^data:image\/(png|jpeg|webp);base64,/.test(s),
      { message: "url must be http(s) or a base64 data URI for image/*" },
    ),
  alt: z.string().max(200).optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(2000),
  h: z.number().positive().max(2000),
});
export type CreateImageArgs = z.infer<typeof createImageArgs>;

export const createSvgArgs = z.object({
  svg: z
    .string()
    .min(1)
    .max(20000)
    .describe("A complete <svg>...</svg> markup string."),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(2000).default(240),
  h: z.number().positive().max(2000).default(240),
});
export type CreateSvgArgs = z.infer<typeof createSvgArgs>;

/* ------------------------------------------------------------------------- */
/* Vision                                                                     */
/* ------------------------------------------------------------------------- */

export const lookAtCanvasArgs = z
  .object({
    question: z
      .string()
      .max(500)
      .optional()
      .describe(
        "Optional focused question the visual model should answer about the canvas, e.g. 'is this a right triangle?'.",
      ),
  })
  .strict();
export type LookAtCanvasArgs = z.infer<typeof lookAtCanvasArgs>;

// FE returns a base64-encoded PNG snapshot of the current canvas plus its
// dimensions. The agent forwards this to Claude for interpretation.
export const lookAtCanvasResult = z.object({
  pngBase64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type LookAtCanvasResult = z.infer<typeof lookAtCanvasResult>;

/* ------------------------------------------------------------------------- */
/* Agent-only tools (do not appear in toolCallSchema — they don't cross the   */
/* data channel; the agent handles them internally).                          */
/* ------------------------------------------------------------------------- */

export const generateImageArgs = z.object({
  prompt: z
    .string()
    .min(1)
    .max(500)
    .describe("Image-generation prompt for Flux Schnell."),
  x: z.number(),
  y: z.number(),
  w: z.number().int().positive().max(2000).default(384),
  h: z.number().int().positive().max(2000).default(384),
});
export type GenerateImageArgs = z.infer<typeof generateImageArgs>;

export const generateVideoArgs = z.object({
  prompt: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Short, concrete description of the video. Best for 5-10 second clips: 'a paper airplane gliding past a window in slow motion', 'time-lapse of a plant growing from a seed'.",
    ),
  x: z.number(),
  y: z.number(),
  w: z.number().int().positive().max(2000).default(480),
  h: z.number().int().positive().max(2000).default(270),
});
export type GenerateVideoArgs = z.infer<typeof generateVideoArgs>;

export const planLessonArgs = z.object({
  topic: z
    .string()
    .min(2)
    .max(400)
    .describe(
      "What the student wants to learn, broadly stated. e.g. 'linear algebra', 'photosynthesis', 'the French Revolution'.",
    ),
  level: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Target level / grade if known, e.g. '8th grade math', 'introductory undergrad', 'absolute beginner'.",
    ),
  durationHint: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Rough total time the student has, e.g. '20 minutes', 'a few sessions', 'one hour'.",
    ),
  x: z.number().default(40),
  y: z.number().default(40),
  w: z.number().int().positive().max(800).default(360),
  h: z.number().int().positive().max(1200).default(440),
});
export type PlanLessonArgs = z.infer<typeof planLessonArgs>;

export const generateMinigameArgs = z.object({
  description: z
    .string()
    .min(10)
    .max(2000)
    .describe(
      "What the minigame should do, in plain English. Be specific about the rules, win condition, and what the student does. Example: 'A drag-and-drop game where the student matches each fraction tile to its decimal equivalent. 4 pairs. Show a green tick when matched, red shake when wrong. Time bonus for fast wins.'",
    ),
  title: z.string().max(80).optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().int().positive().max(2000).default(420),
  h: z.number().int().positive().max(2000).default(360),
});
export type GenerateMinigameArgs = z.infer<typeof generateMinigameArgs>;

export const repairMinigameArgs = z.object({
  id: shapeIdSchema.describe(
    "The shape id of the broken minigame, as returned by generate_minigame.",
  ),
  studentComplaint: z
    .string()
    .min(3)
    .max(500)
    .describe(
      "What the student said is wrong, in their own words. Example: 'the start button doesn't do anything' or 'the ball falls through the floor'.",
    ),
});
export type RepairMinigameArgs = z.infer<typeof repairMinigameArgs>;

// Skeleton placeholder shown while a slow tool generates real content.
// Created by the agent at the very start of generate_image / generate_video /
// generate_minigame / plan_lesson, then deleted as soon as the real shape is
// placed. The student sees "something is happening here" instead of a blank
// canvas during the 20–90s wait.
export const skeletonKindSchema = z.enum([
  "image",
  "video",
  "minigame",
  "plan",
  "thinking",
]);
export type SkeletonKind = z.infer<typeof skeletonKindSchema>;

export const createSkeletonArgs = z.object({
  kind: skeletonKindSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(2000).default(420),
  h: z.number().positive().max(2000).default(360),
  // Optional one-liner shown inside the skeleton ("Generating image of a
  // mitochondrion…"). Truncate before publishing — the FE renders verbatim.
  label: z.string().max(120).optional(),
});
export type CreateSkeletonArgs = z.infer<typeof createSkeletonArgs>;

export const thinkArgs = z.object({
  question: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "The hard problem you need help with. Be specific — full math problem, full conceptual question.",
    ),
  context: z
    .string()
    .max(4000)
    .optional()
    .describe("Optional extra context the reasoning model should know about."),
});
export type ThinkArgs = z.infer<typeof thinkArgs>;

export const gradeAnswerArgs = z.object({
  problem: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      "The original problem statement (use LaTeX where appropriate, e.g. 'Solve x^2 - 5x + 6 = 0').",
    ),
  studentAnswer: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "The student's answer as you've understood it — text, LaTeX, or a description (e.g. 'x = 2 and x = 3', or 'they drew a triangle with vertices ...').",
    ),
  expectedAnswer: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Optional: the canonical answer if you have it. If omitted the grader works it out from the problem.",
    ),
});
export type GradeAnswerArgs = z.infer<typeof gradeAnswerArgs>;

/* ------------------------------------------------------------------------- */
/* Tool union (used by the dispatcher to validate incoming tool_call payloads)*/
/* ------------------------------------------------------------------------- */

export const toolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("create_text"), args: createTextArgs }),
  z.object({ tool: z.literal("update_shape"), args: updateShapeArgs }),
  z.object({ tool: z.literal("delete_shape"), args: deleteShapeArgs }),
  z.object({ tool: z.literal("clear_canvas"), args: clearCanvasArgs }),
  z.object({ tool: z.literal("point_at"), args: pointAtArgs }),
  z.object({ tool: z.literal("list_shapes"), args: listShapesArgs }),
  z.object({ tool: z.literal("get_focus"), args: getFocusArgs }),
  z.object({ tool: z.literal("create_shape"), args: createShapeArgs }),
  z.object({ tool: z.literal("create_highlight"), args: createHighlightArgs }),
  z.object({ tool: z.literal("pan_to"), args: panToArgs }),
  z.object({ tool: z.literal("zoom_to"), args: zoomToArgs }),
  z.object({ tool: z.literal("create_equation"), args: createEquationArgs }),
  z.object({ tool: z.literal("create_plot"), args: createPlotArgs }),
  z.object({ tool: z.literal("label_shape"), args: labelShapeArgs }),
  z.object({ tool: z.literal("create_image"), args: createImageArgs }),
  z.object({ tool: z.literal("create_svg"), args: createSvgArgs }),
  z.object({ tool: z.literal("look_at_canvas"), args: lookAtCanvasArgs }),
  z.object({ tool: z.literal("create_page"), args: createPageArgs }),
  z.object({ tool: z.literal("switch_page"), args: switchPageArgs }),
  z.object({ tool: z.literal("list_pages"), args: listPagesArgs }),
  z.object({ tool: z.literal("create_video"), args: createVideoArgs }),
  z.object({ tool: z.literal("create_minigame"), args: createMinigameArgs }),
  z.object({
    tool: z.literal("replace_minigame_html"),
    args: replaceMinigameHtmlArgs,
  }),
  z.object({ tool: z.literal("create_skeleton"), args: createSkeletonArgs }),
  z.object({
    tool: z.literal("create_curriculum"),
    args: createCurriculumArgs,
  }),
  z.object({
    tool: z.literal("update_curriculum"),
    args: updateCurriculumArgs,
  }),
]);
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolName = ToolCall["tool"];

/* ------------------------------------------------------------------------- */
/* Tool result shapes                                                          */
/* ------------------------------------------------------------------------- */

export const createShapeResult = z.object({
  id: shapeIdSchema,
});
export type CreateShapeResult = z.infer<typeof createShapeResult>;

export const okResult = z.object({ ok: z.literal(true) });
export type OkResult = z.infer<typeof okResult>;

export const listShapesResult = z.object({
  shapes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      summary: z.string().optional(),
      x: z.number(),
      y: z.number(),
    }),
  ),
});
export type ListShapesResult = z.infer<typeof listShapesResult>;
