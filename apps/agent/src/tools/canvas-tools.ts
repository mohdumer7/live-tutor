import { llm } from "@livekit/agents";
import {
  clearCanvasArgs,
  createEquationArgs,
  createHighlightArgs,
  createPlotArgs,
  createShapeArgs,
  createSvgArgs,
  createTextArgs,
  deleteShapeArgs,
  createPageArgs,
  generateImageArgs,
  generateMinigameArgs,
  repairMinigameArgs,
  generateVideoArgs,
  getFocusArgs,
  gradeAnswerArgs,
  labelShapeArgs,
  listPagesArgs,
  listShapesArgs,
  lookAtCanvasArgs,
  panToArgs,
  planLessonArgs,
  pointAtArgs,
  switchPageArgs,
  thinkArgs,
  updateCurriculumArgs,
  updateShapeArgs,
  zoomToArgs,
  type CreateEquationArgs,
  type CreateHighlightArgs,
  type CreatePageArgs,
  type CreatePlotArgs,
  type CreateShapeArgs,
  type CreateSvgArgs,
  type CreateTextArgs,
  type DeleteShapeArgs,
  type GenerateImageArgs,
  type GenerateMinigameArgs,
  type RepairMinigameArgs,
  type GenerateVideoArgs,
  type GradeAnswerArgs,
  type LabelShapeArgs,
  type LookAtCanvasArgs,
  type PanToArgs,
  type PlanLessonArgs,
  type PointAtArgs,
  type SwitchPageArgs,
  type ThinkArgs,
  type UpdateCurriculumArgs,
  type UpdateShapeArgs,
  type ZoomToArgs,
} from "@live-tutor/schema";
import type { RpcClient } from "./rpc.js";
import type { SceneState } from "../scene-state.js";
import { generateImage } from "./image-gen.js";
import { generateMinigame, regenerateMinigame } from "./minigame-gen.js";
import { generateVideo } from "./video-gen.js";
import { gradeAnswer } from "./grade.js";
import { planLesson } from "./curriculum.js";
import { think } from "./think.js";
import { describeCanvas } from "./vision.js";

/**
 * A wrapper around AgentSession.say() that we can hand to the tool factory
 * before the session itself is constructed. The pointer is mutable: index.ts
 * patches `say` after `voice.AgentSession.start()` returns. Tools call
 * `narrator.say(...)` for pre-tool filler ("let me think for a moment") so
 * audio never goes silent during slow operations like `think` / image-gen /
 * vision.
 */
export type EngagementKind =
  | "thinking"
  | "looking"
  | "image"
  | "video"
  | "plan"
  | "game"
  | "grading";

export type Narrator = {
  say: (text: string) => void;
  // Set by index.ts after session start; lets slow tools push state-banner
  // updates ("looking", "thinking", "generating_image") without needing a
  // direct reference to the AgentSession or LiveKit room.
  state?: (
    state:
      | "idle"
      | "listening"
      | "thinking"
      | "speaking"
      | "drawing"
      | "generating_image"
      | "looking",
    detail?: string,
  ) => void;
  // Schedules a sequence of timed fillers ("let me work through this",
  // "almost there", ...) tailored to the kind of slow operation. Returns a
  // cancel function — call it as soon as the real result arrives so any
  // not-yet-spoken fillers don't queue up after the answer.
  engage?: (kind: EngagementKind) => () => void;
};

/**
 * Builds the agent's canvas tool surface. Each tool forwards to the FE via
 * the RPC client and returns a result the realtime model can act on.
 *
 * The tool names here become the function names the model sees in its tool
 * schema, so they need to be stable and self-describing.
 */
export type MinigameCacheEntry = {
  html: string;
  title: string;
  description: string;
};
export type MinigameCache = Map<string, MinigameCacheEntry>;

export function createCanvasTools(
  rpc: RpcClient,
  sceneState: SceneState,
  narrator: Narrator,
  // In-memory mirror of every minigame we've generated this session. Lets
  // repair_minigame patch a broken game without needing to round-trip to
  // the FE for the current html — the agent IS the source of truth for
  // generated artifacts. Owned by index.ts so the auto-repair listener can
  // also update it after a successful regen.
  minigameCache: MinigameCache,
) {
  // Place a transient "loading" skeleton on the canvas before kicking off a
  // slow generation. Returns the placeholder's id + actual placed coords
  // (post-nudge) plus a `release(success)` function that the caller MUST
  // invoke from a finally{}. The skeleton is deleted on release.
  //
  // Best-effort: if the skeleton create fails (rpc timeout, FE not ready),
  // we still return a usable handle that the caller can blindly release —
  // generation continues, the student just doesn't see a placeholder.
  type SkeletonHandle = {
    id: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
    release: () => Promise<void>;
  };

  async function placeSkeleton(
    kind: "image" | "video" | "minigame" | "plan" | "thinking",
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
  ): Promise<SkeletonHandle> {
    let placed: { id: string; x: number; y: number; w: number; h: number } | null =
      null;
    try {
      placed = (await rpc.call({
        tool: "create_skeleton",
        args: { kind, x, y, w, h, label: label.slice(0, 120) },
      })) as { id: string; x: number; y: number; w: number; h: number };
    } catch (err) {
      console.warn("[skeleton] create failed (continuing without):", err);
    }
    let released = false;
    return {
      id: placed?.id ?? null,
      x: placed?.x ?? x,
      y: placed?.y ?? y,
      w: placed?.w ?? w,
      h: placed?.h ?? h,
      // Idempotent — safe to call from both the success path and the
      // try/finally cleanup.
      release: async () => {
        if (released) return;
        released = true;
        if (!placed?.id) return;
        try {
          await rpc.call({
            tool: "delete_shape",
            args: { id: placed.id },
          });
        } catch (err) {
          console.warn("[skeleton] delete failed:", err);
        }
      },
    };
  }

  return {
    create_text: llm.tool({
      description:
        "Write a short text label on the shared whiteboard. Returns the new shape id you can use later to update or delete it. Coordinates are in canvas page space — start near (0, 0) for visibility.",
      parameters: createTextArgs,
      execute: async (args: CreateTextArgs) => {
        const data = (await rpc.call({ tool: "create_text", args })) as {
          id: string;
        };
        return {
          ok: true,
          id: data.id,
          message: `wrote "${args.text}" at (${args.x}, ${args.y}) — shape id ${data.id}`,
        };
      },
    }),

    update_shape: llm.tool({
      description:
        "Modify an existing shape on the whiteboard by id. Provide any subset of x, y, text, color to change. Use list_shapes first if you don't remember the id.",
      parameters: updateShapeArgs,
      execute: async (args: UpdateShapeArgs) => {
        await rpc.call({ tool: "update_shape", args });
        return { ok: true, message: `updated shape ${args.id}` };
      },
    }),

    delete_shape: llm.tool({
      description: "Remove one shape from the whiteboard by id.",
      parameters: deleteShapeArgs,
      execute: async (args: DeleteShapeArgs) => {
        await rpc.call({ tool: "delete_shape", args });
        return { ok: true, message: `deleted shape ${args.id}` };
      },
    }),

    clear_canvas: llm.tool({
      description:
        "Clear the entire whiteboard. Use sparingly — only when starting a fresh topic.",
      parameters: clearCanvasArgs,
      execute: async () => {
        await rpc.call({ tool: "clear_canvas", args: {} });
        return { ok: true, message: "canvas cleared" };
      },
    }),

    point_at: llm.tool({
      description:
        "Briefly point a glowing cursor at something to draw the student's attention. Pass either targetId (preferred — points at an existing shape) or x and y coordinates.",
      parameters: pointAtArgs,
      execute: async (args: PointAtArgs) => {
        await rpc.call({ tool: "point_at", args });
        return { ok: true, message: "pointer shown" };
      },
    }),

    list_shapes: llm.tool({
      description:
        "Get the current state of the whiteboard. Returns every shape with its id, kind, position, and a short content summary. Call this when you need to reference something you wrote earlier and don't remember the id.",
      parameters: listShapesArgs,
      execute: async () => {
        const data = (await rpc.call({ tool: "list_shapes", args: {} })) as {
          shapes: Array<{
            id: string;
            kind: string;
            x: number;
            y: number;
            w?: number;
            h?: number;
            summary?: string;
          }>;
        };
        return {
          ok: true,
          shapes: data.shapes,
          digest: sceneState.asPromptText(),
        };
      },
    }),

    get_focus: llm.tool({
      description:
        "Find out what the student is currently looking at: the visible viewport, what they have selected, the shape under their cursor, their pointer location, and the most recently touched shapes. Call this whenever the student says 'here', 'there', 'this', 'that', or refers to a shape without naming it.",
      parameters: getFocusArgs,
      execute: async () => {
        const data = (await rpc.call({ tool: "get_focus", args: {} })) as {
          viewport: {
            x: number;
            y: number;
            w: number;
            h: number;
            zoom: number;
          };
          selectedIds: string[];
          hoveredId?: string;
          cursor?: { x: number; y: number };
        };
        return {
          ok: true,
          ...data,
          recentlyTouchedIds:
            sceneState.current()?.focus.recentlyTouchedIds ?? [],
        };
      },
    }),

    create_shape: llm.tool({
      description:
        "Draw a primitive shape: rect, ellipse (use equal width and height for a circle), arrow, or line. Coordinates are top-left in canvas page space. To draw a circle AROUND an existing shape, first call get_focus or use the shape's bounds from the digest, then place the ellipse with x = bounds.x - padding, y = bounds.y - padding, w = bounds.w + 2*padding, h = bounds.h + 2*padding (try padding ≈ 16).",
      parameters: createShapeArgs,
      execute: async (args: CreateShapeArgs) => {
        const data = (await rpc.call({ tool: "create_shape", args })) as {
          id: string;
        };
        return {
          ok: true,
          id: data.id,
          message: `drew ${args.kind} at (${args.x}, ${args.y}) size ${args.w}x${args.h}`,
        };
      },
    }),

    create_highlight: llm.tool({
      description:
        "Place a translucent highlight rectangle over a region. Defaults to yellow. Useful for drawing the student's eye to a part of the canvas. The highlight is sent to the back automatically so labels stay readable.",
      parameters: createHighlightArgs,
      execute: async (args: CreateHighlightArgs) => {
        const data = (await rpc.call({
          tool: "create_highlight",
          args,
        })) as { id: string };
        return { ok: true, id: data.id };
      },
    }),

    pan_to: llm.tool({
      description:
        "Move the camera. Pass a targetId to frame an existing shape, or x and y to center on a page coordinate. Optional zoom (1.0 is 100%).",
      parameters: panToArgs,
      execute: async (args: PanToArgs) => {
        await rpc.call({ tool: "pan_to", args });
        return { ok: true };
      },
    }),

    zoom_to: llm.tool({
      description:
        "Set the camera zoom level. 1.0 is 100%, larger zooms in, smaller zooms out. Range 0.1 to 8.",
      parameters: zoomToArgs,
      execute: async (args: ZoomToArgs) => {
        await rpc.call({ tool: "zoom_to", args });
        return { ok: true };
      },
    }),

    create_equation: llm.tool({
      description:
        "Render a typeset math equation on the canvas using LaTeX. Use this for any formula, expression, or equation — never write math as plain text. Examples: 'x^2 + y^2 = r^2', '\\\\frac{a}{b}', '\\\\pi r^2', 'E = mc^2'. Default size is 240x80; provide w and h for a larger formula. Returns a shape id.",
      parameters: createEquationArgs,
      execute: async (args: CreateEquationArgs) => {
        const data = (await rpc.call({
          tool: "create_equation",
          args,
        })) as { id: string };
        return {
          ok: true,
          id: data.id,
          message: `wrote equation "${args.latex}" at (${args.x}, ${args.y}) — shape id ${data.id}`,
        };
      },
    }),

    create_plot: llm.tool({
      description:
        "Plot a math function of x on the canvas. Use function-plot syntax (NOT LaTeX): 'x^2', 'sin(x)', '2*x + 1', 'sqrt(x)', 'exp(x)'. xMin/xMax control the visible x range; yMin/yMax are optional and auto-fit if omitted. Default plot size is 360x260. Use this when a graph would help — e.g. 'plot y = x squared', 'show me a sine wave'.",
      parameters: createPlotArgs,
      execute: async (args: CreatePlotArgs) => {
        const data = (await rpc.call({ tool: "create_plot", args })) as {
          id: string;
        };
        return {
          ok: true,
          id: data.id,
          message: `plotted ${args.expression} on (${args.xMin}, ${args.xMax}) at (${args.x}, ${args.y})`,
        };
      },
    }),

    label_shape: llm.tool({
      description:
        "Attach a short semantic label to a shape so you can recall it later by meaning rather than id. Example: label_shape({id, label: 'area formula'}). The label shows up in the scene digest next to the shape AND as a small green badge above the shape on the student's canvas.",
      parameters: labelShapeArgs,
      execute: async (args: LabelShapeArgs) => {
        await rpc.call({ tool: "label_shape", args });
        return { ok: true, message: `labeled ${args.id} as "${args.label}"` };
      },
    }),

    generate_image: llm.tool({
      description:
        "Generate an AI image and place it on the canvas. Useful when a picture would help (e.g. 'show me a cell', 'draw a labeled diagram of a triangle'). Takes 10-30 seconds. BEFORE calling, say one short conversational line ('coming right up', 'give me a sec'). Returns a shape id.",
      parameters: generateImageArgs,
      execute: async (args: GenerateImageArgs) => {
        const stopEngage = narrator.engage?.("image");
        narrator.state?.("generating_image", args.prompt.slice(0, 60));
        const skel = await placeSkeleton(
          "image",
          args.x,
          args.y,
          args.w,
          args.h,
          `Generating image: ${args.prompt}`,
        );
        try {
          const gen = await generateImage(args);
          if (!gen.ok) return { ok: false, error: gen.error };
          // Remove the placeholder BEFORE placing real content so the
          // image lands in the skeleton's slot without auto-nudging.
          await skel.release();
          const data = (await rpc.call({
            tool: "create_image",
            args: {
              url: gen.url,
              alt: gen.alt,
              x: skel.x,
              y: skel.y,
              w: skel.w,
              h: skel.h,
            },
          })) as { id: string };
          return {
            ok: true,
            id: data.id,
            message: `placed generated image (${gen.latencyMs}ms) at (${args.x}, ${args.y})`,
          };
        } finally {
          // Defensive: if generate threw before skel.release() ran, clean
          // up here. release() is idempotent — a second call is a no-op.
          await skel.release();
          stopEngage?.();
          narrator.state?.("idle");
        }
      },
    }),

    create_svg: llm.tool({
      description:
        "Render arbitrary inline SVG markup on the canvas. Use for custom diagrams (coordinate axes, geometric figures, simple illustrations) where create_shape primitives aren't enough. Pass a complete '<svg>...</svg>' string with a viewBox. Script tags and event handlers are stripped server-side. Default size 240x240.",
      parameters: createSvgArgs,
      execute: async (args: CreateSvgArgs) => {
        const data = (await rpc.call({ tool: "create_svg", args })) as {
          id: string;
        };
        return { ok: true, id: data.id };
      },
    }),

    look_at_canvas: llm.tool({
      description:
        "Take a visual snapshot of the canvas and have a vision model describe it. Use this when the digest text isn't enough — e.g. the student just drew a freeform shape, or said 'is this right?' / 'what about this?'. You can pass a focused question (e.g. 'is the student's triangle a right triangle?'). Takes 2-3s. BEFORE calling, say 'let me take a look' or similar. Returns a text description.",
      parameters: lookAtCanvasArgs,
      execute: async (args: LookAtCanvasArgs) => {
        const stopEngage = narrator.engage?.("looking");
        narrator.state?.("looking", args.question?.slice(0, 60));
        try {
          const snap = (await rpc.call({
            tool: "look_at_canvas",
            args,
          })) as { pngBase64: string; width: number; height: number };
          const out = await describeCanvas({
            pngBase64: snap.pngBase64,
            width: snap.width,
            height: snap.height,
            question: args.question,
          });
          if (!out.ok) return { ok: false, error: out.error };
          return {
            ok: true,
            description: out.description,
            latencyMs: out.latencyMs,
          };
        } finally {
          stopEngage?.();
          narrator.state?.("idle");
        }
      },
    }),

    create_page: llm.tool({
      description:
        "Add a new page to the whiteboard. Useful when starting a new sub-topic or a clean practice problem. Pass an optional descriptive name (e.g. 'Quadratic intro'). By default switchTo is true so the student lands on the new page; pass switchTo=false if you want to set up a page in the background.",
      parameters: createPageArgs,
      execute: async (args: CreatePageArgs) => {
        const data = (await rpc.call({ tool: "create_page", args })) as {
          id: string;
          name: string;
          switched: boolean;
        };
        return { ok: true, ...data };
      },
    }),

    switch_page: llm.tool({
      description:
        "Switch to an existing whiteboard page by id (preferred) or by name. Call list_pages() first if you don't have the id.",
      parameters: switchPageArgs,
      execute: async (args: SwitchPageArgs) => {
        const data = (await rpc.call({ tool: "switch_page", args })) as {
          id: string;
          name: string;
        };
        return { ok: true, ...data };
      },
    }),

    list_pages: llm.tool({
      description:
        "List all whiteboard pages with their ids and names, plus the currently visible page id.",
      parameters: listPagesArgs,
      execute: async () => {
        const data = (await rpc.call({ tool: "list_pages", args: {} })) as {
          pages: Array<{ id: string; name: string }>;
          currentId: string;
        };
        return { ok: true, ...data };
      },
    }),

    generate_video: llm.tool({
      description:
        "Generate a short AI video clip and place it on the canvas. Best for things words can't show: motion, time-lapse, processes (a paper plane gliding, mitosis, water cycle). Takes 30-90 seconds. BEFORE calling, warn the student it'll take a moment ('this'll take about a minute, hang tight'). Aspect ratio is picked from w/h. Returns a shape id.",
      parameters: generateVideoArgs,
      execute: async (args: GenerateVideoArgs) => {
        const stopEngage = narrator.engage?.("video");
        narrator.state?.(
          "generating_image",
          `video: ${args.prompt.slice(0, 50)}`,
        );
        const skel = await placeSkeleton(
          "video",
          args.x,
          args.y,
          args.w,
          args.h,
          `Generating video: ${args.prompt}`,
        );
        try {
          const gen = await generateVideo(args);
          if (!gen.ok) return { ok: false, error: gen.error };
          await skel.release();
          const data = (await rpc.call({
            tool: "create_video",
            args: {
              url: gen.url,
              alt: gen.alt,
              x: skel.x,
              y: skel.y,
              w: skel.w,
              h: skel.h,
            },
          })) as { id: string };
          return {
            ok: true,
            id: data.id,
            message: `placed generated video (${gen.latencyMs}ms) at (${args.x}, ${args.y})`,
          };
        } finally {
          await skel.release();
          stopEngage?.();
          narrator.state?.("idle");
        }
      },
    }),

    generate_minigame: llm.tool({
      description:
        "Generate ANY interactive HTML5 experience — including FULL 3D GAMES — and embed it on the canvas in a sandboxed iframe. This tool can do real 3D rendering with three.js + cannon-es physics (gravity, collisions, OrbitControls), 2D physics with matter.js, or plain DOM/CSS/JS. NEVER tell the student 'I can't make a 3D game' or 'I can only make simulations' — you can, and this tool builds them. When the student asks for any kind of game, simulation, demo, or playable visualization, CALL THIS TOOL. Don't ask permission. Don't downgrade. YOUR JOB is to pick the right rendering capability: (a) any physics topic (gravity, pendulums, projectiles, collisions, springs, planetary motion) → 3D scene using three.js + cannon-es. (b) inherently 3D / spatial topics (geometry of solids, molecular structure, anatomy) → 3D scene. (c) 2D-only physics (billiards, lever, 2D pendulum if 3D is overkill) → matter.js. (d) drag/drop, matching, sorting, quizzes, sliders without physics → plain DOM. Be VERY specific in the description: rules, win condition, what the student does, what feedback to show, and explicitly name the library stack (e.g. 'use three.js + cannon-es, OrbitControls for camera'). BEFORE calling, say one short conversational line ('alright, building a 3D car physics demo, give me a minute'). Takes 30-90 seconds for 3D. Default size 420x360; use 500x400+ for 3D scenes. Returns a shape id.",
      parameters: generateMinigameArgs,
      execute: async (args: GenerateMinigameArgs) => {
        const stopEngage = narrator.engage?.("game");
        narrator.state?.(
          "thinking",
          `minigame: ${args.description.slice(0, 50)}`,
        );
        const skel = await placeSkeleton(
          "minigame",
          args.x,
          args.y,
          args.w,
          args.h,
          `Building minigame: ${args.description}`,
        );
        try {
          const gen = await generateMinigame(args);
          if (!gen.ok) return { ok: false, error: gen.error };
          await skel.release();
          const data = (await rpc.call({
            tool: "create_minigame",
            args: {
              html: gen.html,
              title: gen.title,
              description: args.description,
              x: skel.x,
              y: skel.y,
              w: skel.w,
              h: skel.h,
            },
          })) as { id: string };
          minigameCache.set(data.id, {
            html: gen.html,
            title: gen.title,
            description: args.description,
          });
          return {
            ok: true,
            id: data.id,
            title: gen.title,
            message: `placed minigame "${gen.title}" (${gen.latencyMs}ms) — shape id ${data.id}. Remember this id — if the student says it doesn't work, call repair_minigame with this id and their complaint.`,
          };
        } finally {
          await skel.release();
          stopEngage?.();
          narrator.state?.("idle");
        }
      },
    }),

    repair_minigame: llm.tool({
      description:
        "Regenerate a broken minigame when the student reports it's not working but no automatic error was captured (silent failures, like a Start button that does nothing, or wrong gameplay logic). Pass the minigame's shape id and what the student said is wrong. Takes 30-90s. Use this WHENEVER the student says any variant of 'this isn't working' / 'the button doesn't do anything' / 'nothing happens when I click' about a minigame. Don't ask them to restart — just call this tool. Returns the same shape id with new HTML.",
      parameters: repairMinigameArgs,
      execute: async (args: RepairMinigameArgs) => {
        const cached = minigameCache.get(args.id);
        if (!cached) {
          return {
            ok: false,
            error: `No cached minigame for ${args.id}. Either it wasn't generated this session, or you have the wrong shape id. Call list_shapes() to verify.`,
          };
        }
        const stopEngage = narrator.engage?.("game");
        narrator.state?.("thinking", `repairing minigame ${args.id.slice(-6)}`);
        try {
          const result = await regenerateMinigame({
            description: cached.description,
            title: cached.title,
            brokenHtml: cached.html,
            errors: [
              {
                type: "console",
                message: `STUDENT COMPLAINT (no JS exception was thrown — this is a silent logic / wiring bug, not a runtime crash): "${args.studentComplaint}". Common causes: (1) inline onclick="fn()" attribute references a function defined inside <script type="module"> (modules don't expose names on window — use addEventListener instead). (2) Event listener attached before the target element exists. (3) Boot logic depends on a variable that's only set after a different event fires. Review carefully.`,
              },
            ],
          });
          if (!result.ok) {
            return { ok: false, error: result.error };
          }
          await rpc.call({
            tool: "replace_minigame_html",
            args: {
              id: args.id,
              html: result.html,
              title: result.title,
            },
          });
          minigameCache.set(args.id, {
            html: result.html,
            title: result.title,
            description: cached.description,
          });
          return {
            ok: true,
            id: args.id,
            message: `repaired minigame "${result.title}" (${result.latencyMs}ms). Tell the student to try again.`,
          };
        } finally {
          stopEngage?.();
          narrator.state?.("idle");
        }
      },
    }),

    plan_lesson: llm.tool({
      description:
        "FIRST step when the student asks to learn something broad ('teach me linear algebra', 'help me understand photosynthesis'). Calls a curriculum researcher to produce a structured 4-7 module lesson plan, places it on the canvas as a visible checklist, and returns the modules so you know exactly what to teach. BEFORE calling, say one short conversational line ('sure, let me put a plan together'). Takes 5-30 seconds. AFTER it returns, briefly narrate the plan (one sentence per first 1-2 modules max), then start teaching module 1.",
      parameters: planLessonArgs,
      execute: async (args: PlanLessonArgs) => {
        const stopEngage = narrator.engage?.("plan");
        narrator.state?.("thinking", `planning: ${args.topic.slice(0, 50)}`);
        const skel = await placeSkeleton(
          "plan",
          args.x,
          args.y,
          args.w,
          args.h,
          `Planning: ${args.topic}`,
        );
        try {
          const plan = await planLesson(args);
          if (!plan.ok) return { ok: false, error: plan.error };
          // Mark module 0 as in_progress so the digest shows where we are
          // immediately, before the tutor calls update_curriculum manually.
          const seededModules = plan.modules.map((m, i) => ({
            ...m,
            status: i === 0 ? ("in_progress" as const) : ("pending" as const),
          }));
          await skel.release();
          const data = (await rpc.call({
            tool: "create_curriculum",
            args: {
              title: plan.title,
              prerequisites: plan.prerequisites,
              modules: seededModules,
              notes: [],
              x: skel.x,
              y: skel.y,
              w: skel.w,
              h: skel.h,
            },
          })) as { id: string };
          return {
            ok: true,
            id: data.id,
            title: plan.title,
            prerequisites: plan.prerequisites,
            modules: seededModules,
            // Reminder for the tutor about pacing.
            message: `Lesson plan created (id ${data.id}). Now narrate the plan briefly (one short sentence), then begin module 1: "${seededModules[0]?.title ?? "the first topic"}". Use update_curriculum to advance progress as you teach.`,
          };
        } finally {
          await skel.release();
          stopEngage?.();
          narrator.state?.("idle");
        }
      },
    }),

    update_curriculum: llm.tool({
      description:
        "Advance the lesson plan as you teach. Call after finishing a module to mark it complete and the next module as in_progress (two sequential calls). Pass a `note` string to record student-specific observations the tutor should remember (e.g. 'student got stuck on dot product — gave a 2D example'). Pass moduleIndex with status='in_progress' to switch to a different module if the student asks to skip ahead or revisit.",
      parameters: updateCurriculumArgs,
      execute: async (args: UpdateCurriculumArgs) => {
        await rpc.call({ tool: "update_curriculum", args });
        return {
          ok: true,
          message: `curriculum ${args.id} updated${
            args.moduleIndex !== undefined && args.status
              ? ` — module ${args.moduleIndex} → ${args.status}`
              : ""
          }${args.note ? " (note added)" : ""}`,
        };
      },
    }),

    grade_answer: llm.tool({
      description:
        "Grade a student's answer to a practice problem. Use this AFTER the student has given their answer (typed, written, or spoken — capture it as best you can in studentAnswer). Pass the original problem statement and the student's answer; optionally pass an expectedAnswer if you know it. Returns { verdict: 'correct'|'partial'|'incorrect', feedback, correctAnswer }. Narrate the feedback warmly and, if needed, write the correctAnswer on the canvas with create_equation.",
      parameters: gradeAnswerArgs,
      execute: async (args: GradeAnswerArgs) => {
        const stopEngage = narrator.engage?.("grading");
        narrator.state?.("thinking", "grading");
        try {
          const result = await gradeAnswer(args);
          if (!result.ok) return { ok: false, error: result.error };
          return {
            ok: true,
            verdict: result.verdict,
            feedback: result.feedback,
            correctAnswer: result.correctAnswer,
          };
        } finally {
          stopEngage?.();
          narrator.state?.("idle");
        }
      },
    }),

    think: llm.tool({
      description:
        "When the student asks a hard problem you'd rather not improvise on (multi-step math, careful proofs, tricky 'why does this work' questions), pause and consult a smart reasoning model. Call as think({question, context?}). Takes 2-4 seconds. BEFORE calling, say 'let me think about this for a sec' or similar. Returns a step-by-step answer (with $...$ LaTeX); rephrase it naturally for the student and write any formulas using create_equation as you narrate.",
      parameters: thinkArgs,
      execute: async (args: ThinkArgs) => {
        const stopEngage = narrator.engage?.("thinking");
        narrator.state?.("thinking", args.question.slice(0, 60));
        try {
          const result = await think(args);
          if (!result.ok) return { ok: false, error: result.error };
          return {
            ok: true,
            answer: result.answer,
            latencyMs: result.latencyMs,
          };
        } finally {
          stopEngage?.();
          narrator.state?.("idle");
        }
      },
    }),
  };
}
