import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the single root-level .env from both src and compiled dist locations.
const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDir, '../../../.env') });
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { prisma } from '@vertizoom/database';

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const port = Number(process.env.PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: webOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

// Liveness: confirms the Node.js process is responding.
app.get('/api/health', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: 'vertizoom-one-api',
    timestamp: new Date().toISOString(),
  });
});

// Readiness: verifies the API can reach its configured PostgreSQL database.
app.get('/api/ready', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.status(200).json({ status: 'ready', database: 'connected' });
  } catch (error) {
    logger.error({ err: error }, 'Readiness check failed');
    response.status(503).json({ status: 'not_ready' });
  }
});

app.use((_request, response) => {
  response.status(404).json({ error: 'Not found' });
});

const server = app.listen(port, () => {
  logger.info({ port }, 'Vertizoom One API started');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down API');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
