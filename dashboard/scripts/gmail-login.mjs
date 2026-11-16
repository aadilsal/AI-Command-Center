#!/usr/bin/env node
// One-time Gmail sign-in for the Command Center.
//
//   cd ~/ai-command-center/dashboard && node scripts/gmail-login.mjs
//   node scripts/gmail-login.mjs --alerts   → connect a second inbox READ-ONLY (job alert emails)
//
// 1. Reads your OAuth client from ~/.config/command-center/google-oauth.json
// 2. Prints a Google sign-in link → you approve in the browser
// 3. Saves the keys into Convex environment variables (never into the code or git):
//    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_ADDRESS
// 4. Runs gmail:check so the dashboard shows "Gmail connected"
//
// Permissions asked: send email + read email (the Reply Agent only stores replies
// from prospects you emailed).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const CRED_PATH = process.env.GOOGLE_OAUTH_JSON ?? join(homedir(), ".config", "command-center", "google-oauth.json");
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const ALERTS = process.argv.includes("--alerts");
// The alerts inbox only needs reading; the main inbox sends and reads
const SCOPES = ALERTS
  ? ["https://www.googleapis.com/auth/gmail.readonly"]
  : ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

let creds;
try {
  const json = JSON.parse(readFileSync(CRED_PATH, "utf8"));
  creds = json.installed ?? json.web;
} catch {
  fail(`Couldn't read ${CRED_PATH}. Move the downloaded client_secret_*.json there first.`);
}
if (!creds?.client_id || !creds?.client_secret) fail("That JSON doesn't look like an OAuth client file (no client_id/client_secret).");

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

async function exchange(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.refresh_token) fail(`Google didn't return a refresh token: ${JSON.stringify(json)}`);
  return json;
}

function convexEnvSet(name, value) {
  const r = spawnSync("npx", ["convex", "env", "set", name, value], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (r.status !== 0) fail(`Couldn't save ${name} to Convex:\n${r.stderr || r.stdout}\n(Is "npx convex dev" set up in this folder?)`);
  console.log(`  ✓ saved ${name}`);
}

let finished = false;
async function finish(code, returnedState) {
  if (finished) return;
  finished = true;
  if (returnedState !== state) fail("Security check failed (state mismatch). Run the script again.");
  console.log("\nSigning in…");
  const tokens = await exchange(code);

  const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json());
  if (!profile.emailAddress) fail(`Signed in, but couldn't read the Gmail profile: ${JSON.stringify(profile)}`);

  console.log(`Connected as ${profile.emailAddress}. Saving to Convex…`);
  convexEnvSet("GOOGLE_CLIENT_ID", creds.client_id);
  convexEnvSet("GOOGLE_CLIENT_SECRET", creds.client_secret);
  if (ALERTS) {
    convexEnvSet("GOOGLE_REFRESH_TOKEN_ALERTS", tokens.refresh_token);
    convexEnvSet("ALERTS_GMAIL_ADDRESS", profile.emailAddress);
    console.log(`✔ ${profile.emailAddress} connected read-only for job alerts. Test: npx convex run jobAlerts:preview\n`);
  } else {
    convexEnvSet("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);
    convexEnvSet("GMAIL_ADDRESS", profile.emailAddress);
    const check = spawnSync("npx", ["convex", "run", "gmail:check"], { encoding: "utf8" });
    console.log(check.stdout || check.stderr);
    console.log("✔ Gmail is connected. Open /autopilot on the dashboard.\n");
  }
  server.close();
  rl.close();
  process.exit(0);
}

// 1) Catch Google's redirect on localhost
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (err) {
    res.end(`<h2>Sign-in cancelled (${err}). You can close this tab.</h2>`);
    fail(`Google returned: ${err}`);
  }
  if (!code) return res.end("Waiting for Google…");
  res.end("<h2>Command Center: Gmail connected. You can close this tab and go back to the terminal.</h2>");
  finish(code, url.searchParams.get("state")).catch((e) => fail(String(e)));
});
server.on("error", () => console.log("(Couldn't open the local callback port — use the paste method below.)"));
server.listen(PORT, "0.0.0.0");

// 2) Fallback: paste the address from the browser bar if the page doesn't load
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  try {
    const url = new URL(text);
    const code = url.searchParams.get("code");
    if (!code) return console.log("That address has no ?code= in it — copy the whole address after signing in.");
    finish(code, url.searchParams.get("state")).catch((e) => fail(String(e)));
  } catch {
    console.log("Paste the full address that starts with http://localhost:53682/?state=…");
  }
});

console.log(`
Gmail sign-in for the Command Center
────────────────────────────────────
1. Open this link in Chrome and sign in with ${ALERTS ? "the Gmail where your JOB ALERTS arrive (read-only)" : "the Gmail you want to send from"}:

${authUrl}

2. If Google says the app isn't verified: Advanced → "Go to Command Center (unsafe)" → Continue.
3. Tick ${ALERTS ? "the read permission" : "both permissions (send + read)"} and press Continue.

If the last page shows "This site can't be reached", copy the full address from
the browser bar and paste it here, then press Enter.
`);
