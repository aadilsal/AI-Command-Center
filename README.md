# AI Command Center

**A personal AI operating system: a team of autonomous agents that find career opportunities, generate business leads, and tell me exactly what to do each morning.**

This is not a dashboard with a chatbot bolted on. The dashboard is just the control panel. The real product is the set of AI workers running behind it on a schedule, collecting data from the web, analyzing it with an LLM, and turning it into prioritized actions.

---

## The problem

I work full time as a software engineer, run a services studio ([TechVersa](https://techversa.co)) on the side, and look for better engineering roles. Doing all three well meant hours every week of:

- checking job boards, reading descriptions, and judging fit
- researching businesses that might need our services
- tracking who I applied to, who I contacted, and who needs a follow-up
- deciding what actually matters today

Most of that is repetitive. So I built agents to do it.

## What it does

Every morning, without me touching anything:

| Time (PKT) | Agent | What it does |
|---|---|---|
| 07:30 | **Cleanup** | Archives stale jobs and untouched leads so the dashboard stays focused |
| 08:00 | **Career Agent** | Pulls remote jobs from 5 free-to-apply sources, filters for relevant roles, skips anything already seen, and has an LLM score each one against my profile (match %, reasons, missing skills, Apply / Maybe / Skip) |
| 08:30 | **Lead Agent** | Scans target cities for small businesses (clinics, dentists, salons, agencies…) that are reachable by phone but have no website or online booking, and turns each into a qualified lead with the business pain and the solution we'd offer |
| 09:00 | **Briefing Agent** | Reads everything the other agents found and writes a short briefing: a headline and the 3–5 most important actions for today, ranked (follow-ups before new opportunities) |

Then I open one page and know:

1. What career opportunities exist
2. What business opportunities exist
3. What I should do today
4. What my agents are doing, and whether any of them are failing

## Features

**Career**
- Multi-source job discovery from free-to-apply sources (Remotive, Arbeitnow, Jobicy, Himalayas, Hacker News "Who is hiring") with cross-board de-duplication
- LLM job scoring against my profile, including location eligibility (a "remote" role that is US-only is marked Skip)
- One-click **Apply**: opens the posting and marks it Applied, so it never shows up again
- Application tracker: Saved → Applied → Interview → Offer / Rejected

**Business development (TechVersa)**
- Automated lead discovery from OpenStreetMap data, configurable by city and business type from a database table, no code changes needed
- Fit scoring based on business value and how reachable they are (phone, email, social presence)
- Outcome-focused pitches: missed calls, after-hours bookings, no-shows, solved with AI voice receptionists, WhatsApp automation, and booking systems
- **AI outreach drafts**: a personalized WhatsApp message and email for each lead
- Lead pipeline: New → Contacted → Replied → Won / Lost, and tapping a lead's phone or email marks it Contacted automatically

**The daily briefing**
- An LLM "chief of staff" that ranks the day's actions and explains why each matters
- Follow-up detection: leads contacted 3+ days ago with no reply come back as priorities
- Guardrails: every action must point to a real item in the database, so it cannot invent companies or links, and it falls back to a rule-based briefing if the LLM fails

**Reliability**
- Live agent monitor showing status, last run, and errors on the dashboard
- Each data source is isolated: if one job board is down, the others still run
- Rate-limit aware LLM calls with automatic retry and pacing
- Archive, never delete: old items are hidden but remembered, so agents never re-add them

## Architecture

~~~mermaid
flowchart LR
    subgraph Sources["External sources (free)"]
        JB["Job boards<br/>Remotive · Arbeitnow · Jobicy<br/>Himalayas · HN Who is hiring"]
        OSM["OpenStreetMap<br/>(Nominatim)"]
    end

    subgraph Convex["Convex backend"]
        CRON["Cron scheduler"]
        CA["Career Agent"]
        LA["Lead Agent"]
        BA["Briefing Agent"]
        CL["Cleanup"]
        DB[("Database<br/>jobs · leads · briefings<br/>agents · leadTargets")]
    end

    LLM["LLM<br/>(Groq)"]
    UI["Next.js dashboard<br/>(real-time)"]

    CRON --> CL & CA & LA & BA
    JB --> CA
    OSM --> LA
    CA <--> LLM
    BA <--> LLM
    CA & LA & BA & CL --> DB
    DB <--> UI
~~~

Convex is the backbone. It provides the database, scheduled jobs, server functions, and **real-time sync**, so when an agent saves a job, it appears on the dashboard instantly without a refresh.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS, Lucide icons |
| Backend | Convex (database, cron jobs, actions, real-time queries) |
| AI | Groq API (`openai/gpt-oss-20b`) for scoring, briefings, and outreach drafts |
| Data | Job board public APIs, OpenStreetMap Nominatim |
| Cost | **$0/month**: every service runs on a free tier |

## Design decisions worth noting

- **Agents, not prompts.** Each agent is a scheduled pipeline (fetch → filter → de-duplicate → analyze → save → report status), not a chat interface.
- **The LLM only where it adds judgment.** Finding businesses and checking for a website is deterministic code. The LLM is used for things that need reasoning: job fit, prioritization, and writing.
- **Filter before the LLM.** Keyword filters and de-duplication run before any LLM call, so tokens are only spent on new, relevant items.
- **Guardrails over trust.** LLM outputs are validated: scores are clamped, enums are checked, and briefing links must match real records.
- **Pivot on evidence.** The lead agent originally mined Hacker News hiring threads. The data showed those were companies hiring individuals, not outsourcing projects, so it was rebuilt around small businesses with a visible operational gap.

## Project structure

~~~text
dashboard/
├── app/
│   ├── page.tsx                 # Dashboard: briefing, agents, jobs, leads pipeline
│   ├── layout.tsx
│   └── ConvexClientProvider.tsx
└── convex/
    ├── schema.ts                # Database schema
    ├── crons.ts                 # Daily schedule
    ├── careerAgent.ts           # Job discovery + LLM scoring
    ├── jobSources.ts            # Job board fetchers (one per board)
    ├── leadAgent.ts             # Business lead discovery
    ├── osm.ts                   # OpenStreetMap search + business categories & pitches
    ├── leadTargets.ts           # Cities × business types to scan
    ├── briefingAgent.ts         # Daily briefing writer
    ├── outreach.ts              # AI outreach message drafts
    ├── cleanup.ts               # Nightly archiver
    ├── llm.ts                   # Shared LLM client (retries, JSON parsing)
    ├── profile.ts               # Candidate profile used for job scoring
    ├── techversaProfile.ts      # Company profile used for lead qualification
    └── dashboard.ts             # Dashboard data query
~~~

## Running it yourself

**Requirements:** Node.js 20+, a free [Groq API key](https://console.groq.com).

~~~bash
git clone https://github.com/aadilsal/AI-Command-Center.git
cd AI-Command-Center/dashboard
npm install

# Terminal 1: start the Convex backend (keep running)
npx convex dev

# Terminal 2: configure and seed
npx convex env set GROQ_API_KEY your-groq-key
npx convex run seed:seed
npx convex run leadTargets:seedTargets

# Try the agents
npx convex run careerAgent:run
npx convex run leadAgent:run
npx convex run briefingAgent:run

# Start the dashboard at http://localhost:3000
npm run dev
~~~

To make it your own, edit `convex/profile.ts` (your skills and preferences) and `convex/techversaProfile.ts` (your services and ideal client). To change lead targets, edit rows in the `leadTargets` table from the Convex dashboard.

## Roadmap

- [x] Career Agent with multi-board discovery and LLM scoring
- [x] Lead Agent with configurable city and business-type targets
- [x] Daily briefing with prioritized actions
- [x] AI outreach drafts for leads
- [x] Tailored CV, cover letter, and application email per job
- [ ] Proposal generator for leads that reply
- [ ] Weekly review: applications, reply rates, what to change
- [ ] Authentication and cloud deployment

## Author

**Aadil Salman Butt**, full-stack engineer, Lahore 🇵🇰
Co-founder of [TechVersa](https://techversa.co) · [LinkedIn](https://www.linkedin.com/in/aadil-salman-butt/)
