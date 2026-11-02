// Pain signal fetchers for the Opportunity Radar. Free, public sources only.
// Each returns RawSignal[]. To add a source: write a fetcher and add it to SOURCES.

export type RawSignal = {
  url: string; // unique id we dedupe on
  source: string;
  title: string;
  text: string;
  postedAt?: number; // ms
  engagement: number; // rough signal strength, used to prioritize analysis
};

export type SignalSourceResult = {
  source: string;
  signals: RawSignal[];
  error?: string;
};

const USER_AGENT = "AadilCommandCenter/1.0 (opportunity research)";
const REQUEST_TIMEOUT_MS = 25000;
const TEXT_CHARS = 2000;
const DAY = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 30 * DAY; // dedupe by URL means re-fetching older posts costs nothing

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function toText(html: string | undefined | null): string {
  return (html ?? "")
    .replace(/<p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, TEXT_CHARS);
}

// ---------- 1. Hacker News ----------
const HN = "https://hn.algolia.com/api/v1";

const ASK_HN_PAIN_TITLE =
  /how do (you|i|we)|is there (a|an|any)|alternative to|struggl|automate|manage|track(ing)?|frustrat|tool for|software for|wish|best way to|anyone (else|use)|workflow|small business|clients?|invoic|schedul/i;

const PAIN_PHRASES = [
  "is there a tool",
  "i wish there was",
  "is there any software",
  "still doing this manually",
  "we do this manually",
  "spreadsheet hell",
  "biggest pain",
  "would pay for",
  "too expensive for",
  "no good tool",
];

async function fromHackerNews(): Promise<RawSignal[]> {
  const since = Math.floor((Date.now() - LOOKBACK_MS) / 1000);
  const out = new Map<string, RawSignal>();

  // a) Ask HN posts that read like a problem
  const ask = await getJson(
    `${HN}/search_by_date?tags=ask_hn&numericFilters=created_at_i>${since}&hitsPerPage=200`
  );
  for (const h of ask.hits ?? []) {
    if (!h.title || !ASK_HN_PAIN_TITLE.test(h.title)) continue;
    const url = `https://news.ycombinator.com/item?id=${h.objectID}`;
    out.set(url, {
      url,
      source: "Hacker News",
      title: h.title,
      text: toText(h.story_text) || h.title,
      postedAt: h.created_at_i ? h.created_at_i * 1000 : undefined,
      engagement: (h.points ?? 0) + (h.num_comments ?? 0),
    });
  }

  // b) Comments containing pain phrases
  for (const phrase of PAIN_PHRASES) {
    await sleep(500);
    const res = await getJson(
      `${HN}/search_by_date?query=${encodeURIComponent(phrase)}&tags=comment&numericFilters=created_at_i>${since}&hitsPerPage=40`
    );
    for (const h of res.hits ?? []) {
      const text = toText(h.comment_text);
      if (!text.toLowerCase().includes(phrase)) continue; // must contain the exact phrase
      const url = `https://news.ycombinator.com/item?id=${h.objectID}`;
      if (out.has(url)) continue;
      out.set(url, {
        url,
        source: "Hacker News",
        title: h.story_title ? `Comment on: ${h.story_title}` : "HN comment",
        text,
        postedAt: h.created_at_i ? h.created_at_i * 1000 : undefined,
        engagement: 2,
      });
    }
  }

  return [...out.values()];
}

// ---------- 2. Stack Exchange (people asking for software that does X) ----------
const SE_SITES = ["softwarerecs", "webapps"];

async function fromStackExchange(): Promise<RawSignal[]> {
  const since = Math.floor((Date.now() - LOOKBACK_MS) / 1000);
  const out: RawSignal[] = [];

  for (const site of SE_SITES) {
    const data = await getJson(
      `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&site=${site}&pagesize=100&fromdate=${since}&filter=withbody`
    );
    for (const q of data.items ?? []) {
      if (!q.link || !q.title) continue;
      const unanswered = (q.answer_count ?? 0) === 0;
      out.push({
        url: q.link,
        source: `Stack Exchange: ${site}`,
        title: toText(q.title),
        text: toText(q.body),
        postedAt: q.creation_date ? q.creation_date * 1000 : undefined,
        engagement: Math.max(0, q.score ?? 0) * 2 + (q.view_count ?? 0) / 50 + (unanswered ? 3 : 0),
      });
    }
    if (data.backoff) await sleep(data.backoff * 1000); // API asked us to slow down
    await sleep(1000);
  }

  return out;
}

// ---------- 3. App Store reviews of incumbent small-business apps ----------
// 1-2★ = what's broken or missing; 3★ only when it names a missing capability ("wish it had…")
const INCUMBENT_APPS = [
  "Square Point of Sale",
  "QuickBooks Accounting",
  "Calendly",
  "Jobber",
  "Housecall Pro",
  "Vagaro",
  "Fresha for business",
  "Toast POS",
  "Xero Accounting",
  "Mailchimp",
  "HubSpot",
  "Wix",
  "Gusto",
  "Zoho CRM",
];

const FEATURE_GAP = /\b(wish|missing|lacks?|no way to|can'?t|cannot|would be (nice|great)|need(s|ed)? (a|an|to)|doesn'?t (have|let|allow|support)|only if|too (complicated|expensive|complex)|just want)\b/i;

async function fromAppStore(): Promise<RawSignal[]> {
  const out: RawSignal[] = [];

  for (const name of INCUMBENT_APPS) {
    try {
      const found = await getJson(
        `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&country=us&limit=1`
      );
      const app = found.results?.[0];
      if (!app?.trackId) continue;
      await sleep(500);

      const feed = await getJson(
        `https://itunes.apple.com/us/rss/customerreviews/page=1/id=${app.trackId}/sortby=mostrecent/json`
      );
      const entries = feed.feed?.entry ?? [];
      const list = Array.isArray(entries) ? entries : [entries];

      for (const e of list) {
        const rating = Number(e?.["im:rating"]?.label);
        const content = e?.content?.label ?? "";
        const reviewId = e?.id?.label;
        if (!reviewId || content.length < 80) continue;
        const keep = (rating >= 1 && rating <= 2) || (rating === 3 && FEATURE_GAP.test(content));
        if (!keep) continue;

        out.push({
          url: `https://apps.apple.com/us/app/id${app.trackId}#review-${reviewId}`,
          source: `App Store: ${app.trackName}`,
          title: `${rating}★ review of ${app.trackName}: ${e?.title?.label ?? ""}`.slice(0, 200),
          text: toText(content),
          postedAt: e?.updated?.label ? Date.parse(e.updated.label) : undefined,
          engagement: FEATURE_GAP.test(content) ? 4 : 2, // feature-gap language ranks higher
        });
      }
      await sleep(500);
    } catch {
      /* skip this app, keep going */
    }
  }

  return out;
}

// ---------- Registry ----------
const SOURCES: { name: string; fetch: () => Promise<RawSignal[]> }[] = [
  { name: "Hacker News", fetch: fromHackerNews },
  { name: "Stack Exchange", fetch: fromStackExchange },
  { name: "App Store reviews", fetch: fromAppStore },
];

// Fetch every source in parallel; one failing never breaks the others.
export async function fetchAllSignals(): Promise<SignalSourceResult[]> {
  return Promise.all(
    SOURCES.map(async (s) => {
      try {
        const signals = (await s.fetch()).filter((x) => x.url && (x.text || x.title));
        return { source: s.name, signals };
      } catch (err) {
        return {
          source: s.name,
          signals: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );
}
