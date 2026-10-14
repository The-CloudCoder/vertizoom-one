# Vertizoom One

**One Platform. Smarter Business.**

Vertizoom One is a modular SaaS platform in development for small and medium-sized businesses. The product direction brings ERP, CRM, HR, AI assistance, and business insights together in one workspace.

## Current foundation

- **Web:** React, TypeScript, Vite, Tailwind CSS, Lucide icons.
- **API:** Node.js, Express, TypeScript, Helmet, CORS, Pino request logging.
- **Database:** PostgreSQL schema and Prisma client in `packages/database`.
- **AWS direction:** Amazon RDS for PostgreSQL, S3 for files, and a managed hosting service for the API.
- **Dashboard:** responsive workspace shell and module previews.
- **Health endpoints:** `GET /api/health` (liveness) and `GET /api/ready` (database readiness).

> Dashboard figures and activity are illustrative placeholders, not connected to live business records.

## Requirements

- Node.js 20+
- npm 10+ recommended
- PostgreSQL 15+ recommended for local development

## Run locally

1. Create a local PostgreSQL database named `vertizoom_one`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` for your local PostgreSQL instance.
3. Install dependencies and generate the Prisma client:

```bash
npm install
npm run db:generate
```

4. Create/apply the initial development migration:

```bash
npm run db:migrate
```

5. Start the web app and API:

```bash
npm run dev
```

Open the web app at http://localhost:5173. The API liveness endpoint is at http://localhost:4000/api/health, and the database readiness endpoint is at http://localhost:4000/api/ready.

## Scripts

- `npm run dev` — start web and API in development mode.
- `npm run build` — build web, database package, and API.
- `npm run typecheck` — type-check workspaces.
- `npm run db:generate` — generate Prisma Client.
- `npm run db:migrate` — create/apply a local development migration.
- `npm run db:deploy` — apply committed migrations in deployment environments.
- `npm run db:studio` — open Prisma Studio.

Use `db:deploy` for deployment. Do not run `prisma migrate dev` against production.

## Repository structure

```text
apps/
  web/        # React frontend
  api/        # Express API
packages/
  database/   # Prisma schema, client, migrations
docs/
  architecture.md
.env.example
package.json
```

## Multi-tenant schema foundation

The initial schema includes users, organizations, organization membership and starter roles, sessions with hashed-token storage, and organization-scoped audit events. These models are only the starting point: authentication flows, session issuance/validation, server-side RBAC, and comprehensive tenant-isolation tests still need to be implemented before the API serves real customer data.

## AWS direction

Use Amazon RDS for PostgreSQL in private subnets. Permit database connections only from the API's security group, enforce TLS, enable backups, and store production credentials in AWS Secrets Manager. Use S3 for uploads and exports rather than storing file bodies in the relational database.

The repository does not provision AWS resources or deploy itself yet. Add infrastructure as code, CI/CD, monitoring, restore tests, and production security review before launch. Never commit production credentials or real customer data.
