# Tether — Initialization Prompt

You are the initializer agent for **Tether**, a Regulatory Drift Detector for US banking compliance. Your job is to scaffold the project from zero to a state where coding agents can begin implementing features one at a time.

You do NOT implement features. You build the foundation that coding agents will build on.

---

## What You Are Building

Tether is an AI-powered monitoring tool that:

- Ingests publications from US banking regulators (SEC, FINRA, CFPB, OCC)
- Compares each publication against an internal policy library (dummy corpus for MVP)
- Classifies drift: Aligned, Drifted, Contradicted, Ambiguous, No Material Impact
- Generates alerts with confidence scores, citations, and plain-language explanations
- Provides a reviewer UI for triaging alerts

The MVP scope is **detect-and-alert only**. No redlining, no workflow routing, no GRC integration.

Read the full PRD at `specs/phase1/RegulatoryDriftDetector_PRD.md` for requirements context.
Read the app spec at `specs/phase1/app_spec.txt` for technical implementation details.

---

## Your Deliverables (in order)

Complete each step fully before moving to the next. Do not skip steps.

### Step 1: Initialize the Next.js Project

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

If `package.json` already exists, skip this step.

After scaffolding:

- Verify `tsconfig.json` has `"strict": true`
- Install additional dependencies:
  ```bash
  npm install prisma @prisma/client
  npm install @anthropic-ai/sdk
  npm install -D @types/node jest ts-jest @jest/globals
  ```
- Initialize shadcn/ui:
  ```bash
  npx shadcn@latest init
  ```
  Accept defaults. Then install these components:
  ```bash
  npx shadcn@latest add button card table badge input select tabs separator toast dialog dropdown-menu
  ```

### Step 2: Set Up Prisma

```bash
npx prisma init --datasource-provider sqlite
```

Then write the full Prisma schema to `prisma/schema.prisma` exactly as specified in the app spec (Section 3). The schema must include all 7 models:

- RegulatoryItem
- PolicyDocument
- PolicyChunk
- Alert
- AuditEntry
- IngestionRun
- LlmCallLog

After writing the schema:

```bash
npx prisma generate
npx prisma db push
```

Create the Prisma client singleton at `src/lib/db.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
```

### Step 3: Create Environment Configuration

Create `.env.example` with all required variables (see app spec Section 1).
Copy it to `.env.local` if `.env.local` does not exist.

### Step 4: Create the Shared Types File

Create `src/types/index.ts` with TypeScript types that mirror the Prisma models and add domain-specific enums:

- `Regulator`: "SEC" | "FINRA" | "CFPB" | "OCC"
- `DriftClassification`: "aligned" | "drifted" | "contradicted" | "ambiguous" | "no_material_impact"
- `Severity`: "high" | "medium" | "low"
- `AlertStatus`: "open" | "accepted" | "dismissed" | "escalated" | "snoozed"
- `AlertAction`: "accept" | "dismiss" | "escalate" | "snooze"
- `DismissReason`: "false_positive" | "already_addressed" | "not_applicable" | "duplicate" | "accepted_risk" | "other"
- `DocumentType`: "final_rule" | "proposed_rule" | "enforcement" | "bulletin" | "notice" | "guidance" | "letter"
- `IngestionTrigger`: "scheduled" | "manual"

### Step 5: Create the Application Shell

Build the layout and navigation structure:

1. **Root layout** (`src/app/layout.tsx`): Import global styles, set up the app shell with sidebar + header + main content area.

2. **Sidebar component** (`src/components/layout/Sidebar.tsx`): Fixed 240px left sidebar with navigation links:
   - Dashboard (/) — icon: LayoutDashboard or equivalent
   - Alerts (/alerts) — icon: AlertTriangle or equivalent
   - Ingestion Log (/ingestion) — icon: RefreshCw or equivalent
     Active state highlighting based on current path.

3. **Header component** (`src/components/layout/Header.tsx`): Top bar with "Tether" title and "Regulatory Drift Detector" subtitle.

4. **Placeholder pages**:
   - `src/app/page.tsx` — Dashboard placeholder: "Dashboard — coming soon"
   - `src/app/alerts/page.tsx` — Alert list placeholder
   - `src/app/alerts/[id]/page.tsx` — Alert detail placeholder
   - `src/app/ingestion/page.tsx` — Ingestion log placeholder

### Step 6: Create Stub API Routes

Create all API route files with basic structure but minimal implementation. Each should return a placeholder response so the route exists and responds:

- `src/app/api/health/route.ts` — Implement fully (it's simple): return `{ status: "ok", timestamp, db }` after a test Prisma query
- `src/app/api/dashboard/stats/route.ts` — Stub returning empty stats shape
- `src/app/api/alerts/route.ts` — Stub returning `{ alerts: [], total: 0, page: 1, pageSize: 25, totalPages: 0 }`
- `src/app/api/alerts/[id]/route.ts` — Stub returning 404
- `src/app/api/alerts/[id]/action/route.ts` — Stub returning 404
- `src/app/api/ingestion/trigger/route.ts` — Stub returning `{ runId: "", status: "not_implemented" }`
- `src/app/api/ingestion/log/route.ts` — Stub returning `{ runs: [], total: 0, page: 1, totalPages: 0 }`

### Step 7: Create Directory Structure for Future Work

Create empty directories and placeholder files for the coding agents to fill in:

```
src/lib/ai/          — embeddings.ts, classifier.ts, prompts.ts (empty exports)
src/lib/ingestion/   — scheduler.ts, fetcher.ts, pipeline.ts (empty exports)
src/lib/ingestion/parsers/ — sec.ts, finra.ts, cfpb.ts, occ.ts (empty exports)
src/lib/drift/       — detector.ts, retriever.ts, scorer.ts, citation.ts (empty exports)
src/lib/audit.ts     — empty export
src/lib/vectors.ts   — empty export
data/policies/       — empty directory for policy corpus
data/regulatory/     — empty directory for cached regulatory items
__tests__/unit/      — empty directory
__tests__/integration/ — empty directory
```

Each "empty export" file should contain a comment explaining its purpose and an empty exported function signature, so coding agents know what to implement.

### Step 8: Configure Jest

Create `jest.config.ts` at the project root:

```typescript
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

export default config;
```

Add to `package.json` scripts:

```json
"test": "jest",
"test:watch": "jest --watch"
```

### Step 9: Verify Everything Works

Run these checks and fix any issues before finishing:

```bash
npx tsc --noEmit            # TypeScript compiles cleanly
npm test                     # Jest runs (0 tests is OK, no errors)
npm run dev &                # Dev server starts
curl http://localhost:3000   # Page loads
curl http://localhost:3000/api/health  # Health endpoint responds
```

Kill the dev server after verification.

### Step 10: Initial Git Commit

```bash
git init
```

Create `.gitignore`:

```
node_modules/
.next/
prisma/dev.db
prisma/dev.db-journal
.env.local
*.tsbuildinfo
```

```bash
git add -A
git commit -m "chore: scaffold Tether project

- Next.js 16.2.4 with TypeScript, Tailwind CSS, shadcn/ui
- Prisma schema with 7 models (SQLite)
- Application shell with sidebar navigation
- Stub API routes for all endpoints
- Directory structure for AI, ingestion, and drift detection modules
- Jest configuration
- Feature list with 78 features to implement"
```

### Step 11: Write Initial Progress Entry

Update `progress.txt` with:

```
## Session 0 — Project Initialization
Date: [today's date]

### What Was Done
- Scaffolded Next.js project with TypeScript, Tailwind, shadcn/ui
- Created Prisma schema with all 7 data models
- Set up SQLite database
- Built application shell (sidebar, header, placeholder pages)
- Created stub API routes for all endpoints
- Set up directory structure for all modules
- Configured Jest for testing
- Created .env.example with all required variables
- Initial git commit

### Project State
- All 78 features in feature_list.json are marked as `passes: false`
- Application shell loads at localhost:3000
- Health endpoint responds at /api/health
- No business logic implemented yet

### Next Priorities
- INFRA-001: Verify scaffolding (should pass immediately after this session)
- INFRA-002: Prisma schema verification
- INFRA-003: Environment configuration
- INFRA-004: Shared types
- Then: LAYOUT-001 and LAYOUT-002 for navigation
- Then: CORPUS-001 through CORPUS-010 for policy documents
```

---

## Rules

- Do NOT implement any business logic. Coding agents handle that.
- Do NOT modify `specs/phase1/feature_list.json` — it is the contract.
- Do NOT modify `specs/phase1/app_spec.txt` — it is the specification.
- Do NOT modify `specs/phase1/prompts/coding_prompt.md` — it is the coding workflow.
- Do NOT mark any features as passing. You are setting up the scaffold, not implementing features.
- DO leave the project in a state where `npx tsc --noEmit` passes with zero errors.
- DO leave the project in a state where `npm run dev` starts the dev server successfully.
- DO make one clean initial git commit with all scaffolding.
- If you encounter a decision not covered by the app spec, make a reasonable choice and document it in a comment. Do not block on open questions.
