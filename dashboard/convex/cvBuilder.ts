import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { CV_PROFILE } from "./cvProfile";
import { renderCv, renderLetter, STYLES, type CvDoc } from "./cvPdf";

// =============================================================================
// CV BUILDER — makes a one-page, ATS-friendly CV tailored to a job:
//   - summary: the job's application-kit summary (written from your real CV), or your base one
//   - skills: ALL your skills kept, reordered so the job's most relevant ones come first
//   - projects: the 3-4 most relevant to the job (from your CV + GitHub), "Always" ones first
//   - experience + education: exactly as in your CV
// If it runs over one page it trims project bullets, then drops a project, then tightens
// spacing slightly — never shrinks text below readable size, never invents anything.
// =============================================================================

type Project = Pick<Doc<"cvProjects">, "key" | "name" | "context" | "url" | "stack" | "bullets" | "tags" | "include">;

const STOP = new Set(["and", "the", "for", "with", "from", "into", "using", "based", "app", "system", "platform", "pipeline"]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#./ -]/g, " ")
    .split(/[\s/,-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function relevance(p: Project, jobText: string): number {
  const text = jobText.toLowerCase();
  let score = 0;
  for (const t of [...p.stack, ...p.tags]) {
    const term = t.toLowerCase().split(" (")[0];
    if (term.length > 1 && text.includes(term)) score += 3;
  }
  for (const w of new Set(words(`${p.name} ${p.bullets.join(" ")}`))) if (w.length > 3 && text.includes(w)) score += 0.3;
  return score;
}

function reorderSkills(skills: { label: string; items: string[] }[], priority: string[], jobText: string) {
  const rank = (item: string) => {
    const i = priority.findIndex((p) => p.toLowerCase() === item.toLowerCase());
    if (i >= 0) return i;
    return jobText.toLowerCase().includes(item.toLowerCase().split(" (")[0]) ? 50 : 100;
  };
  return skills.map((g) => ({ ...g, items: [...g.items].sort((a, b) => rank(a) - rank(b)) }));
}

function safeFileName(company: string) {
  return company.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "Role";
}

// ---------------------------------------------------------------- data for a build

export const gather = internalQuery({
  args: { jobId: v.optional(v.id("jobs")) },
  handler: async (ctx, { jobId }) => {
    const projects = (await ctx.db.query("cvProjects").take(200)).filter((p) => p.include !== "never");
    if (!jobId) return { job: null, description: "", projects };
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const detail = await ctx.db
      .query("jobDetails")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .first();
    return { job, description: detail?.description ?? job.description ?? "", projects };
  },
});

export const saveFile = internalMutation({
  args: {
    jobId: v.optional(v.id("jobs")),
    kind: v.union(v.literal("cv"), v.literal("letter")),
    storageId: v.id("_storage"),
    filename: v.string(),
    projectKeys: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    // Keep only the newest file of each kind per job (old ones are deleted from storage)
    if (a.jobId) {
      const old = await ctx.db
        .query("cvFiles")
        .withIndex("by_job", (q) => q.eq("jobId", a.jobId))
        .take(20);
      for (const f of old) {
        if (f.kind === a.kind && !f.sentTo) {
          await ctx.storage.delete(f.storageId);
          await ctx.db.delete(f._id);
        }
      }
    }
    return await ctx.db.insert("cvFiles", { ...a, createdAt: Date.now() });
  },
});

// ---------------------------------------------------------------- build

export type BuildResult = {
  cvFileId: Id<"cvFiles">;
  cvStorageId: Id<"_storage">;
  cvName: string;
  letterFileId: Id<"cvFiles"> | null;
  letterStorageId: Id<"_storage"> | null;
  letterName: string | null;
  projects: string[];
};

export const build = internalAction({
  args: { jobId: v.optional(v.id("jobs")) },
  handler: async (ctx, { jobId }): Promise<BuildResult> => {
    const data: { job: Doc<"jobs"> | null; description: string; projects: Doc<"cvProjects">[] } | null = await ctx.runQuery(
      internal.cvBuilder.gather,
      { jobId }
    );
    if (!data) throw new Error("Job not found");
    if (data.projects.length === 0) await ctx.runMutation(internal.cvProjects.seedFromProfile, {});
    const projectsAll: Project[] = data.projects.length
      ? data.projects
      : CV_PROFILE.projects.map((p) => ({ ...p, include: "auto" as const }));

    const job = data.job;
    const kit = job?.kit;
    const jobText = job ? `${job.title} ${job.company} ${data.description} ${(kit?.skills ?? []).join(" ")} ${(job.reasons ?? []).join(" ")}` : "";

    // Pick projects: "always" first, then most relevant (ties keep your CV order)
    const ranked = projectsAll
      .map((p, i) => ({ p, i, score: p.include === "always" ? 1000 : job ? relevance(p, jobText) : -i }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.p);

    const base = {
      name: CV_PROFILE.name,
      headline: CV_PROFILE.headline,
      contact: [CV_PROFILE.location, CV_PROFILE.email, CV_PROFILE.phone],
      links: CV_PROFILE.links,
      summary: kit?.summary?.trim() || CV_PROFILE.summary,
      skills: job ? reorderSkills(CV_PROFILE.skills, kit?.skills ?? [], jobText) : CV_PROFILE.skills,
      experience: CV_PROFILE.experience,
      education: CV_PROFILE.education,
      keywords: kit?.skills ?? [],
    };

    // Try the fullest version first, then trim until it fits on one page
    const attempts: { style: number; projects: number; bullets: number; expBullets: number }[] = [
      { style: 0, projects: 4, bullets: 3, expBullets: 5 },
      { style: 0, projects: 4, bullets: 2, expBullets: 5 },
      { style: 0, projects: 3, bullets: 3, expBullets: 5 },
      { style: 0, projects: 3, bullets: 2, expBullets: 5 },
      { style: 1, projects: 3, bullets: 2, expBullets: 5 },
      { style: 2, projects: 3, bullets: 2, expBullets: 5 },
      { style: 2, projects: 3, bullets: 2, expBullets: 4 },
      { style: 2, projects: 2, bullets: 2, expBullets: 4 },
    ];
    let pdf: Uint8Array | null = null;
    let used: Project[] = [];
    for (const a of attempts) {
      used = ranked.slice(0, a.projects);
      const doc: CvDoc = {
        ...base,
        experience: base.experience.map((e, i) => (i === 0 ? { ...e, bullets: e.bullets.slice(0, a.expBullets) } : e)),
        projects: used.map((p) => ({ name: p.name, context: p.context, url: p.url, stack: p.stack, bullets: p.bullets.slice(0, a.bullets) })),
      };
      const r = await renderCv(doc, STYLES[a.style]);
      pdf = r.bytes;
      if (!r.overflow) break;
    }
    if (!pdf) throw new Error("Could not build the CV");

    const suffix = job ? safeFileName(job.company) : "General";
    const cvName = `Aadil_Salman_Butt_CV_${suffix}.pdf`;
    const cvStorageId = await ctx.storage.store(new Blob([pdf as BlobPart], { type: "application/pdf" }));
    const cvFileId: Id<"cvFiles"> = await ctx.runMutation(internal.cvBuilder.saveFile, {
      jobId,
      kind: "cv",
      storageId: cvStorageId,
      filename: cvName,
      projectKeys: used.map((p) => p.key),
    });

    // Cover letter PDF (only when the job has a kit)
    let letterFileId: Id<"cvFiles"> | null = null;
    let letterStorageId: Id<"_storage"> | null = null;
    let letterName: string | null = null;
    if (kit?.coverLetter) {
      const bytes = await renderLetter({
        name: CV_PROFILE.name,
        contact: [CV_PROFILE.location, CV_PROFILE.email, CV_PROFILE.phone],
        links: CV_PROFILE.links,
        date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Karachi" }),
        body: kit.coverLetter,
      });
      letterName = `Aadil_Salman_Butt_Cover_Letter_${suffix}.pdf`;
      letterStorageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      letterFileId = await ctx.runMutation(internal.cvBuilder.saveFile, {
        jobId,
        kind: "letter",
        storageId: letterStorageId,
        filename: letterName,
        projectKeys: [],
      });
    }
    return { cvFileId, cvStorageId, cvName, letterFileId, letterStorageId, letterName, projects: used.map((p) => p.name) };
  },
});

// ---------------------------------------------------------------- dashboard

// "Tailored CV" button (Career page) and "Build general CV" (CV Builder page)
export const make = action({
  args: { jobId: v.optional(v.id("jobs")) },
  handler: async (ctx, { jobId }): Promise<{ cvUrl: string | null; letterUrl: string | null; projects: string[] }> => {
    const r: BuildResult = await ctx.runAction(internal.cvBuilder.build, { jobId });
    return {
      cvUrl: await ctx.storage.getUrl(r.cvStorageId),
      letterUrl: r.letterStorageId ? await ctx.storage.getUrl(r.letterStorageId) : null,
      projects: r.projects,
    };
  },
});

export const filesForJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const files = await ctx.db
      .query("cvFiles")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(10);
    return await Promise.all(files.map(async (f) => ({ ...f, url: await ctx.storage.getUrl(f.storageId) })));
  },
});

export const recentFiles = query({
  args: {},
  handler: async (ctx) => {
    const files = await ctx.db.query("cvFiles").withIndex("by_createdAt").order("desc").take(20);
    return await Promise.all(
      files.map(async (f) => {
        const job = f.jobId ? await ctx.db.get(f.jobId) : null;
        return {
          _id: f._id,
          kind: f.kind,
          filename: f.filename,
          createdAt: f.createdAt,
          sentTo: f.sentTo,
          url: await ctx.storage.getUrl(f.storageId),
          job: job ? { title: job.title, company: job.company, status: job.status } : null,
        };
      })
    );
  },
});
