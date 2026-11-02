// Normalized title|company — the same job posted on two boards gets the same key.
export function jobKey(title: string, company: string): string {
  return `${title}|${company}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
}
