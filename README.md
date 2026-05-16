# Tether - Regulatory Drift Detector

An AI-powered monitoring tool that continuously ingests publications from US banking regulators (SEC, FINRA, CFPB, OCC), compares each new publication against a financial institution's internal policy library, and surfaces specific policy passages that are now misaligned, contradicted, or rendered ambiguous by the new guidance.

Built as a working MVP to demonstrate how AI can help Chief Compliance Officers answer a critical question: _"Are we currently aligned with every rule that applies to us?"_

## How It Was Built

The idea for Tether was generated from Google Cloud's [1,302 Real-World Gen AI Use Cases from the World's Leading Organizations](https://cloud.google.com/transform/101-real-world-generative-ai-use-cases-from-industry-leaders), which catalogs how enterprises are using generative AI across industries. Several use cases around automated compliance reviews, regulatory risk identification, and audit trail generation inspired the concept for a regulatory drift detector.

From there, the entire application was built from start to finish, autonomously, using the **Ralph Loop** — a structured methodology for building software with AI agents. The Ralph Loop was used to generate the PRD, technical specs, and implementation prompts that AI coding agents then executed to produce the working app.

- [create-ralph-loop](https://github.com/weststack-io/create-ralph-loop) — The framework used to generate the PRD, specs, and implementation prompts for this project
- [YouTube: Building an App from Start to Finish with AI](https://youtu.be/InIwg8_B-2U?si=1BmTtPx4igjncMcJ) — Watch the full walkthrough of building Tether using the Ralph Loop

## Features

- **Regulatory Ingestion** — Scheduled and on-demand ingestion from SEC, FINRA, CFPB, and OCC public sources
- **Drift Detection Pipeline** — Semantic matching between regulatory items and policy passages using embeddings and LLM classification
- **Alert Classification** — Each finding categorized as Aligned, Drifted, Contradicted, Ambiguous, or No Material Impact
- **Citation-Backed Alerts** — Every alert includes direct quotes and references to both the regulatory source and affected policy section (no uncited alerts permitted)
- **Confidence Scoring** — Model-reported confidence scores with derived severity levels (High/Medium/Low)
- **Reviewer UI** — Dashboard, alert list, alert detail with side-by-side comparison, and ingestion log
- **Audit Trail** — Immutable log of every state change with timestamp, actor, action, and notes

## Tech Stack

- **Framework:** Next.js 16 with App Router
- **Language:** TypeScript
- **Database:** LibSQL with Prisma ORM
- **AI:** Anthropic Claude (classification and explanation generation)
- **UI:** Tailwind CSS, shadcn/ui, Lucide icons
- **Testing:** Jest

## Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, pnpm, or bun

### Installation

```bash
git clone https://github.com/weststack-io/tether.git
cd tether
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
ANTHROPIC_API_KEY=your_api_key_here
DATABASE_URL=file:./dev.db
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
npm run build
npm start
```

### Testing

```bash
npm test
npm run test:watch
```

## Project Structure

```
specs/phase1/          # PRD and prompt specs used to build the app
src/app/               # Next.js App Router pages and API routes
src/components/        # React UI components
src/lib/               # Core business logic (ingestion, detection, database)
prisma/                # Database schema and migrations
```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

Please ensure your code passes linting and tests before submitting.

## Roadmap

Phase 1 (MVP) is complete. Future phases include:

- **v2:** Redline generation, workflow routing, state-level regulators
- **v3:** GRC platform integration, multi-tenancy, customer policy ingestion

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
