import Anthropic from "@anthropic-ai/sdk";
import type { ThinkArgs } from "@live-tutor/schema";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

const SYSTEM_PROMPT = `You are a careful problem-solver assisting a live AI tutor. The tutor is in
the middle of teaching a student and has paused to ask you a hard question.

Respond with:
- A short, clear, step-by-step answer.
- Math expressions as LaTeX wrapped in single dollar signs (e.g. $\\\\pi r^2$).
- Aim for 4-8 short sentences. The tutor will narrate this verbatim or rephrase
  it, so write naturally — no bullet headers, no markdown sections.

Do not greet, do not apologize, do not ask follow-up questions. Just answer.`;

export type ThinkResult = {
  ok: true;
  answer: string;
  latencyMs: number;
};

export type ThinkError = {
  ok: false;
  error: string;
};

export async function think(
  args: ThinkArgs,
): Promise<ThinkResult | ThinkError> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is not set. The think tool needs it to reach Claude.",
    };
  }

  const userParts: string[] = [`Question:\n${args.question}`];
  if (args.context) userParts.push(`Lesson context:\n${args.context}`);

  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      temperature: 0.4,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userParts.join("\n\n") }],
    });
    const latencyMs = Date.now() - start;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) {
      return { ok: false, error: "Claude returned an empty response." };
    }
    return { ok: true, answer: text, latencyMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
