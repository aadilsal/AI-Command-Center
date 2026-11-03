// Shared LLM helper for all agents (Groq, OpenAI-compatible API).
// Handles: auth, rate limits, daily quota, empty/truncated replies, JSON parsing, retries.

export const LLM_MODEL = "openai/gpt-oss-20b";
const LLM_URL = "https://api.groq.com/openai/v1/chat/completions";

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_BAD_OUTPUT_RETRIES = 2;
const MAX_TOKENS_CAP = 8000;
const MAX_WAIT_SECONDS = 90; // longer than this = quota exhausted, don't sleep on it

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

// Daily (or long) quota exhausted: retrying now is pointless — stop the run.
export class QuotaExhaustedError extends Error {}

class BadOutputError extends Error {}

const features = { reasoningEffort: true, jsonMode: true };

type CallOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
};

/** Parses "try again in 7.3s", "2m30.5s", "1h5m" into seconds. */
function parseWaitSeconds(text: string, header: string | null): number {
  const fromHeader = Number(header);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  const m = text.match(/try again in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
  if (m && (m[1] || m[2] || m[3])) {
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  }
  return 10;
}

async function callOnce(opts: CallOptions, maxTokens: number): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in Convex env");

  const body: Record<string, unknown> = {
    model: LLM_MODEL,
    temperature: opts.temperature ?? 0.2,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (features.reasoningEffort) body.reasoning_effort = "low";
  if (features.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const text = await res.text();
    const seconds = parseWaitSeconds(text, res.headers.get("retry-after"));
    const isDaily = /per day|\bTPD\b|\bRPD\b/i.test(text);
    if (isDaily || seconds > MAX_WAIT_SECONDS) {
      throw new QuotaExhaustedError(
        `Groq ${isDaily ? "daily " : ""}limit reached — paused, will retry next run`
      );
    }
    throw new RateLimitError(`Groq rate limit: ${text.slice(0, 200)}`, (seconds + 1) * 1000);
  }

  if (res.status === 400) {
    const text = await res.text();
    if (features.reasoningEffort && /reasoning_effort/i.test(text)) {
      features.reasoningEffort = false;
      return callOnce(opts, maxTokens);
    }
    if (features.jsonMode && /response_format|json_object|json mode/i.test(text)) {
      features.jsonMode = false;
      return callOnce(opts, maxTokens);
    }
    if (/json_validate_failed|failed to generate json/i.test(text)) {
      throw new BadOutputError("model produced invalid JSON");
    }
    throw new Error(`Groq API 400: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`Groq API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string | null }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";

  if (!content.trim()) {
    throw new BadOutputError(
      choice?.finish_reason === "length"
        ? "ran out of tokens before answering"
        : `empty reply (finish_reason: ${choice?.finish_reason ?? "unknown"})`
    );
  }
  return content;
}

/**
 * Call the LLM and parse a JSON object from its reply.
 * Retries short rate limits and bad output; throws QuotaExhaustedError immediately on daily limits.
 */
export async function callLLMJson<T>(
  opts: CallOptions
): Promise<{ data: T; retriesUsed: number }> {
  let maxTokens = opts.maxTokens ?? 2000;
  let rateRetries = 0;
  let badRetries = 0;
  let lastProblem = "";

  for (;;) {
    try {
      const raw = await callOnce(opts, maxTokens);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new BadOutputError(`no JSON object in reply: ${raw.slice(0, 120)}`);
      try {
        return { data: JSON.parse(match[0]) as T, retriesUsed: rateRetries + badRetries };
      } catch {
        throw new BadOutputError("reply was cut off or malformed JSON");
      }
    } catch (err) {
      if (err instanceof RateLimitError && rateRetries < MAX_RATE_LIMIT_RETRIES) {
        rateRetries++;
        await sleep(err.waitMs);
        continue;
      }
      if (err instanceof BadOutputError && badRetries < MAX_BAD_OUTPUT_RETRIES) {
        badRetries++;
        lastProblem = err.message;
        maxTokens = Math.min(MAX_TOKENS_CAP, Math.round(maxTokens * 1.6));
        await sleep(2000);
        continue;
      }
      if (err instanceof BadOutputError) {
        throw new Error(
          `The AI model didn't return a usable answer after ${badRetries + 1} tries (${err.message || lastProblem}). Try again in a minute.`
        );
      }
      throw err; // includes QuotaExhaustedError — callers stop their run
    }
  }
}
