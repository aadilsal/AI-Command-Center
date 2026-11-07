// Trend signals from free public sources. Momentum is computed HERE, in code —
// the LLM only interprets numbers we measured.

const USER_AGENT = "AadilCommandCenter/1.0 (trend research)";
const TIMEOUT_MS = 25000;
const DAY = 24 * 60 * 60 * 1000;
const HN = "https://hn.algolia.com/api/v1";

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
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

// ---------- Term extraction from titles ----------

const STOPWORDS = new Set(
  `a an the and or but if then else of to in on at by for with from into over under about after before
   is are was were be been being am do does did done have has had having can could should would will shall may might must
   i you he she it we they me him her us them my your his its our their this that these those what which who whom whose why how when where
   not no yes all any both each few more most other some such only own same so than too very just also now new old
   show ask tell hn hacker news launch launched launching introducing using use used via vs versus
   how-to make makes made get gets got build built building way ways thing things one two three first year years day days week weeks
   why-i why-we here there out up down off again ever never always still yet based like want need free open source`.split(/\s+/)
);

function terms(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9.+#\- ]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));

  const out = new Set<string>(words);
  for (let i = 0; i < words.length - 1; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

async function hnTitles(fromSec: number, toSec: number): Promise<string[]> {
  const filters = encodeURIComponent(`created_at_i>${fromSec},created_at_i<${toSec},points>30`);
  const data = await getJson(`${HN}/search_by_date?tags=story&numericFilters=${filters}&hitsPerPage=1000`);
  return (data.hits ?? []).map((h: any) => String(h.title ?? "")).filter(Boolean);
}

export type TermMomentum = { term: string; thisMonth: number; lastMonth: number; growth: number; isNew: boolean };

export async function hnMomentum(): Promise<{ terms: TermMomentum[]; storiesThisMonth: number; storiesLastMonth: number }> {
  const now = Math.floor(Date.now() / 1000);
  const d30 = 30 * 24 * 3600;
  const recent = await hnTitles(now - d30, now);
  const prior = await hnTitles(now - 2 * d30, now - d30);

  const count = (titles: string[]) => {
    const m = new Map<string, number>();
    for (const t of titles) for (const term of terms(t)) m.set(term, (m.get(term) ?? 0) + 1);
    return m;
  };
  const r = count(recent);
  const p = count(prior);

  const rows: TermMomentum[] = [];
  for (const [term, thisMonth] of r) {
    if (thisMonth < 4) continue; // too rare to mean anything
    const lastMonth = p.get(term) ?? 0;
    const growth = Math.round(((thisMonth + 1) / (lastMonth + 1)) * 10) / 10;
    if (growth < 1.5) continue; // not rising
    rows.push({ term, thisMonth, lastMonth, growth, isNew: lastMonth === 0 });
  }

  // Prefer bigrams over their component words when both appear
  rows.sort((a, b) => b.growth * Math.log(b.thisMonth + 1) - a.growth * Math.log(a.thisMonth + 1));
  return { terms: rows.slice(0, 30), storiesThisMonth: recent.length, storiesLastMonth: prior.length };
}

// ---------- GitHub: hottest repos created in the last 30 days ----------

export type HotRepo = { name: string; description: string; stars: number; language: string; topics: string[]; url: string };

export async function hotNewRepos(): Promise<HotRepo[]> {
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const q = encodeURIComponent(`created:>${since}`);
  const data = await getJson(
    `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=40`,
    { Accept: "application/vnd.github+json" }
  );
  return (data.items ?? [])
    .filter((r: any) => !/^awesome[-_]/i.test(r.name ?? "")) // skip link lists
    .slice(0, 25)
    .map((r: any) => ({
      name: r.full_name,
      description: String(r.description ?? "").slice(0, 140),
      stars: r.stargazers_count ?? 0,
      language: r.language ?? "",
      topics: (r.topics ?? []).slice(0, 5),
      url: r.html_url,
    }));
}

// ---------- Show HN: what makers launched in the last 30 days ----------

export type Launch = { title: string; points: number; url: string };

export async function topLaunches(): Promise<Launch[]> {
  const since = Math.floor((Date.now() - 30 * DAY) / 1000);
  const filters = encodeURIComponent(`created_at_i>${since},points>40`);
  const data = await getJson(`${HN}/search_by_date?tags=show_hn&numericFilters=${filters}&hitsPerPage=100`);
  return (data.hits ?? [])
    .sort((a: any, b: any) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, 20)
    .map((h: any) => ({
      title: String(h.title ?? "").replace(/^show hn:\s*/i, ""),
      points: h.points ?? 0,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    }));
}
