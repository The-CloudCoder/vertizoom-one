# Vertizoom One — Architecture and AWS Roadmap

## Product direction

Vertizoom One is a multi-tenant SaaS platform for SMBs. Planned modules include ERP, CRM, HR, AI, and Insights, sharing a common identity, organization, authorization, billing, and audit foundation.

## Initial technology choices

- **Web:** React, TypeScript, Vite, Tailwind CSS.
- **API:** Node.js, Express, TypeScript, Helmet, CORS, Pino request logging.
- **Primary database:** PostgreSQL on Amazon RDS for managed backups, patching options, monitoring, and recovery features.
- **ORM and migrations:** Prisma.
- **File storage:** Amazon S3 for documents and exports; keep object keys and metadata in PostgreSQL.
- **Hosting direction:** deploy the web app as static assets behind CloudFront and S3, and run the API on a managed container service such as ECS Fargate. Final hosting choice depends on expected traffic, operational needs, and budget.
- **Secrets:** AWS Secrets Manager for production database credentials and application secrets.

## Repository layout

- `apps/web`: React frontend.
- `apps/api`: Express API.
- `packages/database`: Prisma schema, generated client, and migration commands.
- `docs`: architecture decisions and implementation notes.

## Database strategy

Use one PostgreSQL database initially, with shared tables and an `organizationId` tenant key on tenant-owned records. Model organization membership separately from user identity so one user can belong to multiple organizations. Use server-side authorization and scoped data access for every tenant-owned query.

Before production, evaluate PostgreSQL row-level security as defense in depth. It does not replace application authorization or tenant-isolation tests. Use database migrations for all schema changes; do not use schema push against production.

Use Amazon RDS for PostgreSQL rather than managing PostgreSQL on an EC2 instance. Start with a development database and modest sizing, then select production instance class, Multi-AZ, storage, backups, and retention based on the service's availability target and budget. Keep RDS private in a VPC and allow inbound database access only from the application security group.

## Architecture principles

1. Start with a modular monolith; split services only when a clear operational need exists.
2. Treat organization/tenant isolation as a security boundary from the beginning.
3. Enforce authorization on the server, not only in the UI.
4. Record security-sensitive actions in an audit trail.
5. Keep secrets out of source control; use managed secrets in deployment.
6. Add migrations, automated tests, monitoring, and recovery procedures before production.
7. Never present sample dashboard metrics as real customer data.

## Implementation sequence

1. Add PostgreSQL and Prisma schema/migration foundations.
2. Implement database connectivity and a readiness endpoint.
3. Add authentication, secure sessions, organization onboarding, and server-side RBAC.
4. Add tenant-scoped audit events and secure S3 uploads.
5. Add CI, linting, formatting, and automated tests, including cross-tenant access tests.
6. Build one end-to-end workflow before expanding all modules.
7. Provision AWS infrastructure with infrastructure as code, private networking, secret management, logging, alarms, backups, and deployment automation.
8. Run security and restore drills before production launch.

## Local development

1. Install Node.js 20+ and npm.
2. Copy `.env.example` to `.env` and configure a local PostgreSQL database.
3. Run `npm install`.
4. Run `npm run db:generate`.
5. Run `npm run db:migrate` to create/apply a local development migration.
6. Run `npm run dev`.

The web app runs on port 5173 and proxies `/api` requests to the API on port 4000. Do not commit real credentials or production data.
