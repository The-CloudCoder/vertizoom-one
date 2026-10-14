# Database package

Prisma schema and client for Vertizoom One. PostgreSQL is the primary relational database.

## Local setup

1. Create a local PostgreSQL database named `vertizoom_one`.
2. Set `DATABASE_URL` in the root `.env` file.
3. From the repository root, run:

```bash
npm install
npm run db:generate
npm run db:migrate
```

The development migration command will ask for a migration name when it needs to create a migration.

For an already-reviewed migration in CI/production, use `npm run db:deploy`. Do not use `prisma migrate dev` in production.

## Initial models

- `User`: global identity.
- `Organization`: tenant/workspace.
- `OrganizationMember`: membership and starter role.
- `Session`: hashed session-token storage; token creation/validation logic is not implemented yet.
- `AuditEvent`: organization-scoped audit record.

This is a schema foundation, not a complete auth or tenant-isolation implementation. Add server-side permission checks and cross-tenant isolation tests before exposing tenant data.
