// ============================================================
// ALFA Platform — Main API Server
// File: backend/src/server.ts
// ============================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { connectDB } from './config/database';
import { connectRedis } from './config/redis';
import { logger } from './utils/logger';

// Route imports
import authRoutes       from './modules/tenant/auth.routes';
import tenantRoutes     from './modules/tenant/tenant.routes';
import whatsappRoutes   from './modules/whatsapp/whatsapp.routes';
import aiRoutes         from './modules/ai/ai.routes';
import knowledgeRoutes  from './modules/knowledge/knowledge.routes';
import sheetsRoutes     from './modules/sheets/sheets.routes';
import driveRoutes      from './modules/drive/drive.routes';
import billingRoutes    from './modules/billing/billing.routes';
import crmRoutes        from './modules/crm/crm.routes';
import ecommerceRoutes  from './modules/ecommerce/ecommerce.routes';
import conversationRoutes from './modules/conversations/conversations.routes';
import broadcastRoutes  from './modules/broadcast/broadcast.routes';
import analyticsRoutes  from './modules/analytics/analytics.routes';

// Middleware imports
import { tenantMiddleware } from './middleware/tenant';
import { authMiddleware }   from './middleware/auth';

const app  = express();
const http = createServer(app);
export const io = new SocketIO(http, {
  cors: { origin: process.env.FRONTEND_URL, credentials: true }
});

// ─── GLOBAL MIDDLEWARE ───────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { error: 'Too many requests, please slow down.' }
}));

// WhatsApp webhook — stricter rate limit
app.use('/webhook/', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500
}));

// ─── PUBLIC ROUTES ───────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/webhook',     whatsappRoutes); // Meta sends here

// ─── PROTECTED ROUTES (require JWT + tenant scope) ───────────
app.use('/api/', authMiddleware, tenantMiddleware);

app.use('/api/tenant',        tenantRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/knowledge',     knowledgeRoutes);
app.use('/api/sheets',        sheetsRoutes);
app.use('/api/drive',         driveRoutes);
app.use('/api/billing',       billingRoutes);
app.use('/api/crm',           crmRoutes);
app.use('/api/ecommerce',     ecommerceRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/broadcast',     broadcastRoutes);
app.use('/api/analytics',     analyticsRoutes);

// ─── HEALTH CHECK ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() });
});

// ─── START ───────────────────────────────────────────────────
async function bootstrap() {
  await connectDB();
  await connectRedis();

  // Import and initialize workers AFTER connections
  const { startEmbedWorker }    = await import('./jobs/embed.job');
  const { startReminderWorker } = await import('./jobs/reminder.job');
  const { startLearnWorker }    = await import('./jobs/learn.job');

  startEmbedWorker();
  startReminderWorker();
  startLearnWorker(); // Auto-learning from conversations

  const PORT = process.env.PORT || 3001;
  http.listen(PORT, () => {
    logger.info(`ALFA API running on port ${PORT}`);
  });
}

bootstrap().catch(err => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
