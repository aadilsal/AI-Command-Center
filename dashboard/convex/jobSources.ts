// All job board fetchers. Each converts its board's format into NormalizedJob.
// Only sources where browsing AND applying are free. To add/remove one, edit SOURCES at the bottom.

export type NormalizedJob = {
  url: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
  source: string;
  postedAt?: number; // ms timestamp
};

export type SourceResult = {
  source: string;
  jobs: NormalizedJob[];
  error?: string;
};

const USER_AGENT = "AadilCommandCenter/1.0 (personal job search)";
const REQUEST_TIMEOUT_MS = 25000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, accept = "application/json"): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const getJson = async (url: string): Promise<any> => JSON.parse(await fetchText(url));

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripHtml(html: string | undefined | null): string {
  return decodeEntities(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Removes anti-bot "application traps" some boards hide in descriptions
 * ("Please mention the word X and tag Y when applying"). Never let these reach an application.
 */
export function stripApplyTraps(text: string): string {
  return text
    .replace(/please mention the word[\s\S]*?(spam applicants?|when applying)[^.]*\.?/gi, " ")
    .replace(/\(?#?\b[A-Za-z0-9+/]{12,}={1,2}\)?/g, " ")
    .replace(/#[A-Za-z0-9]{10,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const cleanDescription = (html: string | undefined | null) => stripApplyTraps(stripHtml(html));

function toMs(value: unknown): number | undefined {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

// ---------- Remotive ----------
async function fromRemotive(): Promise<NormalizedJob[]> {
  const data = await getJson("https://remotive.com/api/remote-jobs?category=software-dev");
  return (data.jobs ?? []).map((j: any) => ({
    url: j.url,
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || "Unspecified",
    salary: j.salary || "",
    description: cleanDescription(j.description),
    source: "Remotive",
    postedAt: toMs(j.publication_date),
  }));
}

// ---------- Arbeitnow (remote jobs only) ----------
async function fromArbeitnow(): Promise<NormalizedJob[]> {
  const data = await getJson("https://www.arbeitnow.com/api/job-board-api");
  return (data.data ?? [])
    .filter((j: any) => j.remote === true)
    .map((j: any) => ({
      url: j.url,
      title: j.title,
      company: j.company_name,
      location: j.location || "Remote",
      salary: "",
      description: cleanDescription(j.description),
      source: "Arbeitnow",
      postedAt: toMs(j.created_at),
    }));
}

// ---------- Jobicy ----------
async function fromJobicy(): Promise<NormalizedJob[]> {
  const data = await getJson("https://jobicy.com/api/v2/remote-jobs?count=50");
  return (data.jobs ?? []).map((j: any) => ({
    url: j.url,
    title: j.jobTitle,
    company: j.companyName,
    location: j.jobGeo || "Unspecified",
    salary:
      j.annualSalaryMin && j.annualSalaryMax
        ? `${j.salaryCurrency ?? ""} ${j.annualSalaryMin} - ${j.annualSalaryMax}`.trim()
        : "",
    description: cleanDescription(j.jobDescription || j.jobExcerpt),
    source: "Jobicy",
    postedAt: toMs(j.pubDate),
  }));
}

// ---------- Himalayas (free public API; credit Himalayas when displaying) ----------
const HIMALAYAS_QUERIES = ["full stack", "backend", "frontend", "react", "node.js"];
const HIMALAYAS_BROWSE_PAGES = 5; // fallback only
const OPEN_TO_PAKISTAN = /pakistan|asia|worldwide|anywhere|global/i;

function himalayasJob(j: any): NormalizedJob | null {
  const restrictions: string[] = Array.isArray(j.locationRestrictions)
    ? j.locationRestrictions.map((r: any) => (typeof r === "string" ? r : r?.name ?? "")).filter(Boolean)
    : [];

  // Skip jobs that explicitly exclude Pakistan, before any LLM tokens are spent
  if (restrictions.length && !restrictions.some((r) => OPEN_TO_PAKISTAN.test(r))) return null;

  const url = j.guid || j.applicationLink;
  if (!url || !j.title) return null;

  return {
    url,
    title: j.title,
    company: j.companyName || "Unknown",
    location: restrictions.length ? restrictions.join(", ") : "Worldwide",
    salary: j.minSalary && j.maxSalary ? `${j.currency ?? "USD"} ${j.minSalary} - ${j.maxSalary}` : "",
    description: cleanDescription(j.description || j.excerpt),
    source: "Himalayas",
    postedAt: toMs(j.pubDate),
  };
}

async function fromHimalayas(): Promise<NormalizedJob[]> {
  const found = new Map<string, NormalizedJob>();
  let searchWorked = false;

  for (const q of HIMALAYAS_QUERIES) {
    try {
      const enc = encodeURIComponent(q);
      const data = await getJson(`https://himalayas.app/jobs/api/search?q=${enc}&keyword=${enc}`);
      searchWorked = true;
      for (const raw of data.jobs ?? []) {
        const job = himalayasJob(raw);
        if (job && !found.has(job.url)) found.set(job.url, job);
      }
    } catch {
      /* try the next keyword */
    }
    await sleep(1000);
  }

  if (!searchWorked) {
    for (let page = 0; page < HIMALAYAS_BROWSE_PAGES; page++) {
      const data = await getJson(`https://himalayas.app/jobs/api?limit=20&offset=${page * 20}`);
      const list: any[] = data.jobs ?? [];
      for (const raw of list) {
        const job = himalayasJob(raw);
        if (job && !found.has(job.url)) found.set(job.url, job);
      }
      if (list.length < 20) break;
      await sleep(1000);
    }
  }

  return [...found.values()];
}

// ---------- Hacker News "Who is hiring?" (free; companies post directly) ----------
// Post format is usually: "Company | Role | Location | REMOTE | ..." on the first line.
const ALGOLIA = "https://hn.algolia.com/api/v1";
const ROLE_WORDS = /engineer|developer|stack|backend|back-end|frontend|front-end|software|programmer|swe\b/i;

async function fromHNWhoIsHiring(): Promise<NormalizedJob[]> {
  const search = await getJson(`${ALGOLIA}/search_by_date?tags=story,author_whoishiring&hitsPerPage=6`);
  const thread = (search.hits ?? []).find((h: any) => /who is hiring/i.test(h.title ?? ""));
  if (!thread) throw new Error("No 'Who is hiring' thread found");

  const item = await getJson(`${ALGOLIA}/items/${thread.objectID}`);
  const jobs: NormalizedJob[] = [];

  for (const c of item.children ?? []) {
    if (!c?.text || !c.author) continue;

    const firstLine = decodeEntities(c.text.split(/<p>/i)[0])
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!/\bremote\b/i.test(firstLine)) continue; // remote roles only

    const parts = firstLine.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;

    const company = parts[0].slice(0, 80);
    const title = (parts.slice(1).find((p) => ROLE_WORDS.test(p)) ?? parts[1]).slice(0, 120);
    const location = parts.filter((p) => /remote|onsite|on-site|hybrid|us|eu|uk|worldwide|anywhere/i.test(p)).join(", ") || "Remote";

    jobs.push({
      url: `https://news.ycombinator.com/item?id=${c.id}`,
      title,
      company,
      location,
      salary: "",
      description: cleanDescription(c.text),
      source: "HN Who is hiring",
      postedAt: c.created_at_i ? c.created_at_i * 1000 : undefined,
    });
  }

  return jobs;
}

// ---------- Registry ----------
const SOURCES: { name: string; fetch: () => Promise<NormalizedJob[]> }[] = [
  { name: "Remotive", fetch: fromRemotive },
  { name: "Arbeitnow", fetch: fromArbeitnow },
  { name: "Jobicy", fetch: fromJobicy },
  { name: "Himalayas", fetch: fromHimalayas },
  { name: "HN Who is hiring", fetch: fromHNWhoIsHiring },
];

// Fetch every source in parallel; one failing never breaks the others.
export async function fetchAllJobs(): Promise<SourceResult[]> {
  return Promise.all(
    SOURCES.map(async (s) => {
      try {
        const jobs = (await s.fetch()).filter((j) => j.url && j.title);
        return { source: s.name, jobs };
      } catch (err) {
        return {
          source: s.name,
          jobs: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );
}
