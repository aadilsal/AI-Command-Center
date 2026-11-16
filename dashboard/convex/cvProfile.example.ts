// Template for convex/cvProfile.ts (git-ignored, so your CV never lands on GitHub).
// Copy this file to cvProfile.ts and fill in your real details. Only facts written here are used.

export type CvProjectSeed = {
  key: string;
  name: string;
  context?: string;
  url?: string;
  stack: string[];
  bullets: string[];
  tags: string[];
  repo?: string;
};

export const CV_PROFILE = {
  name: "Your Name",
  headline: "Your Title | Main skills",
  location: "City, Country (Remote)",
  email: "you@example.com",
  phone: "+00 000 0000000",
  links: ["linkedin.com/in/you", "github.com/you"],
  githubUser: "you",
  summary: "Two to four sentences about what you build.",
  skills: [{ label: "Languages", items: ["TypeScript", "Python"] }],
  experience: [{ role: "Software Engineer", org: "Company, City", dates: "Jan 2025 - Present", bullets: ["What you built"] }],
  education: [{ degree: "BS Computer Science", org: "University", dates: "2022 - 2026" }],
  projects: [] as CvProjectSeed[],
};

export type CvProfile = typeof CV_PROFILE;
