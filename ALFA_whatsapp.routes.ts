// ============================================================
// ALFA — WhatsApp Webhook Handler (Multi-Tenant)
// File: backend/src/modules/whatsapp/whatsapp.routes.ts
// ============================================================

import { Router, Request, Response } from 'express';
import { db }              from '../../config/database';
import { processMessage }  from './message.processor';
import { logger }          from '../../utils/logger';

const router = Router();

// ─── WEBHOOK VERIFICATION (Meta calls this once during setup) ─
router.get('/whatsapp', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    logger.info('Webhook verified by Meta');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// ─── INCOMING MESSAGE HANDLER ─────────────────────────────────
router.post('/whatsapp', async (req: Request, res: Response) => {
  // Always return 200 FAST — Meta will retry if we're slow
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value         = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        const messages      = value.messages;
        const statuses      = value.statuses;

        // Handle message delivery status updates
        if (statuses) {
          for (const status of statuses) {
            await handleStatusUpdate(status, phoneNumberId);
          }
        }

        if (!messages || !messages.length) continue;

        // Identify which tenant owns this phone number
        const tenant = await db.tenant.findFirst({
          where:   { wa_phone_number_id: phoneNumberId, is_active: true },
          include: { ai_config: true, billing: true }
        });

        if (!tenant) {
          logger.warn(`No active tenant for phone_number_id: ${phoneNumberId}`);
          continue;
        }

        // Check tenant plan limits
        if (!await checkTenantLimits(tenant)) {
          logger.warn(`Tenant ${tenant.id} exceeded plan limits`);
          await sendLimitExceededMessage(tenant, messages[0]);
          continue;
        }

        // Process each message
        for (const message of messages) {
          // Deduplicate — Meta sometimes sends the same message twice
          const alreadyProcessed = await checkDuplicate(message.id);
          if (alreadyProcessed) continue;

          // Process asynchronously — don't block the loop
          processMessage(tenant, message, value.contacts?.[0])
            .catch(err => logger.error(`Error processing message ${message.id}:`, err));
        }
      }
    }
  } catch (err) {
    logger.error('Webhook processing error:', err);
  }
});

// ─── STATUS UPDATE HANDLER ────────────────────────────────────
async function handleStatusUpdate(status: any, phoneNumberId: string) {
  // Update message delivery status in DB
  await db.message.updateMany({
    where:  { wa_message_id: status.id },
    data:   { delivery_status: status.status, delivered_at: new Date() }
  }).catch(() => {}); // Non-critical, ignore errors
}

// ─── PLAN LIMIT CHECK ─────────────────────────────────────────
async function checkTenantLimits(tenant: any): Promise<boolean> {
  if (tenant.billing?.plan === 'professional' || tenant.billing?.plan === 'business') {
    return true; // Unlimited
  }
  // Starter: 500 AI conversations/month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const count = await db.conversation.count({
    where: {
      tenant_id:  tenant.id,
      created_at: { gte: startOfMonth }
    }
  });
  return count < 500;
}

async function checkDuplicate(messageId: string): Promise<boolean> {
  const existing = await db.message.findFirst({ where: { wa_message_id: messageId } });
  return !!existing;
}

async function sendLimitExceededMessage(tenant: any, message: any) {
  // Send a polite message that the bot is temporarily unavailable
  await sendWhatsAppMessage(
    tenant.wa_phone_number_id,
    tenant.wa_access_token,
    message.from,
    'We are currently experiencing high volume. Please try again later or contact us directly.'
  );
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken:   string,
  to:            string,
  text:          string,
  options:       { type?: string; templateName?: string; } = {}
) {
  const url  = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type: 'text',
    text: { body: text, preview_url: false }
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json();
    logger.error('WhatsApp send error:', err);
    throw new Error(`WhatsApp API error: ${err.error?.message}`);
  }

  return await res.json();
}

export default router;
