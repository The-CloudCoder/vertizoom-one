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
