import { internalAction } from "./_generated/server";
import {
  getAccessToken,
  getMessage,
  gmailConfigured,
  listMessageIds,
  type GmailAccount,
} from "./gmail";
import type { NormalizedJob } from "./jobSources";

// =============================================================================
// JOB ALERT EMAILS → jobs. The safe way to get LinkedIn (and Indeed, Glassdoor,
// Rozee.pk) listings: you create job alerts on those sites, they email you, and
// the Career Agent reads those emails in your Gmail. No scraping, no login, no
// risk to your accounts. Only the job details are kept, never the email itself.
// =============================================================================

const ALERT_QUERY =
  "newer_than:3d (" +
  [
    "from:jobalerts-noreply@linkedin.com",
    "from:jobs-noreply@linkedin.com",
    "from:jobs-listings@linkedin.com",
    "from:alert@indeed.com",
    "from:donotreply@jobalert.indeed.com",
    "from:noreply@glassdoor.com",
    "from:rozee.pk",
    'subject:"job alert"',
  ].join(" OR ") +
  ")";
const MAX_EMAILS = 25;

type Site = "LinkedIn" | "Indeed" | "Glassdoor" | "Rozee";

const LINK_PATTERNS: {
  site: Site;
  re: RegExp;
  canonical: (m: RegExpMatchArray) => string;
  id: (m: RegExpMatchArray) => string;
}[] = [
  {
    site: "LinkedIn",
    re: /https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/"'<>\s?]*-)?(\d{6,})[^"'<>\s]*/gi,
    canonical: (m) => `https://www.linkedin.com/jobs/view/${m[1]}/`,
    id: (m) => `li:${m[1]}`,
  },
  {
    site: "Indeed",
    re: /https?:\/\/(?:[a-z]+\.)?indeed\.com\/(?:rc\/clk|viewjob|pagead\/clk|m\/viewjob|applystart)[^"'<>\s]*?[?&]jk=([0-9a-f]{8,})[^"'<>\s]*/gi,
    canonical: (m) => `https://www.indeed.com/viewjob?jk=${m[1]}`,
    id: (m) => `in:${m[1]}`,
  },
  {
    site: "Glassdoor",
    re: /https?:\/\/(?:www\.)?glassdoor\.[a-z.]+\/(?:partner\/jobListing\.htm|job-listing\/[^"'<>\s]*)[^"'<>\s]*?(?:jobListingId|jl)=(\d{6,})[^"'<>\s]*/gi,
    canonical: (m) => `https://www.glassdoor.com/job-listing/?jl=${m[1]}`,
    id: (m) => `gd:${m[1]}`,
  },
  {
    site: "Rozee",
    re: /https?:\/\/(?:www\.)?rozee\.pk\/(?:job\/)?[^"'<>\s]*?-(\d{5,})(?:[^"'<>\s]*)?/gi,
    canonical: (m) => m[0].split("?")[0],
    id: (m) => `rz:${m[1]}`,
  },
];

const NOISE =
  /^(easy apply|apply( now)?|view( job)?|see (all )?jobs?|promoted|actively recruiting|new|be an early applicant|\d+ (connections?|alumni|applicants?).*|.*(school|company) alumni works? here|save|share|unsubscribe|manage (job )?alerts?|your job alert.*|jobs? you may be interested in.*|this company is actively hiring|top applicant|.*ago|\d+ (days?|hours?|weeks?) ago|responses managed off linkedin|medical insurance|vision|dental|401\(k\)|\+\d+ benefits?)$/i;

function decode(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// HTML → text lines, keeping each link as a marker right after its text
function htmlToMarkedText(html: string) {
  return decode(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_, href, inner) => ` ${inner.replace(/<[^>]+>/g, " ")} ⟦${href}⟧ \n`,
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|td|li|h\d|table|span)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function clean(line: string) {
  return line
    .replace(/⟦[^⟧]*⟧/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^(view job|apply|see job)\s*:?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Parsed = {
  site: Site;
  url: string;
  id: string;
  title: string;
  company: string;
  location: string;
};

const meaningful = (t: string) =>
  !!t && t.length >= 4 && t.length <= 140 && !NOISE.test(t);

function matchLink(line: string) {
  for (const p of LINK_PATTERNS) {
    p.re.lastIndex = 0;
    const m = p.re.exec(line);
    if (m) return { p, m };
  }
  return null;
}

export function parseAlert(html: string | null, text: string): Parsed[] {
  const lines = html
    ? htmlToMarkedText(html)
    : text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

  // 1) every line that contains a job link, grouped by job
  const occurrences = new Map<
    string,
    { i: number; p: (typeof LINK_PATTERNS)[number]; m: RegExpMatchArray }[]
  >();
  const order: string[] = [];
  lines.forEach((line, i) => {
    const hit = matchLink(line);
    if (!hit) return;
    const id = hit.p.id(hit.m);
    if (!occurrences.has(id)) {
      occurrences.set(id, []);
      order.push(id);
    }
    occurrences.get(id)!.push({ i, ...hit });
  });

  // 2) per job: prefer the link whose own text is the title (cards often also link the logo)
  const out: Parsed[] = [];
  for (const id of order) {
    const occ = occurrences.get(id)!;
    const best = occ.find((o) => meaningful(clean(lines[o.i]))) ?? occ[0];
    const { i, p, m } = best;
    let title = clean(lines[i]);
    let above: string[] = [];
    if (!meaningful(title)) {
      title = "";
      // Plain-text alerts: "Title / Company / Location / View job: URL" — the details sit above the link
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        if (matchLink(lines[j])) break;
        const t = clean(lines[j]);
        if (meaningful(t)) above.unshift(t);
      }
      above = above.slice(-3);
      if (above.length >= 2) {
        const [t, c, l] = above;
        const company = c.includes(" · ") ? c.split(" · ")[0].trim() : c;
        const location = c.includes(" · ")
          ? c.split(" · ")[1].trim()
          : (l ?? "");
        out.push({
          site: p.site,
          url: p.canonical(m),
          id,
          title: t,
          company: company.slice(0, 80),
          location: location.slice(0, 120),
        });
        continue;
      }
      title = above[0] ?? "";
    }
    // company / location: the next meaningful lines after the title, before the next job
    const after: string[] = [];
    for (
      let k = i + 1;
      k < Math.min(lines.length, i + 8) && after.length < 2;
      k++
    ) {
      const hit = matchLink(lines[k]);
      if (hit && hit.p.id(hit.m) !== id) break;
      const t = clean(lines[k]);
      if (t && t !== title && !NOISE.test(t)) after.push(t);
    }
    let company = after[0] ?? "";
    let location = after[1] ?? "";
    if (company.includes(" · "))
      [company, location] = company.split(" · ").map((x) => x.trim());
    if (!title || !company) continue;
    out.push({
      site: p.site,
      url: p.canonical(m),
      id,
      title,
      company: company.slice(0, 80),
      location: location.slice(0, 120),
    });
  }
  return out;
}

// Reads the alerts inbox (aadilsalman786…) if connected, plus the main inbox (forwarded alerts)
function accounts(): GmailAccount[] {
  return (["alerts", "main"] as GmailAccount[]).filter((a) =>
    gmailConfigured(a),
  );
}

export async function fromEmailAlerts(): Promise<NormalizedJob[]> {
  const jobs = new Map<string, NormalizedJob>();
  for (const account of accounts()) {
    const token = await getAccessToken(account);
    const ids = await listMessageIds(token, ALERT_QUERY, MAX_EMAILS);
    for (const { id } of ids) {
      const msg = await getMessage(token, id);
      for (const j of parseAlert(msg.html, msg.body)) {
        if (jobs.has(j.url)) continue;
        jobs.set(j.url, {
          url: j.url,
          title: j.title,
          company: j.company,
          location: j.location,
          salary: "",
          description: "",
          source: `${j.site} alert`,
          postedAt: msg.date,
        });
      }
    }
  }
  return [...jobs.values()];
}

// Check what the alert reader finds:  npx convex run jobAlerts:preview
export const preview = internalAction({
  args: {},
  handler: async () => {
    const list = accounts();
    if (!list.length) return { error: "No Gmail connected" };
    const emails = [];
    let emailsFound = 0;
    for (const account of list) {
      const token = await getAccessToken(account);
      const ids = await listMessageIds(token, ALERT_QUERY, MAX_EMAILS);
      emailsFound += ids.length;
      for (const { id } of ids.slice(0, 8)) {
        const msg = await getMessage(token, id);
        const found = parseAlert(msg.html, msg.body);
        emails.push({
          inbox: account,
          from: msg.fromEmail,
          subject: msg.subject.slice(0, 80),
          jobs: found
            .slice(0, 6)
            .map((j) => `${j.title} | ${j.company} | ${j.location}`),
          total: found.length,
        });
      }
    }
    return { inboxes: list, emailsFound, emails };
  },
});
