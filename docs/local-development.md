# Local development

## Start PostgreSQL

Install Docker Desktop or Docker Engine with the Compose plugin, then run from the repository root:

```bash
docker compose up -d postgres
```

The database is bound to `127.0.0.1:5432`, not exposed on the LAN. The Compose credentials are for local development only.

## Configure and migrate

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

The root `.env` file is ignored by Git. Never put production credentials in it or commit it.

## Stop local services

```bash
docker compose down
```

To remove the local database volume as well (this permanently deletes the local database data):

```bash
docker compose down -v
```

## Authentication and tenant-isolation tests

The auth integration tests deliberately delete and recreate test data. **Never point them at your development or production database.** Create a dedicated local database and environment file:

```bash
docker compose exec postgres psql -U postgres -d postgres -c "CREATE DATABASE vertizoom_one_test;"
cp .env.test.example .env.test
npm run test:auth
```

The `.env.test` file is local-only and ignored by Git. The test command refuses to run unless `DATABASE_URL` contains `vertizoom_one_test`. Tests cover signup, password hashing, login/logout, sessions, tenant isolation, membership roles, and origin checks.

Signup creates the first organization and makes the registering user its OWNER. Organization member management currently supports adding an existing account as MEMBER or VIEWER; email invitations and ownership transfer are not implemented yet. Configure HTTPS in production so session cookies use the Secure attribute.
