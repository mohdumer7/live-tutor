import { createHash, randomUUID } from "node:crypto";
import {
  TOPIC_TOOL_CALL,
  TOPIC_TOOL_RESULT,
  toolResultEnvelope,
  type ToolCall,
  type ToolCallEnvelope,
  type ToolResultEnvelope,
} from "@live-tutor/schema";

const TOOL_TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 200;
const DEDUP_WINDOW_MS = 200;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

type Pending = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

type DedupEntry = {
  at: number;
  promise: Promise<unknown>;
};

export interface RpcRoom {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  localParticipant?: {
    publishData(
      data: Uint8Array,
      options: { reliable?: boolean; topic?: string },
    ): Promise<void>;
  };
}

export type RpcClient = {
  call(payload: ToolCall): Promise<unknown>;
  dispose(): void;
};

/**
 * Creates an RPC client that forwards tool calls to the FE over the LiveKit
 * data channel and resolves the agent-side Promise when the matching
 * `tool_result` envelope arrives.
 *
 * Phase A reliability features:
 *  - Single retry on transient errors (timeout, "no shape with id ..."
 *    races against not-yet-applied scene state).
 *  - 200ms in-flight dedup so the model can't accidentally double-fire the
 *    same tool with the same args (a known Gemini Live quirk).
 *  - Structured telemetry: one `[tool] <name> <ms>ms <status>` log line per
 *    call so we can grep call latency / failure patterns.
 */
export function createRpcClient(room: RpcRoom): RpcClient {
  const pending = new Map<string, Pending>();
  const recent = new Map<string, DedupEntry>();

  const onData = (...args: unknown[]) => {
    const [payload, , , topic] = args as [
      Uint8Array,
      unknown,
      unknown,
      string | undefined,
    ];
    if (topic !== TOPIC_TOOL_RESULT) return;
    let envelope: ToolResultEnvelope;
    try {
      envelope = toolResultEnvelope.parse(JSON.parse(decoder.decode(payload)));
    } catch (err) {
      console.warn("[rpc] invalid tool_result envelope:", err);
      return;
    }
    const entry = pending.get(envelope.callId);
    if (!entry) {
      console.warn("[rpc] no pending call for id:", envelope.callId);
      return;
    }
    pending.delete(envelope.callId);
    clearTimeout(entry.timer);
    if (envelope.ok) {
      entry.resolve(envelope.data);
    } else {
      entry.reject(new Error(envelope.error));
    }
  };

  room.on("dataReceived", onData);

  // One round trip — no retry/dedup wrapping — used by the public `call`.
  function singleAttempt(payload: ToolCall): Promise<unknown> {
    const callId = randomUUID();
    const envelope: ToolCallEnvelope = {
      kind: "tool_call",
      callId,
      payload,
    };
    const data = encoder.encode(JSON.stringify(envelope));

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(callId);
        reject(
          new Error(
            `tool ${payload.tool} timed out after ${TOOL_TIMEOUT_MS}ms`,
          ),
        );
      }, TOOL_TIMEOUT_MS);
      pending.set(callId, { resolve, reject, timer });
    });

    const lp = room.localParticipant;
    if (!lp) {
      pending.delete(callId);
      return Promise.reject(
        new Error("agent has no local participant — not in a room?"),
      );
    }
    return lp
      .publishData(data, { reliable: true, topic: TOPIC_TOOL_CALL })
      .then(() => promise);
  }

  function isTransient(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const m = err.message.toLowerCase();
    return (
      m.includes("timed out") ||
      m.includes("no shape with id") ||
      m.includes("could not resolve") ||
      m.includes("publishdata") ||
      m.includes("not connected")
    );
  }

  function evictStaleDedup(): void {
    const now = Date.now();
    for (const [k, entry] of recent) {
      if (now - entry.at > DEDUP_WINDOW_MS) recent.delete(k);
    }
  }

  return {
    async call(payload: ToolCall): Promise<unknown> {
      evictStaleDedup();
      const dedupKey = `${payload.tool}:${hashArgs(payload)}`;
      const existing = recent.get(dedupKey);
      if (existing) {
        console.log(`[tool] ${payload.tool} 0ms deduped`);
        return existing.promise;
      }

      const start = Date.now();
      const inflight = (async () => {
        let attempt = 0;
        while (true) {
          attempt += 1;
          try {
            const result = await singleAttempt(payload);
            const ms = Date.now() - start;
            const status = attempt > 1 ? `ok-retry-${attempt}` : "ok";
            console.log(`[tool] ${payload.tool} ${ms}ms ${status}`);
            return result;
          } catch (err) {
            if (attempt < 2 && isTransient(err)) {
              await sleep(RETRY_BACKOFF_MS);
              continue;
            }
            const ms = Date.now() - start;
            const msg =
              err instanceof Error ? err.message.slice(0, 120) : String(err);
            console.warn(
              `[tool] ${payload.tool} ${ms}ms err attempt=${attempt} (${msg})`,
            );
            throw err;
          }
        }
      })();

      recent.set(dedupKey, { at: Date.now(), promise: inflight });
      // Don't keep dedup entry forever after settle — let the time-based
      // sweep above remove it; this still serves concurrent calls.
      return inflight;
    },

    dispose() {
      room.off("dataReceived", onData);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("rpc client disposed"));
      }
      pending.clear();
      recent.clear();
    },
  };
}

function hashArgs(payload: ToolCall): string {
  // Stable JSON for the args — sorting keys so {x,y} and {y,x} hash the same.
  const json = stableStringify(payload.args);
  return createHash("sha1").update(json).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify(
          (value as Record<string, unknown>)[k],
        )}`,
    )
    .join(",")}}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
