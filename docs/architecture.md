# Vertizoom One — Initial Architecture

## Product direction

Vertizoom One is a multi-tenant SaaS platform for SMBs. Planned modules include ERP, CRM, HR, AI, and Insights, sharing a common identity, organization, authorization, billing, and audit foundation.

## Repository layout

- `apps/web`: React, TypeScript, Vite, Tailwind CSS, Lucide icons.
- `apps/api`: Node.js, Express, TypeScript, Helmet, CORS, structured request logging.
- `docs`: architecture decisions and implementation notes.

## Architecture principles

1. Start with a modular monolith; split services only when a clear operational need exists.
2. Treat organization/tenant isolation as a security boundary from the beginning.
3. Enforce authorization on the server, not only in the UI.
4. Record security-sensitive actions in an audit trail.
5. Keep secrets out of source control; use environment variables locally and a managed secret store in deployment.
6. Add database migrations and automated tests before building production business workflows.
7. Never present sample dashboard metrics as real customer data.

## Suggested implementation sequence

1. Establish CI, linting, formatting, and automated tests.
2. Add PostgreSQL and Prisma migrations.
3. Implement authentication, session management, organization onboarding, and server-side RBAC.
4. Add tenant-aware audit events and secure file storage.
5. Build shared navigation, organization settings, and subscription entitlements.
6. Deliver one end-to-end workflow per module, backed by tests.
7. Add monitoring, backups, rate limiting, security review, and deployment automation before production use.

## Local development

Copy `.env.example` to `.env`, then run:

```bash
npm install
npm run dev
```

The web app runs on port 5173 and proxies `/api` requests to the API on port 4000. PostgreSQL is not wired into this initial scaffold yet.
