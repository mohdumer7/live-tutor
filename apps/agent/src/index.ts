import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

// Load env from the monorepo root before any LiveKit/Google modules read
// process.env. tsx/node CLI flag plumbing is fragile; doing it in code is
// bulletproof.
dotenv.config({
  path: path.resolve(fileURLToPath(import.meta.url), "../../../../.env"),
});

import {
  AutoSubscribe,
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
import * as openai from "@livekit/agents-plugin-openai";
import {
  DEFAULT_PERSONA,
  DEFAULT_VOICE,
  TOPIC_AGENT_STATE,
  TOPIC_MINIGAME_ERROR,
  TOPIC_STUDENT_DREW,
  TOPIC_STUDENT_MESSAGE,
  TOPIC_TRANSCRIPT,
  getPersona,
  lessonConfigSchema,
  minigameErrorEnvelope,
  studentDrewEnvelope,
  type AgentState,
  type AgentStateEnvelope,
  type LessonConfig,
  type TranscriptEnvelope,
} from "@live-tutor/schema";
import { createRpcClient, type RpcRoom } from "./tools/rpc.js";
import {
  createCanvasTools,
  type MinigameCache,
  type Narrator,
} from "./tools/canvas-tools.js";
import { createSceneState } from "./scene-state.js";
import { regenerateMinigame } from "./tools/minigame-gen.js";

const ROOM_EVENT_DATA_RECEIVED = "dataReceived";
const decoder = new TextDecoder();

// Engagement-during-slow-tools filler schedules. Each kind targets a
// realistic latency profile for that tool. The first line fires
// immediately so the student knows the request was heard; later lines
// only fire if the tool is still running by then (cancelled the moment
// the tool returns). See narrator.engage() in the entry function.
type EngagementSchedule = ReadonlyArray<{ at: number; line: string }>;

const ENGAGEMENT_FILLERS: Record<
  | "thinking"
  | "looking"
  | "image"
  | "video"
  | "plan"
  | "game"
  | "grading",
  EngagementSchedule
> = {
  // Claude reasoning, ~2-4s typical
  thinking: [
    { at: 0, line: "Hmm, let me work through that for a second." },
    { at: 7000, line: "Just thinking it through, almost there." },
    { at: 14000, line: "Need to be careful with this one — give me a moment." },
    { at: 22000, line: "Sorry for the pause, wrapping it up now." },
  ],
  // Canvas vision (Claude image input), ~2-3s typical
  looking: [
    { at: 0, line: "Let me take a closer look at what you've got." },
    { at: 6000, line: "Just making sure I'm reading it right." },
    { at: 12000, line: "Almost done, give me a second." },
  ],
  // fal.ai image generation, ~10-30s typical
  image: [
    { at: 0, line: "Let me put together a picture for you, give me a moment." },
    { at: 7000, line: "Just sketching it now." },
    { at: 15000, line: "Almost there — getting the details right." },
    { at: 25000, line: "Final brushstrokes, hang on." },
  ],
  // fal.ai video generation, ~30-90s typical
  video: [
    { at: 0, line: "Filming a quick clip for you — this one takes a bit." },
    { at: 12000, line: "Still rendering, usually about half a minute." },
    { at: 25000, line: "Halfway through, hang in there." },
    { at: 45000, line: "Almost there with the video." },
    { at: 70000, line: "Final pass, nearly ready." },
  ],
  // Claude lesson planning, ~3-6s typical
  plan: [
    { at: 0, line: "Great topic. Let me put together a plan for us." },
    { at: 7000, line: "Just organizing the modules nicely." },
    { at: 14000, line: "Almost have your roadmap ready." },
  ],
  // Claude HTML game generation, ~5-15s typical
  game: [
    { at: 0, line: "Building you a small game — give me a moment." },
    { at: 7000, line: "Wiring up the interactions." },
    { at: 13000, line: "Almost ready to play." },
  ],
  // Claude grading, ~2-4s typical
  grading: [
    { at: 0, line: "Let me check that carefully." },
    { at: 6000, line: "Just verifying the steps." },
    { at: 12000, line: "Almost done." },
  ],
};

const TUTOR_INSTRUCTIONS = `You are a friendly, patient AI tutor for an 8th-grade math student.

You share a digital whiteboard with the student and you can draw on it while
you explain. Use it generously — writing things down makes lessons stick.

WRITE & EDIT:
- create_text(text, x, y, fontSize?, color?) — write a short label. Returns shape id.
- update_shape(id, x?, y?, text?, color?) — change something you wrote earlier.
- delete_shape(id) — remove one shape.
- clear_canvas() — wipe everything (only when starting a new topic).

DRAW SHAPES:
- create_shape(kind, x, y, w, h, color?, fill?) — kind is rect | ellipse | arrow | line.
  For a circle, use ellipse with equal w and h.
- create_highlight(x, y, w, h, color?) — translucent yellow rectangle, sent to back.

MATH:
- create_equation(latex, x, y, w?, h?, fontSize?) — typeset a LaTeX equation.
  ALWAYS use this for math (formulas, expressions, equations). Never write math
  as plain text via create_text. Examples: 'x^2 + y^2 = r^2', '\\\\frac{a}{b}',
  '\\\\pi r^2', 'A = \\\\frac{1}{2} b h'.
- create_plot(expression, xMin, xMax, x, y, w, h, yMin?, yMax?, title?) —
  plot a function of x. Uses function-plot syntax (NOT LaTeX): 'x^2', 'sin(x)',
  '2*x+1', 'sqrt(x)'. Use whenever a graph would help.

VISUALS:
- generate_image(prompt, x, y, w?, h?) — request an AI-generated picture for
  things words can't show: 'a labeled animal cell', 'the solar system'.
  IMPORTANT: this calls OpenAI gpt-image-1 and takes 10-30 SECONDS. Before
  calling: tell the student you're getting a picture, then keep talking
  about the topic while they wait — don't go silent. The image arrives
  when it arrives; resume normal narration once it's there.
- generate_video(prompt, x, y, w?, h?) — request a short AI-generated video
  clip (~5 seconds). Use SPARINGLY — only when motion / time evolution is
  the whole point: 'water cycle in time-lapse', 'bouncing ball showing
  parabolic motion', 'a paper plane gliding'. Takes 30-90 SECONDS. The
  system speaks an automatic filler. Don't use for static topics —
  generate_image is much faster.
- generate_minigame(description, x, y, w?, h?) — generate an interactive
  HTML5 mini-game on the canvas (sandboxed iframe). Three rendering
  capabilities are available; YOU decide which the description should
  request based on the topic — never make the student say the words
  "3D" or "physics" themselves:

    * 3D scenes with three.js + cannon-es physics — pick this AUTOMATICALLY
      for: pendulums, projectile motion, planetary orbits, atomic / molecular
      structure, geometry of solids, anything where 3 axes matter, anything
      where rigid-body collisions / gravity is the lesson.
      Example description you'd build: "A 3D ramp with a ball rolling
      down — student drags a slider for ramp angle, observes how the ball
      speeds up. Use cannon-es for gravity and three.js OrbitControls so
      the student can look around. Show numeric speed readout."

    * 2D physics with matter.js — pick for: 2D pendulums, billiards,
      lever / pulley problems, polygon collisions when 2D is enough.

    * Plain DOM/CSS/JS — pick for: matching / sorting / drag-drop quizzes,
      sliders that don't need a real physics body, flashcards, click-to-
      reveal, drawing exercises.

  Be VERY specific about rules, win condition, what the student does, what
  feedback to show. Takes 30-90 seconds (3D scenes are 60-90s; the system
  shows a skeleton loader on the canvas the whole time and speaks an
  automatic filler). Default size 420x360; bump to 500x400+ for 3D scenes
  so the camera has room.

  KEEP SCOPE SMALL — this is the single biggest reliability lever:
  - ONE interactive object, not five. ONE control / slider / toggle, not
    a UI panel of options. ONE win condition, not a level progression.
  - "Roll a single ball down an adjustable ramp" beats "platformer with
    multiple obstacles and a score and a timer". The latter looks
    impressive but breaks 4 ways out of 5.
  - For physics topics: prefer a single demonstrable phenomenon (one
    pendulum, one inclined plane, one object in two fluids) over a full
    game. The student is learning the concept, not playing a long game.
  - If the student asks for a full game ("3D car racing"), translate it
    down to the lesson core ("a 3D scene where a single car drives in
    a straight line — student varies the engine power slider and watches
    the speed/acceleration plot"). Less rendering, more pedagogy.

  More example descriptions you'd build on your own:
    "Match each fraction tile to its decimal equivalent — 4 pairs, drag
    them onto the matching slot. Green tick on match, red shake on miss."
    (plain DOM — no physics needed)

    "3D pendulum: a sphere on a rod hanging from a pivot. Student drags
    the sphere to displace it, releases, watches it swing. Use cannon-es
    for the constraint and three.js with OrbitControls. Show the period
    in seconds at the corner."
    (3D + physics — pendulums are a physics topic)

    "3D solar system: sun in the center, six inner planets orbiting at
    realistic relative speeds. OrbitControls for camera. Click a planet
    to show its name and orbital period as a label."
    (3D — spatial / planetary topic)
- repair_minigame(id, studentComplaint) — call this WHENEVER a student
  reports a minigame isn't working ("the start button doesn't do anything",
  "nothing happens when I click", "it's broken", "the ball is stuck", etc).
  Pass the shape id you got back from generate_minigame plus the student's
  literal complaint. Don't ask them to restart manually — auto-repair the
  game by calling this tool. Takes 30-90s. After it returns, briefly tell
  the student "fixed it — try again". If a game crashes with a JS error
  the system also auto-repairs without you needing to call this; this
  tool is for SILENT failures where no exception fires.
- create_svg(svg, x, y, w, h) — paste a complete inline '<svg>...</svg>'
  diagram. Use for custom geometry / coordinate-axes you can hand-craft when
  create_shape primitives aren't expressive enough. Instant.

DEEP REASONING (the 'think' tool):
- think({question, context?}) — when a problem needs careful step-by-step
  thinking (long algebra, geometry proofs, 'why does this work' questions),
  ask a smart reasoning model. Takes 2-4s.
- Pattern: BEFORE you call, say "let me think about that for a moment".
  AFTER it returns, narrate the answer naturally and write any formulas with
  create_equation. Don't read the raw response verbatim — explain it.

LESSON PLANNING (do this FIRST for broad requests):
- When the student asks to learn something broad ("teach me linear algebra",
  "help me with photosynthesis", "I want to understand the French
  Revolution"), the FIRST tool you call is plan_lesson({topic, level?,
  durationHint?}). It returns a structured 4-7 module plan and places a
  visible checklist on the canvas.
- After plan_lesson returns:
  1. Briefly narrate the plan (just module titles, one short sentence per
     module — don't read every subtopic).
  2. Begin teaching module 1 immediately. Don't wait for the student to
     ask "what's next".
- For each module, follow this pattern:
  1. Conceptual narration in your own voice.
  2. Use AT LEAST one visualization that fits the module's
     suggestedTools — equation for formulas, plot for functions, image
     for things words can't show, video for motion/processes, minigame
     for hands-on practice. Don't pile them on; pick what's truly useful.
  3. Verify understanding briefly ("does that make sense?" or a tiny
     practice problem).
  4. When the module is finished, call update_curriculum with status
     'complete' for that module. If a next module exists, call
     update_curriculum AGAIN to mark it 'in_progress'.
- The curriculum is visible on the canvas AND its compact status
  ("✓◐○○○") appears in the scene digest every turn — so you can always
  see where you are. If you forget the current module, look at the
  scene digest's curriculum line.
- If the student asks a tangential question, answer it briefly, then
  return: "OK, back to [current module title]…". Don't lose the thread.
- Use the curriculum notes field (via the note arg on update_curriculum)
  for student-specific observations: "got stuck on dot product",
  "loved the airplane analogy". Future-you will read these in the
  scene digest.

PRACTICE PROBLEMS:
- When the student asks for a practice problem (or you decide it's time to
  test understanding):
  1. Pick a problem at the right level (don't over-shoot).
  2. Place it on the canvas with create_equation, then label_shape it
     (e.g. label "Practice 1") so you can refer back later.
  3. Briefly say "Try this one — write your answer on the canvas or tell
     me", then STOP. Wait for them.
- When the student gives an answer (handwritten, typed, or spoken):
  1. Capture their answer as best you can. If it was handwritten, the
     handwriting auto-trigger may already have transcribed it as LaTeX.
  2. Call grade_answer({problem, studentAnswer, expectedAnswer?}). Don't
     guess — let the grader decide.
  3. When grade_answer returns:
     - 'correct' → enthusiastic 1-sentence praise, optionally a small
       follow-up question or harder problem.
     - 'partial' → name what they got right, what to fix, in 1-2 sentences.
     - 'incorrect' → reassure, narrate the correct path step-by-step,
       writing key steps with create_equation as you go.

ATTENTION & VIEW:
- point_at(targetId | x,y) — flash a glowing dot to direct attention.
- pan_to(targetId | x,y, zoom?) — move the camera; pass a targetId to frame a shape.
- zoom_to(zoom) — set zoom level (1.0 = 100%).

INTROSPECT:
- list_shapes() — see every shape on the canvas with id, kind, position, and bounds.
- get_focus() — see what the student is paying attention to right now: viewport,
  selectedIds, hoveredId, cursor, recentlyTouchedIds.
- label_shape(id, label) — attach a short semantic name to a shape so you can
  refer back later by meaning ("the area formula") instead of by id.
- look_at_canvas({question?}) — take a visual snapshot and ask a vision model
  what's on it. Use this when the text digest isn't enough — especially when
  the student has just drawn something freehand, or asks "is this right?" or
  "what about this?". Pass a focused question for better answers.

PAGES (multi-page whiteboard):
- The whiteboard supports multiple pages. The scene digest header lists them
  when there's more than one (★ marks the current page).
- create_page({name?, switchTo?}) — start a fresh page. Use when starting a
  new sub-topic or a new practice problem so the canvas stays uncluttered.
- list_pages() — get all pages with ids and names plus the current page.
- switch_page({pageId | name}) — change the active page.
- All other create_*/update_*/look_at_canvas calls operate on the CURRENT
  page, so switch first if you mean a different one.

STUDENT vs AGENT shapes:
- The scene digest marks shapes you didn't create as *student-drawn*.
- When you see new student-drawn entries (especially strokes), the student
  has been drawing on the whiteboard. Acknowledge it and consider calling
  look_at_canvas to actually see what they made before commenting.

HANDWRITING AUTO-TRIGGER:
- Whenever the student finishes drawing on the whiteboard, the system
  AUTOMATICALLY hands you a turn with instructions that tell you to call
  look_at_canvas, recognize handwritten math, and typeset it with
  create_equation. Follow those instructions tightly — don't elaborate.
- If their drawing isn't math (doodle, diagram, scribble), acknowledge
  briefly in ONE sentence and stop. Don't lecture them or quiz them.

SPATIAL DEIXIS — when the student says "here", "there", "this", "that":
1. Call get_focus() first.
2. Prefer hoveredId if present, then selectedIds[0], then recentlyTouchedIds[0],
   then cursor coordinates.
3. To draw something AROUND a shape (e.g. "circle this"): use the shape's
   bounds (from list_shapes or scene digest) and call create_shape with
   x = bounds.x - padding, y = bounds.y - padding,
   w = bounds.w + 2*padding, h = bounds.h + 2*padding (padding ≈ 16).

COORDINATES & LAYOUT:
- Page space, (0,0) near the upper-left of the student's view.
- Default first label near (50, 50). Space new content with ~20px gap
  beneath the previous shape's bottom edge so the canvas stays readable.
- The scene digest gives you (x, y) AND (w, h) for every shape — USE
  THAT to compute the next y as prev.y + prev.h + 20. Do not just
  guess at (50, 200) and hope.
- The dispatcher auto-nudges new shapes downward if they would overlap
  existing shapes — when this happens, the tool result includes a
  "warning" field with the adjusted coordinates. Don't ignore: it
  means you placed at coordinates that collided. Update your mental
  model of the canvas and place future shapes properly.
- create_highlight is the exception: it's supposed to overlap (it sits
  behind text to draw attention) and is NOT auto-nudged.
- Use get_focus().viewport to know what's visible if you need to place
  something where the student can see it.

BEHAVIOR:
- Greet the student warmly when you join.
- Keep speech conversational and concise — short sentences.
- Narrate while you draw ("let me circle this for you…").
- Remember the ids you create so you can refer back. If you forget, call
  list_shapes — don't ask the student.

SLOW TOOLS — important:
- think / generate_image / look_at_canvas all take 2-30 seconds.
- For these three tools the system AUTOMATICALLY speaks a short filler
  phrase when you call them ("Let me think about that for a moment", etc).
- DO NOT also say "let me think" or "let me grab a picture" yourself —
  it would double up. Just call the tool and, when it returns, go straight
  into narrating the substantive answer.

TOOL RESULT WARNINGS:
- Some create_* tools may return data with a 'warning' field, e.g. when a
  shape lands far off-screen. If you see one, briefly mention it to the
  student or pan_to bring the shape into view. Don't ignore.
`;

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    // The room object from rtc-node implements .on / .off / .localParticipant
    // — close enough to the structural type RpcRoom expects.
    const room = ctx.room as unknown as RpcRoom;
    const rpc = createRpcClient(room);
    const sceneState = createSceneState(room);
    // Narrator is a no-op until session.start() returns. Tools that take a
    // long time call narrator.say() to keep the audio channel filled while
    // the heavy work runs in parallel; the .say + .state methods are
    // re-pointed inside startRealtimeSession on every (re)start.
    const narrator: Narrator = { say: () => {} };

    // engage(kind) schedules a sequence of timed "still working" fillers
    // so the tutor keeps the student engaged during slow tool calls
    // instead of going silent. Returns a cancel function — slow tools
    // call it in a finally{} so any not-yet-spoken fillers stop the
    // moment the real answer is ready.
    narrator.engage = (kind) => {
      const schedule = ENGAGEMENT_FILLERS[kind] ?? [];
      let alive = true;
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (const entry of schedule) {
        timers.push(
          setTimeout(() => {
            if (!alive) return;
            narrator.say(entry.line);
          }, entry.at),
        );
      }
      return () => {
        alive = false;
        for (const t of timers) clearTimeout(t);
      };
    };

    const minigameCache: MinigameCache = new Map();
    const tools = createCanvasTools(rpc, sceneState, narrator, minigameCache);

    // Phase B helpers: publish transcript and state envelopes over the data
    // channel so the FE can render captions and a status banner. These live
    // outside the session because the room (and its data channel) survives
    // session restarts.
    const dcEncoder = new TextEncoder();
    const publish = (topic: string, payload: unknown): void => {
      try {
        const lp = (
          ctx.room as unknown as {
            localParticipant?: {
              publishData(
                data: Uint8Array,
                opts: { reliable?: boolean; topic?: string },
              ): Promise<void>;
            };
          }
        ).localParticipant;
        if (!lp) return;
        void lp.publishData(dcEncoder.encode(JSON.stringify(payload)), {
          reliable: true,
          topic,
        });
      } catch (err) {
        console.warn(`[agent] publish ${topic} failed:`, err);
      }
    };

    const publishTranscript = (
      role: "student" | "tutor",
      text: string,
      source: "voice" | "text" = "voice",
    ): void => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const env: TranscriptEnvelope = {
        kind: "transcript",
        role,
        text: trimmed,
        source,
        timestamp: Date.now(),
      };
      publish(TOPIC_TRANSCRIPT, env);
    };

    const publishState = (state: AgentState, detail?: string): void => {
      const env: AgentStateEnvelope = {
        kind: "agent_state",
        state,
        detail,
        timestamp: Date.now(),
      };
      publish(TOPIC_AGENT_STATE, env);
    };
    (narrator as unknown as { state?: typeof publishState }).state =
      publishState;

    publishState("idle");

    /* ------------------------------------------------------------------- */
    /* Lesson config from participant metadata                              */
    /* ------------------------------------------------------------------- */
    // The student's token carries a JSON metadata field with voice +
    // persona + subject / grade / topic. We resolve it once when needed and
    // pass through to the realtime model + system prompt.
    const resolveLessonConfig = (): LessonConfig => {
      const fallback: LessonConfig = {
        voice: DEFAULT_VOICE,
        persona: DEFAULT_PERSONA,
      };
      try {
        const remotes = (
          ctx.room as unknown as {
            remoteParticipants?: Map<string, { metadata?: string }>;
          }
        ).remoteParticipants;
        if (!remotes) return fallback;
        for (const p of remotes.values()) {
          if (!p.metadata) continue;
          try {
            const parsed = lessonConfigSchema.parse(JSON.parse(p.metadata));
            return parsed;
          } catch {
            // Malformed — try the next participant. The student is usually
            // the only remote anyway.
          }
        }
      } catch (err) {
        console.warn("[agent] resolveLessonConfig failed:", err);
      }
      return fallback;
    };

    /* ------------------------------------------------------------------- */
    /* Auto-restart wrapper                                                  */
    /* ------------------------------------------------------------------- */
    // Gemini Live's WebSocket can drop on its own — server-side internal
    // errors (close 1011), idle timeouts (1006), or random hiccups. None of
    // those should kill the student's session. We track the live session in
    // `currentSession`, swap it out when it dies, and only give up after
    // MAX_RESTARTS consecutive failures.
    let currentSession: voice.AgentSession | null = null;
    let sessionAlive = false;
    let restartCount = 0;
    let lastSuccessfulStart = 0;
    const MAX_RESTARTS = 4;

    const startRealtimeSession = async (
      isRestart: boolean,
    ): Promise<void> => {
      // Re-read every (re)start so a participant joining late can still
      // override defaults — and so we don't bake stale config into a
      // restarted session.
      const cfg = resolveLessonConfig();
      const personaPreset = getPersona(cfg.persona);
      const lessonHeader = [
        cfg.subject ? `Subject: ${cfg.subject}` : null,
        cfg.grade ? `Grade: ${cfg.grade}` : null,
        cfg.topic ? `Topic: ${cfg.topic}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const personalizedInstructions =
        TUTOR_INSTRUCTIONS +
        (lessonHeader ? `\n\nLESSON CONTEXT:\n${lessonHeader}` : "") +
        `\n\n${personaPreset.promptAddendum}`;

      // Pick the realtime LLM. Default is Gemini Live — chosen over OpenAI
      // Realtime because Gemini's tool-calling reliability is noticeably
      // better in our setup (the tutor uses 25+ tools and the choice of
      // which to fire matters). Set REALTIME_PROVIDER=openai to A/B against
      // OpenAI's gpt-realtime-2 (faster voice but weaker tool choice).
      const useOpenAI = process.env.REALTIME_PROVIDER === "openai";
      const llm = !useOpenAI
        ? new google.beta.realtime.RealtimeModel({
            model:
              process.env.GEMINI_LIVE_MODEL ||
              "gemini-2.5-flash-native-audio-latest",
            voice: cfg.voice,
            temperature: 0.8,
            instructions: personalizedInstructions,
            realtimeInputConfig: {
              activityHandling: "NO_INTERRUPTION" as never,
            },
            thinkingConfig: { thinkingBudget: 0 },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          })
        : new openai.realtime.RealtimeModel({
            // gpt-realtime-2 is OpenAI's newest GA realtime model (Apr 2026).
            // Override via OPENAI_REALTIME_MODEL if you want to A/B against
            // gpt-realtime, gpt-realtime-mini, etc.
            model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2",
            voice: mapVoiceForOpenAI(cfg.voice),
            // semantic_vad uses an LLM-based "did the student finish their
            // thought" classifier instead of a simple silence-threshold
            // detector. Tighter turn-taking with fewer false cuts. The
            // `eagerness: high` makes it commit quickly once it thinks
            // you're done. interrupt_response=false prevents the same
            // truncate-style crashes we hit on Gemini.
            turnDetection: {
              type: "semantic_vad",
              eagerness: "high",
              create_response: true,
              interrupt_response: false,
            },
            // whisper-1 transcribes student speech for the FE caption panel.
            // (Tutor output transcription comes automatically via
            // response.audio_transcript.delta events.)
            inputAudioTranscription: {
              model: "whisper-1",
            },
          });

      const session = new voice.AgentSession({
        turnHandling: {
          interruption: { enabled: false },
          // Start generating the reply as soon as VAD detects end-of-speech
          // instead of waiting for the framework's own endpointing. Cuts
          // perceived response latency by ~1-2s.
          preemptiveGeneration: { enabled: true },
        },
        // No echo cancellation warmup — we have no barge-in, so the 3s
        // suppression at session start was just dead air.
        aecWarmupDuration: null,
        llm,
      });

      // OpenAI Realtime takes `instructions` via session.update rather than
      // through the constructor. The voice.Agent's `instructions` field
      // (set below) gets propagated through the framework's session.update
      // sequence.

      const agent = new voice.Agent({
        instructions: personalizedInstructions,
        tools,
      });

      try {
        await session.start({ agent, room: ctx.room });
      } catch (err) {
        console.warn("[agent] session.start failed:", err);
        scheduleRestart("start failed");
        return;
      }

      currentSession = session;
      sessionAlive = true;
      lastSuccessfulStart = Date.now();

      // Wire the narrator's say() so slow tools can keep audio flowing.
      //
      // Realtime models (Gemini Live, OpenAI Realtime) generate audio from
      // the LLM directly — they have no separate TTS, so `session.say(text)`
      // throws "trying to generate speech from text without a TTS model".
      // Instead, we trigger a fresh turn via `generateReply` with an
      // instruction that paraphrases the filler line in the tutor's own
      // voice. This is louder than canned TTS but matches the persona.
      narrator.say = (text: string) => {
        try {
          const s = session as unknown as {
            generateReply?: (opts: { instructions: string }) => unknown;
            say?: (s: string) => unknown;
          };
          if (typeof s.generateReply === "function") {
            s.generateReply({
              instructions: `Briefly say "${text.replace(/"/g, "'")}" to the student in your own conversational voice. One short sentence. Do not repeat any explanation; this is just a filler line while a long tool call is in flight.`,
            });
          } else if (typeof s.say === "function") {
            // Fallback for non-realtime (TTS-backed) configurations.
            s.say(text);
          }
        } catch (err) {
          // Don't spam logs — engagement is best-effort. A single warn
          // line is enough to diagnose if it ever flat-out breaks.
          console.warn(
            "[narrator] say skipped:",
            err instanceof Error ? err.message : String(err),
          );
        }
      };

      // Subscribe to the realtime model's transcription + state events on
      // THIS session. Old sessions' listeners die with their session.
      const evt = session as unknown as {
        on(name: string, cb: (e: unknown) => void): void;
      };

      evt.on("user_input_transcribed", (raw) => {
        const e = raw as { transcript?: unknown; isFinal?: unknown };
        if (e.isFinal !== true) return;
        if (typeof e.transcript === "string") {
          publishTranscript("student", e.transcript, "voice");
        }
      });

      evt.on("conversation_item_added", (raw) => {
        const e = raw as {
          item?: { role?: unknown; textContent?: unknown };
        };
        const item = e.item;
        if (!item) return;
        if (
          item.role === "assistant" &&
          typeof item.textContent === "string"
        ) {
          publishTranscript("tutor", item.textContent, "voice");
        }
      });

      evt.on("agent_state_changed", (raw) => {
        const e = raw as { newState?: unknown };
        const s = e.newState;
        if (s === "speaking") publishState("speaking");
        else if (s === "thinking") publishState("thinking");
        else if (s === "listening") publishState("listening");
        else if (s === "idle") publishState("idle");
      });

      evt.on("error", (ev) => {
        console.warn("[agent] session error:", ev);
      });
      evt.on("close", (ev) => {
        console.warn("[agent] session closed:", ev);
        if (currentSession !== session) {
          // A newer session already replaced this one; ignore the late close.
          return;
        }
        sessionAlive = false;
        currentSession = null;
        scheduleRestart("session closed");
      });

      // First start = warm greeting. Restart = brief reconnection note.
      const greetingInstructions = isRestart
        ? "We had a brief hiccup, but you're reconnected. In ONE short sentence let the student know you're back and ready to continue."
        : "Greet the student warmly in one short sentence and ask what they'd like to work on today.";
      try {
        await session.generateReply({ instructions: greetingInstructions });
      } catch (err) {
        console.warn("[agent] initial generateReply failed:", err);
      }
    };

    const scheduleRestart = (reason: string): void => {
      // Reset the restart counter if the previous session lived for a while.
      // Anything > 30s of healthy operation = the failures aren't immediately
      // recurring, so we should be allowed full retries again next time.
      if (Date.now() - lastSuccessfulStart > 30_000) restartCount = 0;

      if (restartCount >= MAX_RESTARTS) {
        console.warn(
          `[agent] giving up after ${restartCount} restart attempts (${reason})`,
        );
        publishState("idle", "tutor unavailable — please reload");
        try {
          const shutdown = (
            ctx as unknown as { shutdown?: (reason?: string) => void }
          ).shutdown;
          shutdown?.call(ctx, "max restarts reached");
        } catch {
          /* nothing more to do */
        }
        return;
      }
      restartCount += 1;
      const backoff = Math.min(1500 * restartCount, 6000);
      console.log(
        `[agent] restarting realtime session in ${backoff}ms (attempt ${restartCount}/${MAX_RESTARTS}, reason: ${reason})`,
      );
      publishState(
        "thinking",
        `reconnecting (attempt ${restartCount}/${MAX_RESTARTS})`,
      );
      setTimeout(() => {
        void startRealtimeSession(true);
      }, backoff);
    };

    // Briefly wait for the student participant to land before starting the
    // first session, so their voice/persona metadata is available. Cap at
    // 500ms — students nearly always join within ~100ms of dispatch and
    // we'd rather miss the metadata in edge cases than hold up everything.
    publishState("thinking", "connecting tutor…");
    await waitForRemoteParticipant(ctx.room, 500);
    await startRealtimeSession(false);

    // Forward typed student messages into the realtime session as user input.
    //
    // Dedup window: if the user mashes the same chip / send button multiple
    // times in quick succession, drop the repeats so the model isn't flooded
    // with N identical generateReply calls (which manifests as 30+s of
    // stacked filler narration before any real reply).
    const STUDENT_MSG_DEDUP_MS = 3000;
    let lastStudentText: string | null = null;
    let lastStudentTextAt = 0;

    ctx.room.on(
      ROOM_EVENT_DATA_RECEIVED,
      (
        payload: Uint8Array,
        _participant?: unknown,
        _kind?: number,
        topic?: string,
      ) => {
        if (topic !== TOPIC_STUDENT_MESSAGE) return;
        const session = currentSession;
        if (!session || !sessionAlive) {
          console.warn(
            "[agent] dropped student_message — session not ready (reconnecting?)",
          );
          return;
        }
        try {
          const parsed = JSON.parse(decoder.decode(payload)) as {
            type?: string;
            text?: string;
          };
          if (parsed.type !== "student_message" || !parsed.text) return;
          const now = Date.now();
          if (
            parsed.text === lastStudentText &&
            now - lastStudentTextAt < STUDENT_MSG_DEDUP_MS
          ) {
            console.log(
              "[agent] dropped duplicate student message:",
              parsed.text,
            );
            return;
          }
          lastStudentText = parsed.text;
          lastStudentTextAt = now;
          console.log("[agent] student typed:", parsed.text);
          publishTranscript("student", parsed.text, "text");
          try {
            session.generateReply({ userInput: parsed.text });
          } catch (err) {
            console.warn("[agent] generateReply failed:", err);
          }
        } catch (err) {
          console.warn("[agent] failed to parse student message:", err);
        }
      },
    );

    // Phase D1: when the student finishes drawing on the canvas, nudge the
    // tutor to take a turn. The instructions tell it to look_at_canvas with
    // a focused question, and if the strokes look like handwritten math, to
    // typeset them with create_equation alongside the student's writing.
    let lastStudentDrewAt = 0;
    ctx.room.on(
      ROOM_EVENT_DATA_RECEIVED,
      (
        payload: Uint8Array,
        _participant?: unknown,
        _kind?: number,
        topic?: string,
      ) => {
        if (topic !== TOPIC_STUDENT_DREW) return;
        const session = currentSession;
        if (!session || !sessionAlive) return;
        let env;
        try {
          env = studentDrewEnvelope.parse(JSON.parse(decoder.decode(payload)));
        } catch (err) {
          console.warn("[agent] invalid student_drew envelope:", err);
          return;
        }
        // Coalesce rapid-fire nudges. The FE already debounces 1.5s but we
        // also throttle on this side in case multiple bursts come through.
        const now = Date.now();
        if (now - lastStudentDrewAt < 2000) {
          console.log(
            "[agent] dropped student_drew nudge — recent one already in flight",
          );
          return;
        }
        lastStudentDrewAt = now;
        console.log("[agent] student drew:", env.shapeIds.join(", "));
        try {
          session.generateReply({
            instructions: `The student just finished drawing on the whiteboard. Their new strokes have ids ${env.shapeIds.join(", ")} and span the box (${Math.round(env.bounds.x)}, ${Math.round(env.bounds.y)}) size ${Math.round(env.bounds.w)}x${Math.round(env.bounds.h)}.

Call look_at_canvas with the question: "Are these strokes handwritten math? If yes return ONLY the LaTeX. If no, briefly describe what they drew."

If the response contains LaTeX (no "NOT_MATH" / "no" prefix), call create_equation to typeset it just to the right of the strokes (x ≈ ${Math.round(env.bounds.x + env.bounds.w + 16)}, y ≈ ${Math.round(env.bounds.y)}, default w/h). Then briefly say one short sentence like "I see — that's [latex]." Don't repeat the LaTeX literally; describe it conversationally.

If it's not math (a doodle, a shape, etc.), just acknowledge briefly in one short sentence and stop. Don't quiz them about it.`,
          });
        } catch (err) {
          console.warn("[agent] generateReply for student_drew failed:", err);
        }
      },
    );

    // Minigame self-healing: the FE reports runtime errors / no-boot
    // failures from the sandboxed game iframe; we ask Claude to patch the
    // HTML and push the corrected document back over the data channel.
    // Per-shape attempt cap is enforced both here and on the FE — defense
    // in depth in case one side glitches.
    const minigameRepairAttempts = new Map<string, number>();
    const MAX_AGENT_REPAIR_ATTEMPTS = 2;
    let lastMinigameRepairAt = 0;

    ctx.room.on(
      ROOM_EVENT_DATA_RECEIVED,
      (
        payload: Uint8Array,
        _participant?: unknown,
        _kind?: number,
        topic?: string,
      ) => {
        if (topic !== TOPIC_MINIGAME_ERROR) return;
        const session = currentSession;
        if (!session || !sessionAlive) {
          console.warn("[agent] dropped minigame_error — session not ready");
          return;
        }
        let env;
        try {
          env = minigameErrorEnvelope.parse(
            JSON.parse(decoder.decode(payload)),
          );
        } catch (err) {
          console.warn("[agent] invalid minigame_error envelope:", err);
          return;
        }
        const prev = minigameRepairAttempts.get(env.shapeId) ?? 0;
        if (prev >= MAX_AGENT_REPAIR_ATTEMPTS) {
          console.warn(
            `[agent] minigame ${env.shapeId} already repaired ${prev}× — giving up`,
          );
          return;
        }
        const now = Date.now();
        if (now - lastMinigameRepairAt < 2000) {
          console.log("[agent] dropping minigame_error — too soon after last");
          return;
        }
        lastMinigameRepairAt = now;
        minigameRepairAttempts.set(env.shapeId, prev + 1);
        const errSummary = env.errors
          .slice(0, 3)
          .map((e) => `${e.type}: ${e.message.slice(0, 80)}`)
          .join(" | ");
        console.log(
          `[agent] minigame ${env.shapeId} crashed (attempt ${env.attempt}): ${errSummary}`,
        );
        void (async () => {
          const stopEngage = narrator.engage?.("game");
          narrator.state?.(
            "thinking",
            `repairing minigame ${env.shapeId.slice(-6)}`,
          );
          try {
            const result = await regenerateMinigame({
              description: env.description,
              title: env.title,
              brokenHtml: env.brokenHtml,
              errors: env.errors,
            });
            if (!result.ok) {
              console.warn(
                `[agent] regenerateMinigame failed: ${result.error}`,
              );
              return;
            }
            await rpc.call({
              tool: "replace_minigame_html",
              args: {
                id: env.shapeId,
                html: result.html,
                title: result.title,
              },
            });
            // Keep the cache in sync so a follow-up `repair_minigame` call
            // (model-initiated when student says "still not working") gets
            // the freshly-patched html, not the original broken one.
            minigameCache.set(env.shapeId, {
              html: result.html,
              title: result.title,
              description: env.description,
            });
            console.log(
              `[agent] minigame ${env.shapeId} patched in ${result.latencyMs}ms`,
            );
            // Tell the model what happened so it can mention it briefly to
            // the student. Don't block on this — fire-and-forget.
            try {
              session.generateReply({
                instructions: `The minigame on the canvas (id ${env.shapeId}) just hit a runtime error and I auto-repaired it by regenerating the HTML through Claude. Briefly tell the student "oops, that game had a bug — I patched it, try again" in one short conversational sentence. Do NOT explain the error details.`,
              });
            } catch (err) {
              console.warn(
                "[agent] notify-after-repair generateReply failed:",
                err,
              );
            }
          } catch (err) {
            console.warn("[agent] minigame repair pipeline crashed:", err);
          } finally {
            stopEngage?.();
            narrator.state?.("idle");
          }
        })();
      },
    );
  },
});

// Map our internal voice ids (Puck / Charon / Kore / Fenrir / Aoede — the
// Gemini Live voice names we use as the canonical set) to the closest
// OpenAI Realtime equivalents. Override at the call site if a specific
// OpenAI voice is desired.
function mapVoiceForOpenAI(voice: string): string {
  switch (voice) {
    case "Puck":
      return "cedar"; // newest natural-sounding "friendly"
    case "Charon":
      return "sage"; // deeper, calm
    case "Kore":
      return "shimmer"; // bright, clear
    case "Fenrir":
      return "echo"; // energetic
    case "Aoede":
      return "marin"; // soft, gentle
    default:
      // If the env / metadata supplied a literal OpenAI voice name, pass
      // it through unchanged.
      return voice || "cedar";
  }
}

// Resolves once any remote participant is in the room (so its metadata is
// readable), or after the timeout — whichever comes first.
function waitForRemoteParticipant(
  room: unknown,
  timeoutMs: number,
): Promise<void> {
  const r = room as {
    remoteParticipants?: Map<string, unknown>;
    on?: (evt: string, cb: (...args: unknown[]) => void) => void;
    off?: (evt: string, cb: (...args: unknown[]) => void) => void;
  };
  if (r.remoteParticipants && r.remoteParticipants.size > 0)
    return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        r.off?.("participantConnected", finish);
      } catch {
        /* ignore */
      }
      resolve();
    };
    try {
      r.on?.("participantConnected", finish);
    } catch {
      /* ignore */
    }
    setTimeout(finish, timeoutMs);
  });
}

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    // Keep one subprocess prewarmed so a fresh dispatch doesn't pay the
    // cost of importing @livekit/agents-plugin-google + @anthropic-ai/sdk +
    // @fal-ai/client + the Gemini Live module each time. Cuts cold-start
    // by 5-10s on the first lesson after the worker boots.
    numIdleProcesses: 1,
  }),
);
