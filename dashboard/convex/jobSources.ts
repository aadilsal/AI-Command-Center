// All job board fetchers. Each converts its board's format into NormalizedJob.
// Only boards where applying is free. To add a board: write a fetcher, add it to SOURCES.

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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
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
const HIMALAYAS_PAGES = 5; // 20 jobs per page
const OPEN_TO_PAKISTAN = /pakistan|asia|worldwide|anywhere|global/i;

async function fromHimalayas(): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  for (let page = 0; page < HIMALAYAS_PAGES; page++) {
    const data = await getJson(`https://himalayas.app/jobs/api?limit=20&offset=${page * 20}`);
    const list: any[] = data.jobs ?? [];

    for (const j of list) {
      const restrictions: string[] = Array.isArray(j.locationRestrictions)
        ? j.locationRestrictions.map((r: any) => (typeof r === "string" ? r : r?.name ?? "")).filter(Boolean)
        : [];

      // Skip jobs that explicitly exclude Pakistan, before any LLM tokens are spent
      if (restrictions.length && !restrictions.some((r) => OPEN_TO_PAKISTAN.test(r))) continue;

      const url = j.guid || j.applicationLink;
      if (!url || !j.title) continue;

      jobs.push({
        url,
        title: j.title,
        company: j.companyName || "Unknown",
        location: restrictions.length ? restrictions.join(", ") : "Worldwide",
        salary:
          j.minSalary && j.maxSalary
            ? `${j.currency ?? "USD"} ${j.minSalary} - ${j.maxSalary}`
            : "",
        description: cleanDescription(j.description || j.excerpt),
        source: "Himalayas",
        postedAt: toMs(j.pubDate),
      });
    }

    if (list.length < 20) break;
    await sleep(1000); // keep usage reasonable
  }
  return jobs;
}

// ---------- We Work Remotely (free RSS feeds) ----------
const WWR_FEEDS = [
  "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
];

function rssTag(item: string, tag: string): string {
  const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}

async function fromWeWorkRemotely(): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  for (const feed of WWR_FEEDS) {
    const xml = await fetchText(feed, "application/rss+xml, application/xml, text/xml");
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

    for (const item of items) {
      // Title format: "Company: Job Title"
      const rawTitle = rssTag(item, "title");
      const sep = rawTitle.indexOf(":");
      const company = sep > 0 ? rawTitle.slice(0, sep).trim() : "Unknown";
      const title = sep > 0 ? rawTitle.slice(sep + 1).trim() : rawTitle;
      const url = rssTag(item, "link") || rssTag(item, "guid");
      if (!url || !title) continue;

      jobs.push({
        url,
        title,
        company,
        location: rssTag(item, "region") || "Unspecified",
        salary: "",
        description: cleanDescription(rssTag(item, "description")),
        source: "We Work Remotely",
        postedAt: toMs(rssTag(item, "pubDate")),
      });
    }
    await sleep(800);
  }
  return jobs;
}

// ---------- Registry ----------
const SOURCES: { name: string; fetch: () => Promise<NormalizedJob[]> }[] = [
  { name: "Remotive", fetch: fromRemotive },
  { name: "Arbeitnow", fetch: fromArbeitnow },
  { name: "Jobicy", fetch: fromJobicy },
  { name: "Himalayas", fetch: fromHimalayas },
  { name: "We Work Remotely", fetch: fromWeWorkRemotely },
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
