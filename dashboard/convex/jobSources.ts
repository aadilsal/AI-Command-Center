// All job board fetchers. Each converts its board's format into NormalizedJob.
// To add a new board: write a fetcher and add it to SOURCES at the bottom.

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

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function stripHtml(html: string | undefined | null): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Removes anti-bot "application traps" some boards hide in descriptions
 * (e.g. RemoteOK: "Please mention the word X and tag Y when applying").
 * The tag identifies the scraper, so it must never reach an application.
 */
export function stripApplyTraps(text: string): string {
  return text
    .replace(/please mention the word[\s\S]*?(spam applicants?|when applying)[^.]*\.?/gi, " ")
    .replace(/\(?#?\b[A-Za-z0-9+/]{12,}={1,2}\)?/g, " ") // base64-like tags
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
  const data = await getJson(
    "https://remotive.com/api/remote-jobs?category=software-dev"
  );
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

// ---------- RemoteOK (first array item is a legal notice) ----------
async function fromRemoteOK(): Promise<NormalizedJob[]> {
  const data = await getJson("https://remoteok.com/api");
  return (Array.isArray(data) ? data : [])
    .filter((j: any) => j && j.position && j.url)
    .map((j: any) => ({
      url: j.url,
      title: j.position,
      company: j.company || "Unknown",
      location: j.location || "Worldwide",
      salary:
        j.salary_min && j.salary_max
          ? `$${j.salary_min} - $${j.salary_max}`
          : "",
      description: cleanDescription(j.description),
      source: "RemoteOK",
      postedAt: toMs(j.epoch ?? j.date),
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

// ---------- Registry ----------
const SOURCES: { name: string; fetch: () => Promise<NormalizedJob[]> }[] = [
  { name: "Remotive", fetch: fromRemotive },
  { name: "Arbeitnow", fetch: fromArbeitnow },
  { name: "RemoteOK", fetch: fromRemoteOK },
  { name: "Jobicy", fetch: fromJobicy },
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
