import Anthropic from "@anthropic-ai/sdk";
import type { GradeAnswerArgs } from "@live-tutor/schema";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

const SYSTEM_PROMPT = `You grade math (and similar) student answers for a live AI tutor.

You'll receive:
- the problem statement
- the student's answer (text, LaTeX, or a description)
- optionally: the expected answer

Respond as a JSON object only — no prose, no code fences:
{
  "verdict": "correct" | "partial" | "incorrect",
  "feedback": "1-3 short sentences the tutor will read aloud to the student",
  "correctAnswer": "the canonical answer expressed concisely (LaTeX where appropriate)"
}

Rules:
- Accept equivalent forms (e.g. "x=2,3" = "x=2 or x=3" = "{2, 3}").
- Be encouraging. Say what's right before what's wrong.
- For "partial" credit, name exactly what's missing.
- Keep feedback under ~30 words; the tutor will paraphrase.`;

export type GradeResult =
  | {
      ok: true;
      verdict: "correct" | "partial" | "incorrect";
      feedback: string;
      correctAnswer: string;
      latencyMs: number;
    }
  | { ok: false; error: string };

export async function gradeAnswer(args: GradeAnswerArgs): Promise<GradeResult> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is not set. Grading relies on Claude.",
    };
  }

  const userText =
    `Problem:\n${args.problem}\n\nStudent answer:\n${args.studentAnswer}` +
    (args.expectedAnswer
      ? `\n\nExpected answer (for reference):\n${args.expectedAnswer}`
      : "");

  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    });
    const latencyMs = Date.now() - start;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    let parsed: {
      verdict?: unknown;
      feedback?: unknown;
      correctAnswer?: unknown;
    };
    try {
      // Defensive: strip ``` fences if Claude added them despite instructions.
      const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        ok: false,
        error: `grader returned non-JSON: ${text.slice(0, 120)}`,
      };
    }

    const verdict = parsed.verdict;
    if (
      verdict !== "correct" &&
      verdict !== "partial" &&
      verdict !== "incorrect"
    ) {
      return { ok: false, error: `grader returned bad verdict: ${verdict}` };
    }
    const feedback =
      typeof parsed.feedback === "string" ? parsed.feedback : "";
    const correctAnswer =
      typeof parsed.correctAnswer === "string" ? parsed.correctAnswer : "";
    return { ok: true, verdict, feedback, correctAnswer, latencyMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
