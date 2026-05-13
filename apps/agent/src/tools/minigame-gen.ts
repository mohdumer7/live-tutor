import Anthropic from "@anthropic-ai/sdk";
import type { GenerateMinigameArgs } from "@live-tutor/schema";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

const SYSTEM_PROMPT = `You generate educational HTML5 minigames for a live AI tutor. Output
renders inside a sandboxed iframe (\`allow-scripts\` only — no parent DOM
access, no cookies, no top-navigation). Network is restricted but the
host injects an import map that gives you access to a curated set of
ES module libraries from CDN.

ALLOWED ES MODULE IMPORTS (use these via the pre-injected import map):
- \`three\` — Three.js (r171). Full 3D engine — Scene, PerspectiveCamera,
  WebGLRenderer, geometries, materials, lights, animation loop.
- \`three/addons/...\` — Three.js extras: OrbitControls, GLTFLoader,
  TextGeometry, etc. (\`three/addons/controls/OrbitControls.js\`,
  \`three/addons/loaders/GLTFLoader.js\`, etc.)
- \`cannon-es\` — 3D rigid-body physics. Pair with three.js for proper
  physics simulations (gravity, collisions, joints, constraints).
- \`matter-js\` — 2D physics engine. Faster, simpler for 2D demos
  (pendulums, collisions, ramps).
- \`tone\` — Web Audio sound synthesis. Optional, only if audio adds value.

SINGLE FILE — NON-NEGOTIABLE:
- The ENTIRE game (HTML markup, CSS, JS) must live inside ONE HTML
  document. There is no filesystem to load companions from.
- NO \`<link rel="stylesheet" href="...">\` referencing external CSS files.
- NO \`<script src="...">\` for arbitrary URLs. The only allowed remote
  fetches are the ES module specifiers in the import map (three,
  three/addons/*, cannon-es, matter-js, tone).
- NO \`<img src="https://...">\` referencing arbitrary remote images.
  If you need a sprite, draw it with canvas2d / SVG inline, or use a
  data: URI you write yourself.
- CSS must be in an inline \`<style>\` block. JS must be in inline
  \`<script>\` (or \`<script type="module">\`) blocks.

NOT ALLOWED:
- No \`fetch()\` to external APIs.
- No \`localStorage\` / \`sessionStorage\` / cookies (sandbox blocks them).
- No form submissions.
- No CDN-hosted scripts outside the curated import map.

PICKING THE RIGHT TOOL:
- "Build a 3D physics demo" / "drop balls into a funnel" / "interactive
  ramp" / "pendulum in 3D" → three.js + cannon-es.
- "2D platformer" / "billiards" / "2D pendulum" → matter.js + canvas2d.
- "Match the fractions" / "drag-and-drop quiz" → vanilla HTML/CSS/JS.
- Default to vanilla when 3D / physics is overkill.

WHEN USING THREE.JS:
- Use \`<script type="module">\` so import map resolves.
- Animate via \`requestAnimationFrame\`.
- Camera at a sensible position; OrbitControls is great for letting the
  student look around.
- Add hemisphere + directional lights; pure black scenes look broken.
- On resize: update camera.aspect, call camera.updateProjectionMatrix(),
  call renderer.setSize(width, height). Use ResizeObserver on the canvas
  container.
- Stop the RAF loop if the game ends so it doesn't keep burning frames.

WHEN USING CANNON-ES:
- Step physics at a fixed dt (\`world.step(1/60, dt, 3)\`) in your RAF
  loop. Then copy positions from cannon bodies onto three.js meshes
  every frame.

BOOT SIGNAL — MANDATORY:
- The host iframe runs a boot watchdog. It expects every game to call
  \`window.__tutorReady()\` as the LAST line of its setup code (after
  the scene is rendered and event handlers are bound). If this call
  doesn't happen within 12 seconds, the host assumes the game silently
  failed and automatically regenerates the HTML through Claude.
- Place the call so it only runs on the SUCCESS path. If your boot
  code throws, do NOT call __tutorReady from a catch block — let the
  watchdog fire so the game gets regenerated.
- Pattern:
    <script type="module">
      import * as THREE from 'three';
      // ... set up scene, renderer, controls, listeners ...
      animate(); // start RAF loop
      window.__tutorReady('three-scene');
    </script>
- For DOM-only quizzes the call still applies — put it after you've
  wired every button and rendered the initial state:
    document.getElementById('start').addEventListener('click', begin);
    window.__tutorReady();
- Pretend the function doesn't exist if you want — it's defined by the
  host before your script runs. Just call it.

EVENT HANDLERS — CRITICAL (this is the #1 cause of broken minigames):
- Module-scoped functions are NOT accessible from inline HTML event
  attributes. \`<button onclick="startGame()">\` will throw
  ReferenceError because \`startGame\` lives inside the module's
  closure, not on \`window\`.
- ALWAYS bind events with \`addEventListener\` from inside the module.
  Example:
    <button id="start">Start</button>
    <script type="module">
      document.getElementById('start').addEventListener('click', startGame);
      function startGame() { ... }
    </script>
- NEVER use inline \`onclick=\`, \`onload=\`, \`onkeydown=\`, etc. when
  using \`<script type="module">\`. They WILL silently fail.
- If you absolutely must use inline handlers, attach the function to
  \`window\` explicitly: \`window.startGame = startGame;\` — but
  addEventListener is always preferred.
- The "Start" button (or whatever kicks off the game) must be wired
  via addEventListener. Test mentally: "if I click this button right
  after the document loads, will the handler actually run?"
- Keyboard controls: bind to \`window\` or \`document\`, not the canvas
  (which usually isn't focusable by default):
    window.addEventListener('keydown', onKeyDown);
- Make absolutely sure the game starts on first interaction. If you
  need a "Start" button, IT MUST WORK on first click. Test the boot
  path mentally before finalizing.

LAYOUT (the iframe is resizable by the student — this is non-negotiable):
- DO NOT set a fixed pixel width / height on html / body / outer
  container. The iframe gets resized live and your layout MUST follow.
- Use \`100%\` / \`100vw\` / \`100vh\` / \`vmin\` / flex / grid that fill the
  parent. \`width: 100%; height: 100%\` on the outermost container is
  the safest pattern.
- For three.js: the renderer's canvas should fill the parent; watch a
  ResizeObserver and update on every change.
- Internal layout should adapt: scale fonts with \`clamp()\`.
- Mobile-friendly. Use pointerdown/pointerup or touch + click handlers.

CONTENT:
- Educational and focused. Age-appropriate for ~8th grade unless told
  otherwise.
- Clear feedback: green for correct, red for wrong, restart button.
- Clean palette: light background, contrasting text.

SCAFFOLD — START FROM THIS for three.js + cannon-es games:
The most common cause of broken 3D games is the model writing the scaffolding
boilerplate wrong (forgotten renderer.render call, broken resize handler,
missing renderer.setPixelRatio, wrong cannon-es step API, missing
__tutorReady). Below is a TESTED scaffold. COPY this structure verbatim and
fill in the marked TODO regions with the game-specific scene content. Do
NOT rewrite the boilerplate.

\`\`\`html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>TODO_TITLE</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: ui-sans-serif, system-ui, sans-serif; background: #0c1226; color: #e8eaf6; }
  #wrap { position: relative; width: 100%; height: 100%; }
  #scene { position: absolute; inset: 0; }
  #hud { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; pointer-events: none; z-index: 10; }
  #hud span { background: rgba(0,0,0,0.45); padding: 6px 10px; border-radius: 6px; font-size: clamp(11px, 2vw, 14px); }
  #overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(10,15,40,0.7); z-index: 20; flex-direction: column; gap: 14px; }
  #start, #restart { padding: 12px 28px; border: 0; border-radius: 999px; background: #4f7cff; color: white; font-weight: 600; font-size: 14px; cursor: pointer; }
  #start:hover, #restart:hover { background: #6a92ff; }
  #title { font-size: clamp(16px, 3vw, 22px); font-weight: 600; text-align: center; padding: 0 24px; }
  #subtitle { font-size: clamp(11px, 2vw, 13px); opacity: 0.8; text-align: center; padding: 0 24px; max-width: 80%; }
  #overlay.hidden { display: none; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="scene"></canvas>
  <div id="hud">
    <span id="status">TODO_LEFT_HUD</span>
    <span id="meter">TODO_RIGHT_HUD</span>
  </div>
  <div id="overlay">
    <div id="title">TODO_TITLE</div>
    <div id="subtitle">TODO_INSTRUCTIONS</div>
    <button id="start" type="button">Start</button>
  </div>
</div>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';

// ---------- Scaffolding (do not rewrite — fill in the TODOs below) ----------
const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const meterEl = document.getElementById('meter');
const startBtn = document.getElementById('start');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1226);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
camera.position.set(6, 5, 8);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

scene.add(new THREE.HemisphereLight(0xffffff, 0x223355, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(6, 10, 4);
scene.add(sun);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;

// ---------- TODO: build your scene + bodies here ----------
// const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
// ground.quaternion.setFromEuler(-Math.PI/2, 0, 0);
// world.addBody(ground);
// ...add meshes to scene, bodies to world, store the (mesh, body) pairs.

const pairs = []; // {mesh, body} pairs — copied each frame
let playing = false;

function updateHud() {
  // TODO: write your live status text
  statusEl.textContent = 'TODO';
  meterEl.textContent = '';
}

function reset() {
  // TODO: re-initialize gameplay state when Start is pressed
}

// ---------- End of TODO scene block ----------

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

const fixedDt = 1 / 60;
let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (playing) {
    world.step(fixedDt, dt, 3);
    for (const p of pairs) {
      p.mesh.position.copy(p.body.position);
      p.mesh.quaternion.copy(p.body.quaternion);
    }
    updateHud();
  }
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

startBtn.addEventListener('click', () => {
  reset();
  overlay.classList.add('hidden');
  playing = true;
});

// MANDATORY: tells the host the scene is up. Without this, the host
// watchdog assumes the boot failed and auto-regenerates the game.
window.__tutorReady('three-scene');
</script>
</body>
</html>
\\\`\\\`\\\`

Keep the scope SMALL. A reliable simple game beats an ambitious broken one.
Examples that work well:
- Single ball rolling down an adjustable ramp (one slider).
- A pendulum with one pivot the student can drag.
- Cube floating in different fluid densities (one toggle).
- Three planets orbiting a sun at adjustable speeds.
Avoid: full car physics with steering + collisions + lap counter — too many
moving parts, fails reliability.

For 2D matter.js or DOM-only games the scaffold is simpler — see the
EVENT HANDLERS rules below. The same overlay + Start button + HUD pattern
applies (Start button gates gameplay so the student knows what to do).

Respond with ONLY the HTML document. Start with \`<!doctype html>\` and end
with \`</html>\`. No markdown fences, no commentary, no preamble.`;

export type GenerateMinigameResult =
  | {
      ok: true;
      html: string;
      title: string;
      latencyMs: number;
    }
  | { ok: false; error: string };

const REGEN_SYSTEM_PROMPT = `You are debugging an educational HTML5 minigame
that crashed at runtime inside a sandboxed iframe. The host page captured the
error trace and is asking you to ship a corrected version of the document.

The same constraints as the original generation apply:
- Output ONLY the full HTML document. Start with \`<!doctype html>\` and end
  with \`</html>\`. No markdown fences, no commentary, no preamble.
- Sandbox restrictions: no fetch to external APIs, no localStorage / cookies,
  no form submissions.
- An import map is pre-injected so the following module specifiers resolve:
  three, three/addons/*, cannon-es, matter-js, tone. Use \`<script type="module">\`
  to import them.
- Layout MUST fill the iframe (use 100% / 100vw / 100vh / flex / grid). The
  iframe is resizable by the student; do not set fixed pixel widths on root
  containers.

How to debug:
1. Read the error trace carefully — line / column numbers refer to the iframe
   document you wrote previously.
2. The most common failure modes you should rule out:
   - Inline event handlers (\`onclick="fn()"\`) referencing module-scoped
     functions. Inline handlers run in the global scope; module-scoped
     names are NOT on \`window\`. ALWAYS use \`addEventListener\` when in
     \`<script type="module">\`. This is the #1 cause of "click Start,
     nothing happens" bugs.
   - Missing call to \`window.__tutorReady()\` at the end of the boot
     code — without it the host watchdog will keep regenerating the
     game. EVERY successful boot path must end with this call.
   - Reference errors (undefined variables, missing imports, typos).
   - Race conditions where code runs before the DOM is ready (wrap setup in
     a \`DOMContentLoaded\` listener or place \`<script type="module">\` after
     the canvas / target elements).
   - Three.js / cannon-es API misuse (passing the wrong argument types,
     calling methods on undefined objects, forgetting to call
     \`world.step()\` or \`renderer.render()\` in the animation loop).
   - Module imports that aren't in the import map. Only these bare
     specifiers resolve: \`three\`, \`three/addons/*\`, \`cannon-es\`,
     \`matter-js\`, \`tone\`. Anything else must use a full URL or be
     replaced.
   - Infinite loops on boot (broken while loops, recursive RAF without exit).
   - Hard-coded fixed pixel widths that misbehave on resize.
3. Fix the underlying bug. Don't just suppress the error with try/catch —
   the game must actually work. Keep the same gameplay / lesson concept that
   the description specifies; you may simplify implementation details if
   needed to make it reliable.
4. Make sure the corrected document calls \`window.__tutorReady()\` at the
   end of the success path so the host knows the regenerated scene booted.

Respond with ONLY the corrected HTML document.`;

export type RegenerateMinigameArgs = {
  description: string;
  title: string;
  brokenHtml: string;
  errors: Array<{
    type: "error" | "unhandledrejection" | "console" | "no_boot";
    message: string;
    source?: string;
    line?: number;
    col?: number;
    stack?: string;
  }>;
};

export async function regenerateMinigame(
  args: RegenerateMinigameArgs,
): Promise<GenerateMinigameResult> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is not set. Minigame regeneration relies on Claude.",
    };
  }

  const errorReport = args.errors
    .map((e, i) => {
      const loc =
        e.source || e.line || e.col
          ? ` at ${e.source ?? "<inline>"}${e.line ? `:${e.line}` : ""}${
              e.col ? `:${e.col}` : ""
            }`
          : "";
      return `[#${i + 1}] (${e.type})${loc}
${e.message}${e.stack ? `\nstack:\n${e.stack}` : ""}`;
    })
    .join("\n\n");

  const userText = `The student requested this minigame:

"${args.description || "(no original description preserved — infer from the broken HTML)"}"

Original title: ${args.title || "Minigame"}

It crashed with these errors:

${errorReport}

Here is the broken HTML in full:

\`\`\`html
${args.brokenHtml}
\`\`\`

Return a corrected version of the document that fixes the underlying issue and runs.`;

  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      temperature: 0.3,
      system: REGEN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    });
    const latencyMs = Date.now() - start;
    let text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    text = text.replace(/^```(?:html)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

    if (!text.toLowerCase().includes("<!doctype") && !text.includes("<html")) {
      return {
        ok: false,
        error:
          "Claude returned something that doesn't look like an HTML document on regen.",
      };
    }
    return {
      ok: true,
      html: text,
      title: args.title || "Minigame",
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function generateMinigame(
  args: GenerateMinigameArgs,
): Promise<GenerateMinigameResult> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is not set. Minigame generation relies on Claude.",
    };
  }

  const userText = `Build a minigame: ${args.description}\n\nTarget size: ${Math.round(args.w)}px wide × ${Math.round(args.h)}px tall.`;

  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      // Self-contained HTML for a small game is usually 1-3k tokens; cap
      // generously to allow some flourishes.
      max_tokens: 8000,
      temperature: 0.5,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    });
    const latencyMs = Date.now() - start;
    let text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // Defensive: strip ``` fences if Claude added them despite instructions.
    text = text.replace(/^```(?:html)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

    if (!text.toLowerCase().includes("<!doctype") && !text.includes("<html")) {
      return {
        ok: false,
        error:
          "Claude returned something that doesn't look like an HTML document.",
      };
    }
    return {
      ok: true,
      html: text,
      title: args.title || "Minigame",
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
