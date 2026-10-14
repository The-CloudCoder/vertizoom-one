import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { prisma } from '@vertizoom/database';

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDir, '../../../.env') });

const { createApp } = await import('./app.js');
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const port = Number(process.env.PORT ?? 4000);
const app = createApp();
const server = app.listen(port, () => logger.info({ port }, 'Vertizoom One API started'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down API');
  server.close(async () => { await prisma.$disconnect(); process.exit(0); });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
