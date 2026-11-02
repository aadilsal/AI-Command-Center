// Template for convex/resumes.ts (git-ignored, so real CVs never get committed).
// Copy this file to resumes.ts and paste your CVs as plain text (no backtick characters).

export type ResumeVariant = "fullstack" | "backend" | "frontend";

export const RESUMES: Record<ResumeVariant, string> = {
  fullstack: `PASTE YOUR FULL STACK CV HERE`,
  backend: `PASTE YOUR BACKEND CV HERE`,
  frontend: `PASTE YOUR FRONTEND CV HERE`,
};

// Rules the application-kit agent must follow when tailoring
export const RESUME_RULES = `- Never invent experience, employers, dates, metrics or skills.`;
