# Ontario Teacher Assessment & Real-Time Participation Platform

A desktop-first, local-first web application designed for Ontario secondary teachers using the Ministry Achievement Chart categories:
- **Knowledge and Understanding (K)**
- **Thinking and Inquiry (T)**
- **Communication (C)**
- **Application (A)**

Built with React 18, TypeScript, Vite, Tailwind CSS, Lucide icons, and Dexie.js (IndexedDB).

---

## Quick Start

### Prerequisites
- Node.js v18+ (tested on Node v24.15.0)
- npm v9+

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```
Starts the local development server at `http://localhost:3000`.

### Production Build
```bash
npm run build
```
Type checks via `tsc` and bundles into `dist/`.

### Run Test Suite
```bash
npm run test
```
Executes all 13 Vitest unit tests covering the calculation engine, domain services, and data portability.

### Run Scale & Load Benchmark
```bash
npm run benchmark
```
Executes the synthetic load test ingesting 2,000 students across 65 classes, 500 assessments, and 250,000 raw participation events, testing latency for 1-click entries, batch stamping, undo, and heavy markbook calculations (40 students x 100 assessments = 350 category columns).

---

## Architectural Highlights
- **Normalized Relational Schema**: 34 Dexie tables with compound unique constraints (`&` prefix).
- **ClassEnrollment as Entity Hub**: Student identity is decoupled from class sections.
- **Two-Stage Ontario Calculation**: Category scores evaluated via `evidenceWeight`; overall course marks evaluated via policy weights ($W_K, W_T, W_C, W_A$) with zero double-weighting.
- **Append-Only Structured Audit Store**: Captures JSON deltas inside atomic Dexie transactions.
- **Idempotent Sync Outbox**: Queues transactions with client-generated `mutationId` for cloud sync.
- **Occupied-Only Seating Storage**: Enforces strict desk coordinates and atomic seat swaps.
