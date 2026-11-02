# AI Command Center

**A personal AI operating system: autonomous agents that find career opportunities, discover real business pain worth building products for, and tell me exactly what to do each morning.**

This is not a dashboard with a chatbot bolted on. The dashboard is just the control panel. The real product is the set of AI workers running behind it on a schedule, collecting data from the web, analyzing it with an LLM, validating the output in code, and turning it into prioritized actions.

---

## The problem

I work full time as a software engineer, run a software studio ([TechVersa](https://techversa.co)) on the side, and look for better engineering roles. Doing all three well meant hours every week of:

- checking job boards, reading descriptions, judging fit, and tailoring applications
- guessing which products to build, without real evidence of demand
- tracking what I applied to and what needs a follow-up
- deciding what actually matters today

Most of that is repetitive. So I built agents to do it.

## What it does

| When (PKT) | Agent | What it does |
|---|---|---|
| Every 3 hours | **Pain Agent** | Collects posts where people describe business problems, has an LLM extract the unmet need, groups similar complaints into problems, and scores each opportunity |
| 07:30 | **Cleanup** | Archives stale jobs so the dashboard stays focused |
| 08:00 | **Career Agent** | Pulls remote jobs from 5 free-to-apply sources, skips anything seen before, and scores each one against my profile |
| 09:00 | **Briefing Agent** | Reads everything the other agents found and writes a short briefing: a headline and the 3–5 most important actions for today |
| Every 30 min | **Watchdog** | Resets any agent whose run was interrupted |

Then I open one page and know:

1. Which jobs are worth applying to, with a tailored application ready
2. Which real problems people are paying to have solved, and what to build for them
3. What I should do today
4. What my agents are doing, and whether any of them are failing

## Features

### Opportunity Radar (product discovery)

Instead of guessing what to build, the radar listens for pain people describe in their own words:

- **Sources:** Hacker News (Ask HN posts and comments like *"is there a tool for…"*), Stack Exchange Software Recommendations (people asking for software that doesn't exist), and 1–3★ App Store reviews of popular small-business tools (paying customers explaining what's missing)
- **LLM extraction:** who has the pain, what hurts, their current workaround, evidence they'd pay, intensity, and buildability
- **Noise filtering:** vendor bugs, refund disputes, developer tooling, and consumer complaints are discarded, because only an *unmet need* a new product could solve counts
- **Grouping:** similar complaints from different people and sources merge into one problem. One post is an anecdote; ten is demand
- **Scoring (0–100):** frequency, intensity, willingness-to-pay evidence, buildability, spread across sources, and recency. Single mentions get half credit, so one loud complaint can't outrank shared pain
- **Solution Designer:** for problems with enough evidence, generates a product concept, MVP feature list, stack, build effort, pricing tied to the evidence, where to find users, content angles, validation steps, and risks
- **Viability gate:** problems only the original vendor could fix get parked with a reason instead of producing an invented product
- **Pipeline:** New → Exploring → Building → Launched / Parked

### Career

- Job discovery from free-to-apply sources (Remotive, Arbeitnow, Jobicy, Himalayas, Hacker News "Who is hiring") with cross-board de-duplication
- LLM scoring against my profile, including location eligibility (a "remote" role that excludes Pakistan is marked Skip)
- **Application kits:** one click produces a tailored summary, rewritten highlights, skills to list first, a cover letter, and an application email, built only from facts in my CV
- One-click **Apply** that opens the posting and marks it Applied, plus an application tracker (Saved → Applied → Interview → Offer / Rejected)

### Daily briefing

- An LLM "chief of staff" that ranks the day's actions: job applications, follow-ups, and the best opportunity to design or validate
- Every action must link to a real record, so it cannot invent anything, and it falls back to a rule-based briefing if the LLM fails

## Guardrails

LLM output is never trusted blindly. It's checked in code, and regenerated with feedback when it breaks a rule:

- **No invented facts:** every number in an application kit must appear in my CV or the job post; skills not in my CV are dropped; market statistics in solution designs are rejected
- **Honest tone:** inflated self-descriptions ("expert", "proven track record") and embellishments are rejected
- **Real evidence only:** every evidence quote on the radar must exist word-for-word in the original post
- **Untrusted input:** job posts and user posts are treated as data, never instructions. Anti-bot traps hidden in job descriptions (e.g. *"mention the word X and tag Y"*) are stripped before they can reach an application
- **Validated structure:** scores are clamped, enums checked, and briefing links verified against real records

## Architecture

~~~mermaid
flowchart LR
    subgraph Sources["Free public sources"]
        JB["Job sources<br/>Remotive · Arbeitnow · Jobicy<br/>Himalayas · HN Who is hiring"]
        PS["Pain sources<br/>Hacker News · Stack Exchange<br/>App Store reviews"]
    end

    subgraph Convex["Convex backend"]
        CRON["Cron scheduler"]
        CA["Career Agent"]
        PA["Pain Agent"]
        SD["Solution Designer"]
        AK["Application Kits"]
        BA["Briefing Agent"]
        DB[("Database<br/>jobs · painSignals · problems<br/>briefings · agents")]
    end

    LLM["LLM<br/>(Groq)"]
    UI["Next.js dashboard<br/>(real-time)"]

    CRON --> CA & PA & BA
    JB --> CA
    PS --> PA
    CA & PA & SD & AK & BA <--> LLM
    CA & PA & SD & AK & BA --> DB
    DB <--> UI
    UI -. on demand .-> SD & AK
~~~

Convex is the backbone. It provides the database, scheduled jobs, server functions, and **real-time sync**, so when an agent saves something, it appears on the dashboard instantly.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS, Lucide icons |
| Backend | Convex (database, cron jobs, actions, real-time queries) |
| AI | Groq API (`openai/gpt-oss-20b`) with rate-limit-aware retries and JSON validation |
| Data | Public job APIs, Hacker News (Algolia), Stack Exchange API, Apple App Store review feeds |
| Cost | **$0/month**: every service runs on a free tier |

## Design decisions worth noting

- **Agents, not prompts.** Each agent is a scheduled pipeline (fetch → filter → de-duplicate → analyze → validate → save → report status), not a chat interface.
- **Filter before the LLM.** Keyword filters, location checks, and de-duplication run first, so tokens are only spent on new, relevant items.
- **Prompts live in one file.** The agents' judgment rules are in `convex/prompts.ts`, so tuning behavior doesn't mean touching pipeline code.
- **Reliability built in.** Isolated sources (one failing never breaks a run), time budgets under the platform's limits, a watchdog for interrupted runs, and a lock so two copies of an agent never run at once.
- **Archive, never delete.** Old items are hidden but remembered, so agents never re-add them.
- **Pivot on evidence.** The business side went through three versions. Mining Hacker News hiring threads found companies hiring individuals, not outsourcing. Scanning OpenStreetMap for businesses without websites produced cold-outreach lists. Both worked technically but weren't the right goal, which was finding *problems worth building products for*. The data at each step drove the redesign.

## Project structure

~~~text
dashboard/
├── app/
│   ├── page.tsx                 # Dashboard: briefing, Opportunity Radar, jobs
│   ├── layout.tsx
│   └── ConvexClientProvider.tsx
└── convex/
    ├── schema.ts                # Database schema
    ├── crons.ts                 # Schedules
    ├── prompts.ts               # Judgment rules for the radar agents
    ├── llm.ts                   # Shared LLM client (retries, JSON parsing)
    ├── agentStatus.ts           # Agent status, run lock, watchdog
    │
    ├── painSources.ts           # Pain signal fetchers (HN, Stack Exchange, App Store)
    ├── painAgent.ts             # Pain extraction, grouping, scoring
    ├── solutionDesigner.ts      # Problem → product design (with viability gate)
    │
    ├── jobSources.ts            # Job fetchers (one per source)
    ├── careerAgent.ts           # Job discovery + LLM scoring
    ├── applicationKit.ts        # Tailored CV highlights, cover letter, email
    ├── resumes.example.ts       # CV template (real resumes.ts is git-ignored)
    ├── profile.ts               # Candidate profile used for job scoring
    │
    ├── briefingAgent.ts         # Daily briefing
    ├── cleanup.ts               # Nightly archiver
    └── dashboard.ts             # Dashboard data query
~~~

## Running it yourself

**Requirements:** Node.js 20+, a free [Groq API key](https://console.groq.com).

~~~bash
git clone https://github.com/aadilsal/AI-Command-Center.git
cd AI-Command-Center/dashboard
npm install

# Your CVs (git-ignored) — paste them in as plain text
cp convex/resumes.example.ts convex/resumes.ts

# Terminal 1: start the Convex backend (keep running)
npx convex dev

# Terminal 2: configure and try the agents
npx convex env set GROQ_API_KEY your-groq-key
npx convex run careerAgent:run
npx convex run painAgent:run
npx convex run briefingAgent:run

# Start the dashboard at http://localhost:3000
npm run dev
~~~

To make it your own, edit `convex/profile.ts` (your skills), `convex/resumes.ts` (your CVs), and `convex/prompts.ts` (who you are as a builder and what counts as an opportunity).

## Roadmap

- [x] Career Agent with multi-source discovery and LLM scoring
- [x] Tailored application kits with fact-checking guardrails
- [x] Daily briefing with prioritized actions
- [x] Opportunity Radar: pain discovery, grouping, scoring
- [x] Solution Designer with viability gate
- [ ] Marketing automations for products in "Building" / "Launched": find new posts describing the pain, draft content from users' own words
- [ ] Interview prep packs when a job moves to Interview
- [ ] Weekly review: applications, opportunity pipeline, what to change
- [ ] Authentication and cloud deployment

## Author

**Aadil Salman Butt**, full-stack engineer, Lahore 🇵🇰
Co-founder of [TechVersa](https://techversa.co) · [LinkedIn](https://www.linkedin.com/in/aadil-salman-butt/)
