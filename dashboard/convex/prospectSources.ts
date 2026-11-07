// Finding agencies and reading their public websites. Only information agencies publish about themselves.
import { findBusinesses, geocodeCity } from "./osm";

export type Candidate = {
  name: string;
  website: string;
  domain: string;
  source: string;
  sourceContext?: string;
  city?: string;
  country?: string;
};

const UA = "Mozilla/5.0 (compatible; TechVersaResearch/1.0; +https://techversa.co)";
const TIMEOUT_MS = 15000;
const MAX_HTML = 400_000;

export function domainOf(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Sites that are never an agency's own website
const NOT_OWN_SITE = /(facebook|instagram|linkedin|twitter|x|youtube|tiktok|google|yelp|clutch|upwork|fiverr|wix|squarespace|godaddy|github|medium|notion)\.(com|co|site|io)$/;

// ---------- Discovery: OpenStreetMap agencies in a city ----------

export async function agenciesInCity(
  city: string,
  bbox: number[] | undefined,
  country: string
): Promise<{ bbox: number[]; candidates: Candidate[] }> {
  const box = bbox ?? (await geocodeCity(city));
  const businesses = await findBusinesses(box, "agency");
  const cityName = city.split(",")[0].trim();

  const candidates: Candidate[] = [];
  for (const b of businesses) {
    if (!b.website) continue; // we need their own site to research and personalise
    const website = b.website.startsWith("http") ? b.website : `https://${b.website}`;
    const domain = domainOf(website);
    if (!domain || NOT_OWN_SITE.test(domain)) continue;
    candidates.push({
      name: b.name,
      website,
      domain,
      source: "OpenStreetMap",
      sourceContext: `Listed on OpenStreetMap as an agency in ${cityName}`,
      city: cityName,
      country,
    });
  }
  return { bbox: box, candidates };
}

// ---------- Discovery: agencies hiring developers on HN "Who is hiring" ----------

const ALGOLIA = "https://hn.algolia.com/api/v1";
const AGENCY_WORDS = /\b(agency|studio|consultancy|consulting|creative)\b/i;

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function decode(s: string) {
  return s
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function agenciesFromHN(): Promise<Candidate[]> {
  const search = await getJson(`${ALGOLIA}/search_by_date?tags=story,author_whoishiring&hitsPerPage=6`);
  const thread = (search.hits ?? []).find((h: any) => /who is hiring/i.test(h.title ?? ""));
  if (!thread) return [];
  const item = await getJson(`${ALGOLIA}/items/${thread.objectID}`);

  const out: Candidate[] = [];
  for (const c of item.children ?? []) {
    if (!c?.text) continue;
    const html = decode(c.text);
    const firstLine = html.split(/<p>/i)[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!AGENCY_WORDS.test(firstLine)) continue;
    if (!/\b(us|usa|united states|uk|united kingdom|london|new york|nyc|remote)\b/i.test(firstLine)) continue;

    const url = (html.match(/https?:\/\/[^\s"<>)]+/i) ?? [])[0];
    if (!url) continue;
    const domain = domainOf(url);
    if (!domain || NOT_OWN_SITE.test(domain) || /ycombinator|greenhouse|lever|ashby|workable/.test(domain)) continue;

    const name = firstLine.split("|")[0].trim().slice(0, 80);
    out.push({
      name,
      website: `https://${domain}`,
      domain,
      source: "HN Who is hiring",
      sourceContext: `Posted in HN "Who is hiring" (hiring developers): ${firstLine.slice(0, 200)}`,
      country: /\b(uk|united kingdom|london)\b/i.test(firstLine) ? "UK" : /\b(us|usa|united states|new york|nyc)\b/i.test(firstLine) ? "US" : undefined,
    });
  }
  return out;
}

// ---------- Research: read their homepage (and contact page) ----------

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return (await res.text()).slice(0, MAX_HTML);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BAD_EMAIL = /(noreply|no-reply|donotreply|example\.|sentry|wixpress|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|@2x|domain\.com|email\.com|yourname)/i;

function extractEmails(html: string, domain: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of html.match(EMAIL_RE) ?? []) found.add(m.toLowerCase());
  const emails = [...found].filter((e) => !BAD_EMAIL.test(e) && e.length < 80);
  // Prefer emails on the agency's own domain
  const own = emails.filter((e) => e.endsWith(`@${domain}`) || e.split("@")[1]?.endsWith(`.${domain}`));
  return (own.length ? own : emails).slice(0, 6);
}

export type SiteResearch = { text: string; emails: string[]; contactPage?: string };

export async function researchSite(website: string): Promise<SiteResearch | null> {
  const domain = domainOf(website);
  if (!domain) return null;
  const base = `https://${domain}`;

  const home = (await fetchHtml(website)) ?? (await fetchHtml(base));
  if (!home) return null;

  let emails = extractEmails(home, domain);
  let text = htmlToText(home);

  // Find a contact page link; read it if the homepage had no email
  const contactHref = (home.match(/href=["']([^"']*contact[^"']*)["']/i) ?? [])[1];
  let contactPage: string | undefined;
  if (contactHref) {
    try {
      contactPage = new URL(contactHref, base).toString();
    } catch {
      /* ignore */
    }
  }
  if (!emails.length) {
    const candidates = [contactPage, `${base}/contact`, `${base}/contact-us`].filter(Boolean) as string[];
    for (const url of candidates) {
      const html = await fetchHtml(url);
      if (!html) continue;
      emails = extractEmails(html, domain);
      contactPage = url;
      if (emails.length) {
        text += " " + htmlToText(html).slice(0, 800);
        break;
      }
    }
  }

  if (text.length < 200) return null; // nothing meaningful to read
  return { text: text.slice(0, 4000), emails, contactPage };
}
