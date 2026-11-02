// Shared LLM helper for all agents (Groq, OpenAI-compatible API).
// Handles: auth, rate-limit retries (429), and pulling JSON out of the reply.

export const LLM_MODEL = "openai/gpt-oss-20b";
const LLM_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_RETRIES = 3;

// Groq free tier is ~8k tokens/min, so agents pause this long between calls.
export const LLM_PACING_MS = 6000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RateLimitError extends Error {
  waitMs: number;
  constructor(message: string, waitMs: number) {
    super(message);
    this.waitMs = waitMs;
  }
}

type CallOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
};

async function callOnce(opts: CallOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in Convex env");

  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: opts.temperature ?? 0.2,
      max_completion_tokens: opts.maxTokens ?? 2000,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (res.status === 429) {
    const body = await res.text();
    const header = Number(res.headers.get("retry-after"));
    const fromMessage = Number(body.match(/try again in ([\d.]+)s/)?.[1]);
    const seconds =
      Number.isFinite(header) && header > 0
        ? header
        : Number.isFinite(fromMessage) && fromMessage > 0
          ? fromMessage
          : 10;
    throw new RateLimitError(`Groq rate limit: ${body.slice(0, 200)}`, (seconds + 1) * 1000);
  }

  if (!res.ok) {
    throw new Error(`Groq API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string | null } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Call the LLM and parse a JSON object from its reply.
 * Retries automatically when rate-limited.
 */
export async function callLLMJson<T>(
  opts: CallOptions
): Promise<{ data: T; retriesUsed: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await callOnce(opts);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`No JSON in model response: ${raw.slice(0, 200)}`);
      return { data: JSON.parse(match[0]) as T, retriesUsed: attempt };
    } catch (err) {
      if (err instanceof RateLimitError && attempt < MAX_RETRIES) {
        await sleep(err.waitMs);
        continue;
      }
      throw err;
    }
  }
}
