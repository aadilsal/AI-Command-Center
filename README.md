# AI Command Center

**A personal AI operating system: autonomous agents that find career opportunities, discover business problems worth building products for, find agencies to partner with, coach me on my weak spots, scout rising tech — and tell me exactly what to do each morning.**

This is not a dashboard with a chatbot bolted on. The dashboard is just the control panel. The real product is a team of AI workers running behind it on a schedule — collecting data from the web, analyzing it with an LLM, validating the output in code, and turning it into prioritized actions.

---

## The problem

I work full time as a software engineer, run a software studio ([TechVersa](https://techversa.co)) on the side, and look for better engineering roles. Doing all of that well meant hours every week of:

- checking job boards, judging fit, and tailoring applications
- guessing which products to build, without real evidence of demand
- finding businesses to work with and writing outreach from scratch
- knowing which skills to work on and which technologies are worth learning next
- deciding what actually matters today

Most of that is repetitive. So I built agents to do it.

## The agents

| When (PKT) | Agent | What it does |
|---|---|---|
| 08:00 & 20:00 | **Career Agent** | Pulls remote jobs from 5 free-to-apply sources, skips anything seen before, and has an LLM score each one against my profile |
| Every 6 hours | **Pain Agent** | Collects posts where people describe business problems, extracts the unmet need, groups similar complaints into problems, and scores each opportunity |
| 10:00 | **Prospect Agent** | Finds small US/UK agencies, reads their public websites, judges fit, and drafts a personalized email pitching TechVersa as a white-label dev & AI partner |
| 09:00 | **Briefing Agent** | Reads everything the other agents found and writes a headline plus the 3–5 most important actions for today |
| Sundays 09:30 | **Coach Agent** | Analyzes my real activity (skill gaps across job matches, application funnel, what I let slip) and reports my weak spots with concrete fixes |
| Mondays 09:45 | **Trend Scout** | Measures what's *rising* in tech month over month and suggests project ideas that ride those trends |
| 07:30 | **Cleanup** | Archives stale items so every list stays focused |
| Every 30 min | **Watchdog** | Resets any agent whose run was interrupted |

Then I open one page and know: which jobs to apply to (with tailored applications ready), which problems are worth building for, which agencies to email today, where I'm weak, what's rising — and whether any agent needs attention.

## Features

### Career
- Job discovery from free-to-apply sources (Remotive, Arbeitnow, Jobicy, Himalayas, Hacker News "Who is hiring") with cross-board de-duplication
- LLM scoring against my profile, including location eligibility (a "remote" role that excludes Pakistan is marked Skip)
- **Application kits:** one click produces a tailored summary, rewritten highlights, skills to list first, a cover letter and an application email — built only from facts in my CV
- One-click **Apply** (opens the posting and marks it Applied) and a full application tracker

### Opportunity Radar (product discovery)
- Listens for pain people describe in their own words: Hacker News, Stack Exchange Software Recommendations, and 1–3★ App Store reviews of popular small-business tools
- Filters out noise (vendor bugs, refund disputes, developer tooling, consumer complaints) — only *unmet needs* a new product could solve count; obvious vendor complaints are filtered by rules before any LLM call
- Groups similar complaints from different people and sources into one problem, then scores it (frequency, intensity, willingness to pay, buildability, spread, recency)
- **Solution Designer:** product concept, MVP features, stack, build effort, pricing tied to evidence, where to find users, content angles, validation steps, risks — with a **viability gate** that parks problems only the original vendor could fix

### Prospect Engine (TechVersa outreach)
- Finds agencies through GitHub's official search API (agency organizations by city), OpenStreetMap, and agencies hiring on Hacker News
- Reads each agency's own homepage and contact page; judges whether it's a small, client-serving agency TechVersa can help
- Drafts a short, personalized email that opens with a true detail from their site — using only emails published on their site
- **Open in Gmail** with everything pre-filled; I review and press send myself. Follow-up drafts appear when due, and the pipeline tracks Contacted → Replied → Meeting → Won
- Built for compliant outreach: a human sends every email, every email has an opt-out line and a postal address, low daily volume

### Coach & Trend Scout
- **Coach:** weekly weak-spot report from my own data — grouped skill gaps with counts, funnel problems ("Apply-rated jobs you let expire"), and one small action per weak spot; week-over-week comparison
- **Trend Scout:** momentum is *measured in code* (Hacker News term counts this month vs last, most-starred new GitHub repos, top Show HN launches); the LLM only interprets those numbers into trends and project ideas tagged portfolio / product / service

### Daily briefing
- An LLM "chief of staff" ranks the day: job applications, follow-ups, opportunities to design or validate, broken agents
- Every action must link to a real record, so it can't invent anything, and it falls back to a rule-based briefing if the LLM fails

### Dashboard and detail pages
- Every agent has a dashboard card **and** its own detail page (`/career`, `/radar`, `/prospects`, `/coach`, `/trends`, `/agents`) with search, filters, sorting and pagination done on the server
- **AI Workers page:** each agent's schedule, next run, last run duration, 30-day health (success rate, notes, errors, interruptions), and a full run history

## Guardrails

LLM output is never trusted blindly. It's checked in code — and regenerated with feedback when it breaks a rule:

- **No invented facts:** numbers in application kits must appear in my CV or the job post; numbers in coaching and trend reports must appear in the measured data; skills not in my CV are dropped; market statistics are rejected
- **Honest tone:** inflated self-descriptions ("expert", "proven track record") and embellishments are rejected
- **Real evidence only:** radar quotes must exist word-for-word in the original post; prospect emails may only state facts from the agency's own website, and only use emails published there
- **Outreach rules in code:** no pricing talk, no generic closers, no buzzwords, company voice ("we")
- **Untrusted input:** job posts, user posts and websites are treated as data, never instructions; anti-bot traps hidden in job descriptions are stripped before they can reach an application

## Reliability

- **Isolated sources:** one failing source never breaks a run
- **Time budgets** keep every run under the platform's limits; a **watchdog** recovers interrupted runs; a **run lock** stops two copies of an agent overlapping
- **Errors vs notes:** real failures show in red; temporary issues (a slow source, a rate limit) show as a quiet grey note that expires on its own
- **Rate- and quota-aware LLM client:** retries short rate limits, stops cleanly on daily quota instead of stalling, and retries empty or malformed replies
- **Fast at any size:** running counters instead of table scans; detail pages paginate on the server; large tables use cursor pagination
- **Archive, never delete:** old items are hidden but remembered, so agents never re-add them

## Architecture

~~~mermaid
flowchart LR
    subgraph Sources["Free public sources"]
        JB["Job sources<br/>Remotive · Arbeitnow · Jobicy<br/>Himalayas · HN Who is hiring"]
        PS["Pain sources<br/>HN · Stack Exchange<br/>App Store reviews"]
        AG["Agency sources<br/>GitHub · OpenStreetMap<br/>agency websites"]
        TS["Trend sources<br/>HN · GitHub · Show HN"]
    end

    subgraph Convex["Convex backend"]
        CRON["Cron scheduler<br/>+ watchdog"]
        CA["Career Agent"]
        PA["Pain Agent"]
        PR["Prospect Agent"]
        CO["Coach Agent"]
        TR["Trend Scout"]
        BA["Briefing Agent"]
        DB[("Database")]
    end

    LLM["LLM (Groq)"]
    UI["Next.js dashboard<br/>+ detail pages (real-time)"]
    GM["Gmail compose<br/>(human sends)"]

    CRON --> CA & PA & PR & CO & TR & BA
    JB --> CA
    PS --> PA
    AG --> PR
    TS --> TR
    CA & PA & PR & CO & TR & BA <--> LLM
    CA & PA & PR & CO & TR & BA --> DB
    DB <--> UI
    UI -. one click .-> GM
~~~

Convex is the backbone: database, scheduled jobs, server functions and **real-time sync** — when an agent saves something, it appears on the dashboard instantly.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS, Lucide icons |
| Backend | Convex (database, cron jobs, actions, real-time queries) |
| AI | Groq API (`openai/gpt-oss-20b`) with rate- and quota-aware retries and JSON validation |
| Data | Public job APIs, Hacker News (Algolia), Stack Exchange API, Apple App Store review feeds, GitHub API, OpenStreetMap Nominatim |
| Cost | **$0/month** — every service runs on a free tier |

## Design decisions worth noting

- **Agents, not prompts.** Each agent is a scheduled pipeline (fetch → filter → de-duplicate → analyze → validate → save → report), not a chat interface.
- **Measure in code, interpret with the LLM.** Counts, momentum, de-duplication and pre-filtering happen in code; the LLM only judges and writes — which keeps it honest and cheap.
- **Prompts live in one file.** Agents' judgment rules are in `convex/prompts.ts`, so tuning behavior never means touching pipeline code.
- **Humans stay in the loop where it matters.** The system drafts outreach; a person sends it.
- **Pivot on evidence.** The business side went through several versions — mining hiring threads, then cold lists of businesses without websites — before landing on two clearer goals: find *problems worth building products for*, and find *agencies to partner with*. Real data at each step drove the redesign.

## Project structure

~~~text
dashboard/
├── app/
│   ├── page.tsx                 # Dashboard: briefing, agent cards, radar, jobs
│   ├── ui.tsx                   # Shared UI (pagination, panels, copy buttons)
│   ├── CoachCard.tsx · TrendCard.tsx · ProspectCard.tsx
│   ├── career/  radar/  prospects/  coach/  trends/  agents/   # Detail pages
│   └── ConvexClientProvider.tsx
└── convex/
    ├── schema.ts · crons.ts · prompts.ts · llm.ts
    ├── agentStatus.ts           # Status, run lock, run history, watchdog
    ├── counters.ts              # Running totals (no table scans)
    ├── views.ts                 # Server-side filtered/paginated queries
    │
    ├── careerAgent.ts · jobSources.ts · applicationKit.ts · jobCrm.ts
    ├── resumes.example.ts       # CV template (real resumes.ts is git-ignored)
    ├── painAgent.ts · painSources.ts · solutionDesigner.ts
    ├── prospectAgent.ts · prospectSources.ts · prospectCrm.ts · osm.ts
    ├── coachAgent.ts · trendAgent.ts · trendSources.ts
    ├── briefingAgent.ts · cleanup.ts · dashboard.ts
    └── profile.ts               # Candidate profile used for job scoring
~~~

## Running it yourself

**Requirements:** Node.js 20+, a free [Groq API key](https://console.groq.com). Optional: a GitHub token (no permissions needed) for higher API limits.

~~~bash
git clone https://github.com/aadilsal/AI-Command-Center.git
cd AI-Command-Center/dashboard
npm install

# Your CVs (git-ignored) — paste them in as plain text
cp convex/resumes.example.ts convex/resumes.ts

# Terminal 1: Convex backend (keep running)
npx convex dev

# Terminal 2: configure and try the agents
npx convex env set GROQ_API_KEY your-groq-key
npx convex env set GITHUB_TOKEN your-github-token   # optional
npx convex run careerAgent:run
npx convex run painAgent:run
npx convex run prospectAgent:run
npx convex run briefingAgent:run

# Dashboard at http://localhost:3000 (use "npm run build && npm start" for daily use)
npm run dev
~~~

Make it yours: edit `convex/profile.ts` (your skills), `convex/resumes.ts` (your CVs) and `convex/prompts.ts` (who you are as a builder, your outreach offer, and your postal address for outreach emails).

## Roadmap

- [x] Career Agent with multi-source discovery, twice-daily runs and LLM scoring
- [x] Tailored application kits with fact-checking guardrails
- [x] Opportunity Radar and Solution Designer with viability gate
- [x] Prospect Engine with site research, personalized drafts and follow-ups
- [x] Coach Agent and Trend Scout
- [x] Detail pages and AI Workers health / run history
- [ ] Reply detection from Gmail (n8n) to update the outreach pipeline automatically
- [ ] Interview prep packs when a job moves to Interview
- [ ] Weekly review across careers, radar and outreach
- [ ] Authentication and cloud deployment

## Author

**Aadil Salman Butt** — full-stack engineer, Lahore 🇵🇰
Co-founder of [TechVersa](https://techversa.co) · [LinkedIn](https://www.linkedin.com/in/aadil-salman-butt/)
