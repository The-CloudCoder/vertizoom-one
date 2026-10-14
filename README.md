# Vertizoom One

**One Platform. Smarter Business.**

Vertizoom One is a modular SaaS platform in development for small and medium-sized businesses. The product direction brings ERP, CRM, HR, AI assistance, and business insights together in one workspace.

## Current foundation

- **Web:** React, TypeScript, Vite, Tailwind CSS, Lucide icons.
- **API:** Node.js, Express, TypeScript, Helmet, CORS, Pino request logging.
- **Workspace:** npm workspaces in a single repository.
- **Dashboard:** responsive workspace shell and module previews.
- **Health endpoint:** `GET /api/health`.

> Dashboard figures and activity are illustrative placeholders, not connected to a database or live business records.

## Requirements

- Node.js 20+
- npm 10+ recommended

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Open the web app at http://localhost:5173. The API health endpoint is available at http://localhost:4000/api/health.

## Scripts

- `npm run dev` — start web and API in development mode.
- `npm run build` — build both workspaces.
- `npm run typecheck` — type-check both workspaces.

## Repository structure

```text
apps/
  web/       # React frontend
  api/       # Express API
docs/
  architecture.md
.env.example
package.json
```

## Architecture and roadmap

Read [docs/architecture.md](docs/architecture.md) for the initial architecture principles and suggested implementation order.

The initial scaffold is not production-ready yet. Authentication, tenant isolation, database migrations, authorization policies, tests, CI, and deployment configuration must be implemented and reviewed before handling real customer data.
