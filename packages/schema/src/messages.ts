import { z } from "zod";
import { sceneDigestSchema } from "./shapes";
import { toolCallSchema } from "./tools";

// Topics on the LiveKit data channel. Single-source-of-truth here so we can't
// typo them across FE and agent.
export const TOPIC_TOOL_CALL = "tool_call";
export const TOPIC_TOOL_RESULT = "tool_result";
export const TOPIC_SCENE_STATE = "scene_state";
export const TOPIC_STUDENT_MESSAGE = "student_message";
export const TOPIC_TRANSCRIPT = "transcript";
export const TOPIC_AGENT_STATE = "agent_state";
export const TOPIC_STUDENT_DREW = "student_drew";
export const TOPIC_MINIGAME_ERROR = "minigame_error";

/* ------------------------------------------------------------------------- */
/* Agent → FE: tool call envelope                                            */
/* ------------------------------------------------------------------------- */

export const toolCallEnvelope = z.object({
  kind: z.literal("tool_call"),
  // Correlation id — the FE must echo this back in the matching tool_result.
  callId: z.string().min(1),
  // Discriminated union of (tool, args).
  payload: toolCallSchema,
});
export type ToolCallEnvelope = z.infer<typeof toolCallEnvelope>;

/* ------------------------------------------------------------------------- */
/* FE → Agent: tool result envelope                                          */
/* ------------------------------------------------------------------------- */

export const toolResultOk = z.object({
  kind: z.literal("tool_result"),
  callId: z.string().min(1),
  ok: z.literal(true),
  // Tool-specific payload — kept loose here so each tool's result schema can
  // own validation on the agent side.
  data: z.unknown().optional(),
});

export const toolResultErr = z.object({
  kind: z.literal("tool_result"),
  callId: z.string().min(1),
  ok: z.literal(false),
  error: z.string().min(1),
});

export const toolResultEnvelope = z.discriminatedUnion("ok", [
  toolResultOk,
  toolResultErr,
]);
export type ToolResultEnvelope = z.infer<typeof toolResultEnvelope>;

/* ------------------------------------------------------------------------- */
/* FE → Agent: scene state envelope                                          */
/* ------------------------------------------------------------------------- */

export const sceneStateEnvelope = z.object({
  kind: z.literal("scene_state"),
  digest: sceneDigestSchema,
});
export type SceneStateEnvelope = z.infer<typeof sceneStateEnvelope>;

/* ------------------------------------------------------------------------- */
/* Transcript: agent → FE (one entry per completed turn)                      */
/* ------------------------------------------------------------------------- */

export const transcriptEnvelope = z.object({
  kind: z.literal("transcript"),
  role: z.enum(["student", "tutor"]),
  text: z.string().min(1),
  source: z.enum(["voice", "text"]).default("voice"),
  timestamp: z.number().int().nonnegative(),
});
export type TranscriptEnvelope = z.infer<typeof transcriptEnvelope>;

/* ------------------------------------------------------------------------- */
/* Agent state: agent → FE (status banner)                                    */
/* ------------------------------------------------------------------------- */

export const agentStateSchema = z.enum([
  "idle",
  "listening",
  "thinking",
  "speaking",
  "drawing",
  "generating_image",
  "looking",
]);
export type AgentState = z.infer<typeof agentStateSchema>;

export const agentStateEnvelope = z.object({
  kind: z.literal("agent_state"),
  state: agentStateSchema,
  detail: z.string().optional(),
  timestamp: z.number().int().nonnegative(),
});
export type AgentStateEnvelope = z.infer<typeof agentStateEnvelope>;

/* ------------------------------------------------------------------------- */
/* Student-drew nudge: FE → Agent (debounced after a stroke ends)             */
/* ------------------------------------------------------------------------- */

// Lets the agent react proactively when the student writes/draws something
// new without an explicit voice or text prompt — the killer demo for
// handwriting → LaTeX recognition.
export const studentDrewEnvelope = z.object({
  kind: z.literal("student_drew"),
  // Ids of the freshly-added student shapes that triggered this nudge.
  shapeIds: z.array(z.string()).min(1),
  // Bounding box around the affected shapes, page coordinates.
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  timestamp: z.number().int().nonnegative(),
});
export type StudentDrewEnvelope = z.infer<typeof studentDrewEnvelope>;

/* ------------------------------------------------------------------------- */
/* Minigame error: FE → Agent (game iframe threw / failed to boot)            */
/* ------------------------------------------------------------------------- */

// A minigame iframe captured a runtime error (uncaught exception, unhandled
// rejection) or failed to fire its DOMContentLoaded ping in time. The agent
// uses this to invoke a regeneration pass through Claude with the broken
// HTML + error trace.
export const minigameErrorEnvelope = z.object({
  kind: z.literal("minigame_error"),
  shapeId: z.string().min(1),
  // Original natural-language description the agent passed to generate_minigame.
  // Empty string means the shape was created from a raw create_minigame call
  // without an original prompt — regen will rely on the broken HTML alone.
  description: z.string().default(""),
  title: z.string().default(""),
  // Snapshot of current HTML so the agent can ask Claude to patch it.
  // brokenHtml is optional — the agent has the html cached server-side from
  // the original generate_minigame call (see canvas-tools.ts minigameCache).
  // The FE used to ship the full html here, but that overran LiveKit's 64KB
  // data channel limit for heavy 3D games. The agent now reads from cache
  // and falls back to a "give up if cache miss" path so we don't have to
  // round-trip the html again.
  brokenHtml: z.string().max(8_000).optional(),
  // Captured error rows. We keep a short list (3-5) so the agent gets the
  // most informative trace without blowing token budgets.
  errors: z
    .array(
      z.object({
        type: z.enum(["error", "unhandledrejection", "console", "no_boot"]),
        message: z.string().min(1).max(2000),
        source: z.string().max(500).optional(),
        line: z.number().int().optional(),
        col: z.number().int().optional(),
        stack: z.string().max(4000).optional(),
      }),
    )
    .min(1)
    .max(5),
  // Per-shape attempt number (1 = first failure). FE caps this; agent also
  // double-checks to stop runaway loops.
  attempt: z.number().int().min(1).max(5),
  timestamp: z.number().int().nonnegative(),
});
export type MinigameErrorEnvelope = z.infer<typeof minigameErrorEnvelope>;
