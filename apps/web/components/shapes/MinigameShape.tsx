"use client";

import { useEffect, useRef, useState } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type TLBaseShape,
  type TLShape,
  type TLShapePartial,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import {
  TOPIC_MINIGAME_ERROR,
  type MinigameErrorEnvelope,
} from "@live-tutor/schema";
import { getRoom } from "@/lib/livekit";

// How many times we try to auto-repair a given minigame before giving up.
// First failure = attempt 1; the agent regenerates and pushes a new HTML
// payload, which resets the iframe via the existing iframe-key remount.
// If THAT also throws, attempt 2 — usually that's enough.
const MAX_AUTO_REPAIR_ATTEMPTS = 2;

// Per-shape attempt counter. Lives at module scope so it survives the
// MinigameFrame component remount that the iframe-key bump triggers.
const repairAttempts = new Map<string, number>();

export type MinigameShape = TLBaseShape<
  "minigame",
  {
    html: string;
    title: string;
    // Optional — added later. Old persisted shapes from before this prop
    // existed will hydrate without it, so reads must use `?? ""`.
    description?: string;
    w: number;
    h: number;
  }
>;

export class MinigameShapeUtil extends ShapeUtil<TLShape> {
  static override type = "minigame" as const;
  static override props = {
    html: T.string,
    title: T.string,
    // Optional validator so previously-persisted minigame shapes (which
    // were saved before this prop existed) don't fail tldraw schema
    // validation on snapshot restore.
    description: T.string.optional(),
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
  } as never;

  override canResize(): boolean {
    return true;
  }

  override getDefaultProps(): MinigameShape["props"] {
    return {
      html: "<!doctype html><body style='font-family:sans-serif;padding:1rem;color:#666'>Empty minigame</body>",
      title: "Minigame",
      description: "",
      w: 420,
      h: 360,
    };
  }

  override getGeometry(shape: TLShape) {
    const s = shape as unknown as MinigameShape;
    return new Rectangle2d({
      width: s.props.w,
      height: s.props.h,
      isFilled: true,
    });
  }

  override onResize(shape: TLShape, info: TLResizeInfo<TLShape>) {
    return resizeBox(
      shape as unknown as Parameters<typeof resizeBox>[0],
      info as unknown as Parameters<typeof resizeBox>[1],
    ) as TLShapePartial<TLShape>;
  }

  override component(shape: TLShape) {
    const s = shape as unknown as MinigameShape;
    return (
      <HTMLContainer
        style={{
          width: s.props.w,
          height: s.props.h,
          background: "white",
          borderRadius: 8,
          padding: 0,
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          border: "1px solid rgba(0,0,0,0.08)",
          color: "#0b0b0f",
          pointerEvents: "all",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <MinigameFrame
          shapeId={shape.id}
          html={s.props.html}
          title={s.props.title}
          description={s.props.description ?? ""}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: TLShape) {
    const s = shape as unknown as MinigameShape;
    return <rect width={s.props.w} height={s.props.h} rx={8} ry={8} />;
  }
}

// Base CSS injected into every generated minigame so the document always
// fills the iframe's viewport. Claude tends to ship hard-coded `width:
// 400px` containers; this forces a sensible default of "fill the box",
// which the model can still override by emitting its own style block
// later in the document.
const BASE_CSS = `<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; box-sizing: border-box; overflow: hidden; -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  *, *::before, *::after { box-sizing: inherit; }
  body { display: flex; flex-direction: column; }
  body > * { max-width: 100%; }
  /* tldraw's shape resize transforms us, so block any "fixed positioning relative to viewport" tricks that would escape it */
  [style*="position: fixed"] { position: absolute !important; }
</style>`;

// Import map injected so games can do `import * as THREE from 'three'`
// (instead of needing the full unpkg URL) and reach for physics libs
// like cannon-es / matter.js. Sandboxed iframes with `allow-scripts`
// can still load ESM bundles from a CDN — the sandbox restricts what
// the loaded code can DO (no parent DOM access, no cookies, no
// top-navigation), not what URLs it can fetch.
// Import map sources matter: three.js + cannon-es ship proper ES modules
// at unpkg, but matter-js and tone only ship UMD bundles there — those
// fail silently when imported as ESM ("the requested module does not
// provide an export named 'default'"). esm.sh wraps CJS/UMD packages
// into ESM, so it's the right source for those two.
const IMPORT_MAP = `<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.171.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.171.0/examples/jsm/",
    "cannon-es": "https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js",
    "matter-js": "https://esm.sh/matter-js@0.20.0",
    "tone": "https://esm.sh/tone@15.0.4"
  }
}
</script>`;

// Error bridge: lets a sandboxed iframe (no allow-same-origin, so parent
// can't read its console) report runtime errors back to the host page via
// postMessage. The host listens, batches errors, and pushes a
// `minigame_error` envelope over the LiveKit data channel to the agent,
// which then asks Claude to patch the HTML and replaces it.
//
// `__TUTOR_SHAPE_ID__` is replaced at injection time so the host can
// correlate inbound errors to the right shape (multiple games can run on
// the canvas at once).
const ERROR_BRIDGE = (shapeId: string) => `<script>
(function(){
  var SHAPE_ID = ${JSON.stringify(shapeId)};
  var sent = 0;
  function send(payload){
    if (sent >= 12) return; // hard cap per iframe lifetime
    sent++;
    try { window.parent.postMessage(Object.assign({ __tutor_minigame: true, shapeId: SHAPE_ID }, payload), '*'); } catch(_){}
  }
  // Capture-phase listener catches RESOURCE load errors (failed <script
  // src=...>, failed module imports, failed <img>) which don't bubble.
  // The non-capture listener catches uncaught exceptions thrown from
  // user code. We need both.
  window.addEventListener('error', function(e){
    var tgt = e && e.target;
    if (tgt && tgt !== window && tgt.tagName) {
      // Resource error (script/link/img failed to load). e.message is
      // usually empty for these — surface the URL instead.
      var url = tgt.src || tgt.href || '(unknown)';
      send({
        type: 'error',
        message: 'Failed to load <' + String(tgt.tagName).toLowerCase() + '> resource: ' + url,
        source: url
      });
      return;
    }
    send({
      type: 'error',
      message: (e && e.message) || 'Unknown error',
      source: e && e.filename ? String(e.filename).slice(0, 500) : undefined,
      line: e && typeof e.lineno === 'number' ? e.lineno : undefined,
      col: e && typeof e.colno === 'number' ? e.colno : undefined,
      stack: e && e.error && e.error.stack ? String(e.error.stack).slice(0, 4000) : undefined
    });
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = (e && e.reason) || {};
    send({
      type: 'unhandledrejection',
      message: (r && r.message ? String(r.message) : String(r)).slice(0, 2000),
      stack: r && r.stack ? String(r.stack).slice(0, 4000) : undefined
    });
  });
  try {
    var origErr = console.error.bind(console);
    console.error = function(){
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          parts.push(a && a.stack ? a.stack : (typeof a === 'string' ? a : (function(){ try { return JSON.stringify(a); } catch(_){ return String(a); } })()));
        }
        send({ type: 'console', message: parts.join(' ').slice(0, 2000) });
      } catch(_){}
      origErr.apply(console, arguments);
    };
  } catch(_){}
  // Two-stage boot detection:
  //   1) DCL ping — tells the host the HTML parsed. Fires fast (<1s
  //      normally). Without it inside 6s the doc is broken.
  //   2) __tutorReady() — the game code MUST call this once its scene
  //      is set up and interactive. This is the only signal that proves
  //      module scripts actually ran successfully. Without it inside
  //      10s, the host triggers auto-repair (module silently failed,
  //      WebGL init failed, three.js threw etc).
  function pingDcl(){ send({ type: 'dcl', message: 'html parsed' }); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') pingDcl();
  else document.addEventListener('DOMContentLoaded', pingDcl);
  window.__tutorReady = function(detail){
    send({ type: 'ready', message: 'scene_ready' + (detail ? ': ' + String(detail).slice(0, 100) : '') });
  };
})();
</script>`;

const INJECTED_HEAD = (shapeId: string) =>
  `${IMPORT_MAP}${BASE_CSS}${ERROR_BRIDGE(shapeId)}`;

function injectBaseCSS(html: string, shapeId: string): string {
  const head = INJECTED_HEAD(shapeId);
  // Try to inject into <head> first (preferred — runs before user CSS so
  // user rules win, and import maps must appear before any module imports).
  // If no head, slip it in before <body>. Last resort, prepend to the doc.
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${head}</head>`);
  if (/<head[^>]*>/i.test(html))
    return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<body[^>]*>/i.test(html))
    return html.replace(/<body[^>]*>/i, (m) => `${head}${m}`);
  return head + html;
}

type IframeMsg = {
  __tutor_minigame: true;
  shapeId: string;
  // dcl     — HTML parsed (DOMContentLoaded); says nothing about modules
  // ready   — game code explicitly called window.__tutorReady()
  // error / unhandledrejection / console — failure modes
  type:
    | "error"
    | "unhandledrejection"
    | "console"
    | "dcl"
    | "ready";
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
};

function publishMinigameError(envelope: MinigameErrorEnvelope): void {
  const room = getRoom();
  if (!room) {
    console.warn("[minigame] no room — dropping error report");
    return;
  }
  try {
    const data = new TextEncoder().encode(JSON.stringify(envelope));
    void room.localParticipant.publishData(data, {
      reliable: true,
      topic: TOPIC_MINIGAME_ERROR,
    });
  } catch (err) {
    console.warn("[minigame] failed to publish minigame_error:", err);
  }
}

function MinigameFrame({
  shapeId,
  html,
  title,
  description,
}: {
  shapeId: string;
  html: string;
  title: string;
  description: string;
}) {
  // `key` toggles a remount of the iframe to "reload" the game state. Cheap
  // re-mount instead of touching iframe.contentWindow.location.
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Track which html payload we've already accounted for so a Restart click
  // (same html, key bump) doesn't reset the attempt cap, but a genuine
  // replace_minigame_html push (new html for the same shape) does — the
  // freshly-patched payload deserves a fresh budget if it still misbehaves
  // in a different way.
  const seenHtmlRef = useRef<string | null>(null);
  if (seenHtmlRef.current !== null && seenHtmlRef.current !== html) {
    repairAttempts.delete(shapeId);
  }
  seenHtmlRef.current = html;
  // Buffer errors that arrive in a tight burst (a single broken loop can
  // throw 50× before we react). Flush after a short debounce.
  const errBufferRef = useRef<IframeMsg[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dclTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dclReceivedRef = useRef(false);
  const readyReceivedRef = useRef(false);
  const enhancedHtml = injectBaseCSS(html, shapeId);

  useEffect(() => {
    // Reset per-iframe-lifecycle state every time we (re)mount.
    dclReceivedRef.current = false;
    readyReceivedRef.current = false;
    errBufferRef.current = [];

    const flush = (force?: "no_dcl" | "no_ready") => {
      const buf = errBufferRef.current;
      errBufferRef.current = [];
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      const errs: MinigameErrorEnvelope["errors"] = buf
        .filter((m) => m.type !== "ready" && m.type !== "dcl")
        .slice(0, 5)
        .map((m) => ({
          type:
            m.type === "error"
              ? "error"
              : m.type === "unhandledrejection"
                ? "unhandledrejection"
                : "console",
          message: m.message,
          source: m.source,
          line: m.line,
          col: m.col,
          stack: m.stack,
        }));
      if (force === "no_dcl") {
        errs.push({
          type: "no_boot",
          message:
            "Game iframe never fired DOMContentLoaded within 6 seconds. Likely malformed HTML, a syntax error that halted parsing, or an infinite synchronous loop in a top-level script.",
        });
      } else if (force === "no_ready") {
        errs.push({
          type: "no_boot",
          message:
            "Game iframe loaded (DOMContentLoaded fired) but never called window.__tutorReady() within 12 seconds. The most likely causes: (a) a <script type=\"module\"> failed to resolve an import (check module specifiers against the import map — three, three/addons/*, cannon-es, matter-js, tone are the only allowed bare specifiers). (b) the module evaluated but threw an exception that bypassed our error listener (some browsers swallow these). (c) the boot logic forgot to call window.__tutorReady() once the scene is up. CRITICAL: every game MUST call window.__tutorReady() as the very last line of its setup code so the host knows the scene actually rendered. Without that signal, we cannot tell a successful boot apart from a silent module failure.",
        });
      }
      if (errs.length === 0) return;

      const prev = repairAttempts.get(shapeId) ?? 0;
      const attempt = prev + 1;
      if (attempt > MAX_AUTO_REPAIR_ATTEMPTS) {
        console.warn(
          `[minigame ${shapeId}] giving up after ${prev} repair attempts`,
        );
        return;
      }
      repairAttempts.set(shapeId, attempt);

      const env: MinigameErrorEnvelope = {
        kind: "minigame_error",
        shapeId,
        description: description ?? "",
        title: title ?? "",
        brokenHtml: html,
        errors: errs,
        attempt,
        timestamp: Date.now(),
      };
      console.warn(
        `[minigame ${shapeId}] attempt ${attempt} — reporting ${errs.length} error(s) to agent`,
      );
      publishMinigameError(env);
    };

    const onMessage = (e: MessageEvent) => {
      const data = e.data as IframeMsg | undefined;
      if (!data || !data.__tutor_minigame) return;
      if (data.shapeId !== shapeId) return;
      // Validate this came from OUR iframe's contentWindow (multiple games
      // on canvas would otherwise cross-talk via shape id alone).
      if (e.source !== iframeRef.current?.contentWindow) return;

      if (data.type === "dcl") {
        dclReceivedRef.current = true;
        if (dclTimerRef.current) {
          clearTimeout(dclTimerRef.current);
          dclTimerRef.current = null;
        }
        return;
      }
      if (data.type === "ready") {
        readyReceivedRef.current = true;
        if (readyTimerRef.current) {
          clearTimeout(readyTimerRef.current);
          readyTimerRef.current = null;
        }
        return;
      }
      errBufferRef.current.push(data);
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => flush(), 800);
      }
    };
    window.addEventListener("message", onMessage);

    // Stage 1: HTML must parse within 6s.
    dclTimerRef.current = setTimeout(() => {
      if (dclReceivedRef.current) return;
      flush("no_dcl");
    }, 6000);
    // Stage 2: game must call window.__tutorReady() within 12s of mount.
    // We use mount time, not DCL+delta, so the timer doesn't slip if DCL
    // is itself late. 12s is generous for three.js + cannon-es scenes
    // which can spend a second or two on shader compile + WebGL init.
    readyTimerRef.current = setTimeout(() => {
      if (readyReceivedRef.current) return;
      flush("no_ready");
    }, 12000);

    return () => {
      window.removeEventListener("message", onMessage);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (dclTimerRef.current) clearTimeout(dclTimerRef.current);
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    };
  }, [shapeId, html, title, description, reloadKey]);

  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.04)",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          fontSize: 11,
          fontWeight: 500,
          color: "rgba(0,0,0,0.65)",
          flexShrink: 0,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title || "Minigame"}
        </span>
        <button
          type="button"
          // Stop tldraw from eating the click. tldraw shapes capture
          // pointerdown to start drag/select gestures; without
          // stopPropagation the button never sees the click that follows.
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            // User-initiated restart resets the auto-repair budget so the
            // self-healing loop can engage again on the same broken game.
            repairAttempts.delete(shapeId);
            setReloadKey((k) => k + 1);
          }}
          title="Restart"
          style={{
            border: "1px solid rgba(0,0,0,0.1)",
            background: "white",
            borderRadius: 6,
            padding: "2px 8px",
            fontSize: 11,
            cursor: "pointer",
            color: "rgba(0,0,0,0.65)",
          }}
        >
          ↻ Restart
        </button>
      </header>
      <iframe
        key={reloadKey}
        ref={iframeRef}
        srcDoc={enhancedHtml}
        // sandbox without 'allow-same-origin' isolates the game from the
        // parent's cookies/localStorage. 'allow-scripts' lets game JS run.
        // We deliberately omit 'allow-popups' / 'allow-top-navigation' so a
        // buggy or malicious game can't redirect the page.
        sandbox="allow-scripts"
        title={title || "Minigame"}
        style={{
          width: "100%",
          flex: 1,
          border: "none",
          background: "white",
        }}
      />
    </>
  );
}
