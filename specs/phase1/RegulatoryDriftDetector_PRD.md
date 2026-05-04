# Product Requirements Document: Regulatory Drift Detector

**Version:** 1.0 (MVP)
**Status:** Draft for Engineering Spec
**Build Type:** Working MVP (real ingestion + LLM, dummy policy corpus)
**Target Demo Date:** TBD

---

## 1. Executive Summary

The Regulatory Drift Detector is an AI-powered monitoring tool that continuously ingests publications from US banking regulators (SEC, FINRA, CFPB, OCC), compares each new publication against a financial institution's internal policy library, and surfaces specific policy passages that are now misaligned, contradicted, or rendered ambiguous by the new guidance. Each finding includes a confidence score, a plain-language explanation of the drift, and a citation chain back to both the regulatory source and the affected policy section.

The MVP scope is **detect-and-alert only**. The agent does not draft redlines, route approvals, or take corrective action in this version. Those capabilities are explicitly deferred to v2.

This document is the source of truth for an engineering agent generating technical specifications. Where architectural choices are left open, that is intentional and noted.

---

## 2. Problem Statement

Compliance teams at US financial institutions monitor a continuous stream of regulatory output: rule proposals, final rules, enforcement actions, no-action letters, supervisory guidance, and bulletins. A mid-sized bank's compliance function may track 500 to 2,000 regulatory items per year across the four primary federal regulators alone. For each item, an analyst must determine:

1. Is this relevant to our institution?
2. If yes, which of our internal policies, procedures, or controls does it touch?
3. Is our existing language still accurate, or has it drifted out of compliance?

This work is currently manual, inconsistent across analysts, and slow enough that policies can sit out of date for months. The Chief Compliance Officer (CCO) has no reliable way to answer the board-level question: *"Are we currently aligned with every rule that applies to us?"*

The Regulatory Drift Detector answers that question continuously and produces an auditable evidence trail.

---

## 3. Target User

**Primary persona:** Chief Compliance Officer at a US bank or broker-dealer ($1B–$50B AUM/assets).

**Buying motivations:**
- Reduce regulatory risk exposure and avoid enforcement actions
- Demonstrate to the board, examiners, and auditors that the institution has a defensible, systematic process for tracking regulatory change
- Reduce manual analyst hours spent reading regulatory publications
- Shorten the lag between rule publication and internal policy update

**What the CCO needs to see in the demo:**
- The system reliably catches drift that a human reviewer would also catch
- Every alert is backed by specific, verifiable citations (no hallucinated rule references)
- The output is at a quality level they would trust to escalate to legal or business owners

---

## 4. Goals and Non-Goals

### 4.1 In-Scope for MVP

- Ingestion of regulatory publications from SEC, FINRA, CFPB, and OCC public sources
- Ingestion of a dummy internal policy library (10–25 documents covering common bank policy domains)
- Semantic matching between regulatory items and policy passages
- Drift classification: each potential match is labeled as *Aligned*, *Drifted*, *Contradicted*, *Ambiguous*, or *No Material Impact*
- Alert generation with citations, confidence score, and plain-language explanation
- A reviewer-facing UI to triage alerts (accept, dismiss, escalate, snooze)
- Audit log of every alert and reviewer action

### 4.2 Explicitly Out-of-Scope for MVP

- Automated redline generation or policy editing
- Workflow routing to policy owners, approvals, or task management
- Integration with GRC platforms (Archer, MetricStream, LogicGate, etc.)
- State-level regulators or non-US jurisdictions
- Insurance, asset management, or non-banking domains
- Real customer policy ingestion (dummy corpus only)
- User authentication beyond a single demo login
- Multi-tenancy

### 4.3 Success Criteria for the Demo

The demo is successful if a CCO viewer agrees with all three of the following after a live walkthrough:

1. The alerts shown are the kind of issues their team would want to catch.
2. The citations are specific enough that an analyst could verify the finding in under two minutes.
3. They would be willing to participate in a paid pilot using their own policy corpus.

---

## 5. User Stories

**US-1.** As a CCO, I want to see a dashboard of all open drift alerts ranked by severity so that I can understand my institution's current exposure at a glance.

**US-2.** As a CCO, I want to click into any alert and see (a) the regulatory source that triggered it, (b) the specific policy passage affected, and (c) a plain-language explanation of why this is a drift, so that I can quickly decide whether to escalate.

**US-3.** As a CCO, I want every alert to include direct citations to both the regulatory document and the internal policy section, so that I can trust the system isn't fabricating findings.

**US-4.** As a CCO, I want to filter alerts by regulator, policy domain, severity, and date so that I can focus on what matters to today's review.

**US-5.** As a CCO, I want to dismiss an alert with a reason code so that the system learns and an audit trail is preserved.

**US-6.** As a CCO, I want to see an ingestion log showing which regulatory publications have been processed and when, so that I can verify the system is current.

**US-7.** As a demo viewer, I want to trigger ingestion of a specific recent regulatory publication on demand so that the presenter can show drift detection happening in near-real-time.

---

## 6. Functional Requirements

### 6.1 Regulatory Source Ingestion

The system shall ingest publications from the following sources, all of which are publicly available:

| Regulator | Source Types | Suggested Access Method |
|---|---|---|
| SEC | Final rules, proposed rules, enforcement releases, staff bulletins | SEC.gov RSS feeds, EDGAR full-text search |
| FINRA | Regulatory notices, enforcement actions | FINRA.org notices archive |
| CFPB | Final rules, enforcement actions, advisory opinions, circulars | CFPB.gov newsroom and rules archive |
| OCC | Bulletins, interpretive letters, enforcement actions | OCC.gov news and issuances |

Ingestion frequency for the MVP: every 6 hours, plus on-demand trigger via UI button.

Each ingested item must be persisted with: source URL, regulator, publication date, document type, full text, and a stable internal ID.

### 6.2 Internal Policy Corpus

The MVP ships with a dummy corpus of 10 to 25 policy documents covering the following representative domains. The engineering team should generate or assemble these as plausible-but-fictional documents (clearly marked as synthetic):

- BSA/AML program
- Consumer complaint handling
- Fair lending
- Regulation E (electronic fund transfers) procedures
- Regulation Z (truth in lending) disclosures
- Vendor management
- Information security and incident response
- Customer identification program (CIP)
- Overdraft practices
- Marketing and advertising review

Each policy document must be chunked into addressable sections (heading + paragraph granularity) and embedded for semantic retrieval.

### 6.3 Drift Detection Pipeline

For each newly ingested regulatory item, the system shall:

1. **Classify relevance.** Determine whether the item is potentially relevant to any policy domain in the corpus. Items deemed non-relevant are logged but generate no alerts.
2. **Retrieve candidate passages.** For relevant items, retrieve the top N (suggested: 10–20) policy passages most likely to be affected, using semantic similarity over the embedded corpus.
3. **Classify each candidate.** For each candidate passage, an LLM evaluates the regulatory item against the passage and assigns one of:
   - **Aligned** — policy already reflects the regulatory position
   - **Drifted** — policy is partially out of step; minor update needed
   - **Contradicted** — policy directly conflicts with the new regulation
   - **Ambiguous** — regulatory item creates uncertainty about policy interpretation
   - **No Material Impact** — surface similarity but no real conflict
4. **Generate explanation.** For any classification other than *Aligned* or *No Material Impact*, the LLM produces a 2–4 sentence explanation of the drift, citing specific text from both sources.
5. **Score confidence.** Each alert carries a model-reported confidence score (0–1) and a derived severity (High/Medium/Low) based on classification type and confidence.

### 6.4 Citation Requirements

Every alert must include:

- A direct quote of the relevant regulatory text (or paragraph reference if quoting is impractical due to length)
- A direct quote of the affected policy passage
- A stable link to the regulatory source document
- A stable internal reference to the policy document and section

If the system cannot produce both citations for a finding, the finding is suppressed. **No uncited alerts are permitted.** This is non-negotiable for CCO trust.

### 6.5 Reviewer UI

The MVP includes a single-pane web UI with the following views:

**Dashboard view:**
- Count of open alerts by severity
- Count of alerts by regulator
- Count of alerts by policy domain
- Recent ingestion activity
- "Trigger ingestion" button (for demo)

**Alert list view:**
- Sortable table: severity, regulator, policy domain, date detected, status
- Filters: regulator, severity, status, policy domain, date range

**Alert detail view:**
- Side-by-side display of regulatory text and policy text
- Drift classification and confidence score
- Plain-language explanation
- Action buttons: Accept (queue for follow-up), Dismiss (with reason code), Escalate (with note), Snooze
- Full citation chain
- Audit history of all actions taken on this alert

**Ingestion log view:**
- Timestamped list of all ingestion runs, items processed, items flagged, items suppressed

### 6.6 Audit Log

Every state change shall be logged immutably with: timestamp, actor (user or system), action, before-state, after-state, and any reviewer-supplied note or reason code.

---

## 7. Non-Functional Requirements

### 7.1 Performance

- A single regulatory item should move from ingestion to alerts visible in the UI within 5 minutes
- The dashboard should load in under 2 seconds with up to 1,000 alerts in the system
- Alert detail view should load in under 1 second

### 7.2 Accuracy Targets (Demo Threshold)

These are stretch targets for the MVP, measured against a hand-labeled evaluation set the engineering team will construct:

- Precision on Drifted/Contradicted alerts: ≥ 80%
- Recall on Drifted/Contradicted alerts: ≥ 70%
- Hallucinated citations (citation does not appear in source): 0% tolerance — any instance is a P0 bug

### 7.3 Reliability

- The ingestion pipeline must handle source-side failures (404s, timeouts, schema changes) gracefully and log them rather than crash
- A failed ingestion run must not block subsequent runs

### 7.4 Security and Privacy

The MVP uses only public regulatory data and synthetic policies. No PII or customer data is in scope. However, the architecture should not preclude future deployment in a customer environment where policy documents are confidential. Engineering should document which components would need hardening for a pilot deployment.

### 7.5 Observability

- All LLM calls must be logged with prompt, response, model version, and token count
- Ingestion runs must emit metrics on items processed, items flagged, errors
- The system should expose a basic health-check endpoint

---

## 8. Technical Architecture (Guidance, Not Prescription)

The following is suggested architecture. The engineering agent should validate, refine, or replace based on team expertise.

**Ingestion layer:** Scheduled jobs polling regulator RSS feeds and HTML/PDF endpoints. PDF parsing for SEC and OCC documents.

**Storage layer:**
- Document store for raw regulatory items and policy documents
- Vector store for embedded policy chunks and regulatory chunks
- Relational store for alerts, audit log, and user actions

**AI layer:**
- An embedding model for semantic retrieval
- A reasoning LLM for classification and explanation generation
- Structured output enforcement (JSON schema) on all LLM classification calls

**Application layer:**
- Backend API serving the UI
- Frontend single-page application

**Critical engineering note:** The classification LLM call must be constrained to produce structured output and must include a verification step that confirms any quoted text actually appears in the source document. This is the primary defense against hallucinated citations.

---

## 9. Demo Script Considerations

The demo should be designed to showcase **detection accuracy and citation quality**, which is the priority capability per the product owner. A suggested 10-minute demo arc:

1. **Open with the dashboard** showing a populated set of alerts across regulators and severities (60s)
2. **Drill into a high-severity alert** — show the regulatory source, the affected policy passage, the explanation, the citations (90s)
3. **Trigger live ingestion** of a recent real regulatory publication and watch alerts appear (120s)
4. **Walk through a borderline case** classified as *Ambiguous* — show that the system flags uncertainty rather than over-claiming (90s)
5. **Show an alert that was dismissed** with reason code, demonstrate audit trail (60s)
6. **Discuss what's next** — redlining, routing, GRC integration as v2 capabilities (remaining time)

The engineering team should pre-seed the system with a curated set of alerts that includes at least one example of each classification type, drawn from real regulatory publications matched against the dummy policy corpus.

---

## 10. Open Questions for Engineering

These are items the engineering spec should resolve:

1. Which specific embedding model and reasoning LLM should be used? Trade-offs to consider: cost per ingestion run, latency, citation fidelity, structured output reliability.
2. How should the system handle very long regulatory documents (e.g., 300-page final rules)? Chunking strategy, summarization, or section-targeted analysis?
3. What is the eval harness? The product requires accuracy measurement, so a labeled evaluation set must be constructed as part of the build, not after.
4. Should the dummy policy corpus be hand-written, generated by an LLM, or assembled from publicly available bank policy templates with light modification?
5. What does the deployment target look like for the demo — local, a cloud sandbox, or a permanent demo environment we can leave running for prospect access?

---

## 11. Out-of-Scope Items to Capture for Roadmap

These came up during scoping and should be tracked for future versions but are not built in MVP:

- Redline generation (v2)
- Workflow routing and approval chains (v2)
- Integration with major GRC platforms (v2 or v3)
- State-level regulator coverage (v2)
- Expansion to insurance and asset management (v3)
- Multi-tenancy and customer data isolation (required for first paid pilot)
- Customer-specific policy ingestion connectors (required for first paid pilot)
- Fine-tuning or evaluation against customer-specific drift definitions (v3+)

---

## 12. Approvals

| Role | Name | Date |
|---|---|---|
| Product Owner | | |
| Engineering Lead | | |
| Demo Sponsor | | |
