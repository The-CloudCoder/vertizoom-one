# AWS MVP deployment plan — Vertizoom One

**Target:** development/MVP, AWS Mumbai (`ap-south-1`), initial budget below US$50/month, single-AZ acceptable.

This plan prioritizes low fixed cost and a simple deployment. It is not a high-availability production design. Confirm current regional pricing and any account-specific Free Tier/credit eligibility in the AWS Pricing Calculator before creating resources.

## Recommended starting architecture

- **One small EC2 instance** for the web build, Nginx, and Node.js API. Use a supported ARM/Graviton instance only after confirming all Node/native dependencies and your deployment image support ARM64.
- **Amazon RDS for PostgreSQL, Single-AZ** as the managed relational database. Start with the smallest suitable burstable class available in Mumbai, minimal SSD storage, and a short backup retention period appropriate for development.
- **One VPC** with a public subnet for EC2 and private database subnets for RDS. Do not assign RDS a public IP.
- **One security group for EC2** allowing inbound HTTPS (443) and, during initial certificate setup if needed, HTTP (80). Do not expose the Node API port directly. Prefer Systems Manager Session Manager for administration; avoid opening SSH to the world.
- **One RDS security group** allowing PostgreSQL (5432) only from the EC2 security group.
- **TLS** using Nginx and a certificate for your subdomain. Keep the API behind Nginx at the same origin (for example, `/api`) to simplify CORS.
- **S3 only when needed** for customer uploads, exports, or backups outside the database. Keep objects private and use short-lived presigned URLs.
- **GitHub Actions or a documented manual deploy** initially. Add a full CI/CD pipeline after builds and tests are reliable.

For a very early MVP, serving the compiled frontend and reverse-proxying the API from one EC2 instance avoids the fixed cost of a load balancer and separate compute services. The trade-off is that this instance is a single point of failure.

## Budget guardrails

The US$50 target is a budget ceiling, not a guaranteed AWS quote. Region, instance size, storage, public IPv4, data transfer, logs, backups, and tax affect the final bill.

1. Create an AWS Budget alert at US$10 and US$25, plus a forecast alert approaching US$40.
2. Verify RDS and EC2 pricing for `ap-south-1` in the AWS Pricing Calculator before launch.
3. Avoid a NAT Gateway for this small MVP unless a real requirement justifies its hourly and data-processing charges. The proposed EC2 host uses a public subnet; RDS remains private. Review the security trade-offs carefully.
4. Do not create an Application Load Balancer, Multi-AZ database, Redis, EKS cluster, or multiple always-on app instances yet.
5. Stop or delete non-production compute and databases when not in use, while retaining any required backups. Stopping an instance may not stop storage, IP, snapshot, or other charges.
6. Set log retention limits and monitor S3, snapshots, and data transfer.
7. Never put database credentials in Git, frontend environment variables, container images, or logs. For a persistent environment, use AWS Secrets Manager or Systems Manager Parameter Store with appropriate IAM permissions; include its cost in the budget.

If the smallest RDS configuration plus EC2 cannot fit the verified budget, keep PostgreSQL local in Docker during development and delay the always-on AWS database until the first hosted test. Do not silently replace the managed database with an exposed database on EC2.

## Database setup

1. Create an RDS PostgreSQL instance in `ap-south-1`, Single-AZ, with public access disabled.
2. Place it in a DB subnet group spanning private subnets in at least two Availability Zones; the database instance itself can remain Single-AZ for the MVP.
3. Use a strong generated password and store it in a managed secret store.
4. Require encrypted connections and configure the application connection string with TLS according to the RDS certificate/connection guidance.
5. Configure automated backups with a retention period that fits the environment and budget.
6. Apply schema changes through reviewed Prisma migrations. Use `npm run db:deploy` for committed migrations in deployed environments; never run `prisma migrate dev` against a hosted database.
7. Do not seed real customer data in development. Add cross-tenant access tests before building customer-facing features.

## Application and networking setup

1. Launch EC2 in the same VPC as RDS. Allow outbound access required for package/image downloads and certificate renewal.
2. Install Docker/Compose or run the Node.js process under a process manager; keep the frontend static build served by Nginx.
3. Configure Nginx to serve the SPA and reverse-proxy `/api/` to localhost on port 4000.
4. Keep port 4000 bound to localhost or inaccessible from the public internet. Expose only the required web ports.
5. Configure TLS, security headers, request-size limits, and process restart on failure.
6. Use an instance role with least-privilege access rather than long-lived AWS access keys.
7. Add CloudWatch logs/alarms and a deployment/rollback checklist. Keep logs free of credentials, session tokens, and sensitive customer fields.

## Delivery milestones

### Milestone 1 — local database foundation
- Start PostgreSQL using `docker compose up -d postgres`.
- Run `npm install`, `npm run db:generate`, and `npm run db:migrate`.
- Run `npm run typecheck` and `npm run build`; fix all failures before provisioning AWS.
- Verify `/api/health` and `/api/ready`.

### Milestone 2 — security foundation
- Implement authentication, session creation/revocation, organization onboarding, and server-side authorization.
- Ensure every tenant-owned query is scoped to an organization the authenticated user belongs to.
- Add rate limiting, input validation, secure cookie/session settings, CSRF protection where applicable, and tests for cross-tenant access.
- Do not treat the starter schema or role enum as completed security controls.

### Milestone 3 — AWS development environment
- Create budget alerts first.
- Provision VPC/subnets/security groups, EC2, and private Single-AZ RDS in `ap-south-1`.
- Store secrets outside Git and verify EC2-to-RDS TLS connectivity.
- Apply committed Prisma migrations and deploy the app behind HTTPS.

### Milestone 4 — safe MVP operations
- Verify backup completion and perform a restore test.
- Add uptime, disk, memory, database connection, and application-error monitoring.
- Document rollback and credential rotation.
- Only after the first complete business workflow works, evaluate S3 uploads and a CI/CD pipeline.

## Before production

A single EC2 host and Single-AZ RDS are appropriate only for a constrained MVP. Before production, assess Multi-AZ RDS, multiple application instances behind a load balancer, managed secrets, stronger network isolation, tested point-in-time recovery, WAF/rate limiting, dependency scanning, incident response, and a formal tenant-isolation review.
