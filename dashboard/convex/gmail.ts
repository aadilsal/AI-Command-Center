import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

// =============================================================================
// Gmail API helpers (send + read), using the refresh token saved by
// `node scripts/gmail-login.mjs`. Secrets live in Convex environment variables:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_ADDRESS
// Nothing secret is ever stored in the database or the code.
// =============================================================================

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailAuthError extends Error {}

// "main" = the Gmail that sends (asb84390…); "alerts" = a second, read-only inbox where job alerts arrive
export type GmailAccount = "main" | "alerts";

function refreshToken(account: GmailAccount) {
  return account === "alerts" ? process.env.GOOGLE_REFRESH_TOKEN_ALERTS : process.env.GOOGLE_REFRESH_TOKEN;
}

export function gmailConfigured(account: GmailAccount = "main"): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && refreshToken(account));
}

export async function getAccessToken(account: GmailAccount = "main"): Promise<string> {
  if (!gmailConfigured(account)) {
    throw new GmailAuthError(
      account === "alerts"
        ? "Alerts inbox is not connected — run: node scripts/gmail-login.mjs --alerts"
        : "Gmail is not connected — run: node scripts/gmail-login.mjs"
    );
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken(account)!,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const why = `${json.error ?? res.status}${json.error_description ? `: ${json.error_description}` : ""}`;
    if (json.error === "invalid_grant") {
      throw new GmailAuthError(`Gmail sign-in expired or was revoked (${why}) — run: node scripts/gmail-login.mjs${account === "alerts" ? " --alerts" : ""}`);
    }
    throw new Error(`Gmail token error (${why})`);
  }
  return json.access_token;
}

async function gmailFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new GmailAuthError(`Gmail refused (${res.status}): ${text.slice(0, 200)}`);
    throw new Error(`Gmail API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- encoding helpers

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const toBase64Url = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function base64UrlToUtf8(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Header values: ASCII as-is, anything else as RFC 2047 encoded-word
function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${utf8ToBase64(clean)}?=`;
}

function wrap76(s: string) {
  return s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

// ---------------------------------------------------------------- send

export type SendInput = {
  to: string;
  subject: string;
  body: string; // plain text
  fromName?: string;
  threadId?: string;
  inReplyTo?: string; // RFC Message-ID of the message we answer
  references?: string[];
  attachments?: { filename: string; mimeType: string; data: Uint8Array }[];
  unsubscribeHeader?: boolean; // default true (outreach); false for job applications
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function sendEmail(input: SendInput): Promise<{ id: string; threadId: string; messageId: string | null }> {
  const from = process.env.GMAIL_ADDRESS;
  if (!from) throw new GmailAuthError("GMAIL_ADDRESS is not set — run: node scripts/gmail-login.mjs");
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to)) throw new Error(`Not a valid email address: ${input.to}`);

  const common = [
    `From: ${encodeHeader(input.fromName ?? "TechVersa")} <${from}>`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    ...(input.unsubscribeHeader === false ? [] : [`List-Unsubscribe: <mailto:${from}?subject=unsubscribe>`]),
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references?.length ? [`References: ${input.references.join(" ")}`] : []),
  ];
  const textPart = wrap76(utf8ToBase64(input.body.replace(/\r?\n/g, "\r\n")));
  let mime: string;
  if (!input.attachments?.length) {
    mime = [...common, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", textPart].join("\r\n");
  } else {
    // multipart/mixed: the message text + each file (CV, cover letter)
    const boundary = `cc_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const parts = [
      [`--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", textPart].join("\r\n"),
      ...input.attachments.map((a) =>
        [
          `--${boundary}`,
          `Content-Type: ${a.mimeType}; name="${a.filename.replace(/"/g, "")}"`,
          `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"`,
          "Content-Transfer-Encoding: base64",
          "",
          wrap76(bytesToBase64(a.data)),
        ].join("\r\n")
      ),
      `--${boundary}--`,
    ];
    mime = [...common, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", parts.join("\r\n")].join("\r\n");
  }

  const token = await getAccessToken();
  const sent = await gmailFetch<{ id: string; threadId: string }>(token, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: toBase64Url(utf8ToBase64(mime)), ...(input.threadId && { threadId: input.threadId }) }),
  });

  // Fetch the Message-ID header so follow-ups can thread correctly
  let messageId: string | null = null;
  try {
    const meta = await gmailFetch<{ payload?: { headers?: { name: string; value: string }[] } }>(
      token,
      `/messages/${sent.id}?format=metadata&metadataHeaders=Message-Id`
    );
    messageId = meta.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
  } catch {
    /* threading is nice-to-have */
  }
  return { id: sent.id, threadId: sent.threadId, messageId };
}

// ---------------------------------------------------------------- read

export type MailMessage = {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  messageId: string | null;
  references: string | null;
  date: number;
  snippet: string;
  body: string;
  html: string | null; // raw HTML part when there is one (job-alert parsing needs the links)
};

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };

function findText(part: Part | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return base64UrlToUtf8(part.body.data);
  for (const p of part.parts ?? []) {
    const t = findText(p, mime);
    if (t) return t;
  }
  return null;
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

// Cut quoted history ("On Mon, ... wrote:" and "> ..." lines) so we only keep the new reply
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/i.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim()) || /^From: .+/i.test(line.trim())) break;
    if (line.trim().startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export async function listMessageIds(token: string, q: string, max = 30): Promise<{ id: string; threadId: string }[]> {
  const res = await gmailFetch<{ messages?: { id: string; threadId: string }[] }>(
    token,
    `/messages?q=${encodeURIComponent(q)}&maxResults=${max}`
  );
  return res.messages ?? [];
}

export async function getMessage(token: string, id: string): Promise<MailMessage> {
  const m = await gmailFetch<{ id: string; threadId: string; snippet?: string; internalDate?: string; payload?: Part }>(
    token,
    `/messages/${id}?format=full`
  );
  const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  const from = h("From");
  const emailMatch = from.match(/<([^>]+)>/) ?? from.match(/([^\s<>"]+@[^\s<>"]+)/);
  const fromEmail = (emailMatch?.[1] ?? from).trim().toLowerCase();
  const fromName = from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || fromEmail;
  const plain = findText(m.payload, "text/plain");
  const html = findText(m.payload, "text/html");
  const body = (plain ?? (html ? htmlToText(html) : m.snippet ?? "")).slice(0, 20000);
  return {
    id: m.id,
    threadId: m.threadId,
    from,
    fromEmail,
    fromName,
    to: h("To"),
    subject: h("Subject"),
    messageId: h("Message-Id") || h("Message-ID") || null,
    references: h("References") || null,
    date: Number(m.internalDate ?? Date.now()),
    snippet: m.snippet ?? "",
    body,
    html: html ? html.slice(0, 300000) : null,
  };
}

// ---------------------------------------------------------------- connection status

export const status = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_name", (q) => q.eq("name", "gmail"))
      .first();
    return {
      configured: gmailConfigured(),
      status: row?.status ?? (gmailConfigured() ? "unknown" : "missing"),
      email: row?.email ?? process.env.GMAIL_ADDRESS ?? null,
      lastError: row?.lastError ?? null,
      checkedAt: row?.checkedAt ?? null,
      postalAddressSet: !!process.env.POSTAL_ADDRESS,
      bookingUrlSet: !!process.env.BOOKING_URL,
    };
  },
});

export const setStatus = internalMutation({
  args: {
    status: v.union(v.literal("connected"), v.literal("error"), v.literal("missing")),
    email: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_name", (q) => q.eq("name", "gmail"))
      .first();
    const fields = { status: a.status, email: a.email ?? row?.email, lastError: a.lastError, checkedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("integrations", { name: "gmail", ...fields });
  },
});

// `npx convex run gmail:check` — verifies the connection and records it
export const check = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; email?: string; error?: string }> => {
    if (!gmailConfigured()) {
      await ctx.runMutation(internal.gmail.setStatus, { status: "missing" });
      return { ok: false, error: "Not connected — run: node scripts/gmail-login.mjs" };
    }
    try {
      const token = await getAccessToken();
      const profile = await gmailFetch<{ emailAddress: string }>(token, "/profile");
      await ctx.runMutation(internal.gmail.setStatus, { status: "connected", email: profile.emailAddress });
      return { ok: true, email: profile.emailAddress };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.gmail.setStatus, { status: "error", lastError: msg.slice(0, 400) });
      return { ok: false, error: msg };
    }
  },
});

// Called by senders/readers when Gmail rejects us, so the dashboard shows a red warning
export async function reportGmailError(ctx: { runMutation: any }, e: unknown) {
  if (e instanceof GmailAuthError || /Gmail sign-in expired|Gmail refused|not connected/i.test(String(e))) {
    await ctx.runMutation(internal.gmail.setStatus, { status: "error", lastError: String(e instanceof Error ? e.message : e).slice(0, 400) });
  }
}
