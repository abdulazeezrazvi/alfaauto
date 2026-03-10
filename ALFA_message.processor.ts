// ============================================================
// ALFA — Core Message Processor (AI Pipeline Per Tenant)
// File: backend/src/modules/whatsapp/message.processor.ts
// ============================================================

import { db }                    from '../../config/database';
import { redis }                 from '../../config/redis';
import { getAIResponse }         from '../ai/ollama.service';
import { retrieveContext }       from '../ai/rag.service';
import { detectIntent }          from '../ai/intent.service';
import { handleOrderFlow }       from '../flows/order.flow';
import { handleAppointmentFlow } from '../flows/appointment.flow';
import { handleFAQFlow }         from '../flows/faq.flow';
import { upsertCRMContact }      from '../crm/crm.service';
import { syncToSheets }          from '../sheets/sheets.service';
import { queueLearning }         from '../ai/learning.service';
import { sendWhatsAppMessage }   from './whatsapp.routes';
import { io }                    from '../../server';
import { logger }                from '../../utils/logger';

const CONTEXT_WINDOW = 10; // Last N messages to include as conversation history

export async function processMessage(tenant: any, message: any, contact: any) {
  const customerPhone = message.from;
  const messageId     = message.id;
  const timestamp     = new Date(parseInt(message.timestamp) * 1000);

  // ─── 1. Extract message content ─────────────────────────────
  let userText = '';
  let mediaUrl = null;

  switch (message.type) {
    case 'text':
      userText = message.text?.body || '';
      break;
    case 'image':
    case 'document':
    case 'audio':
      mediaUrl = await downloadMedia(message, tenant);
      userText = `[${message.type} received]`;
      break;
    case 'interactive':
      userText = message.interactive?.button_reply?.title ||
                 message.interactive?.list_reply?.title   || '';
      break;
    case 'order':
      await handleOrderFlow(tenant, message.order, customerPhone);
      return;
    default:
      logger.warn(`Unhandled message type: ${message.type}`);
      return;
  }

  if (!userText.trim()) return;

  // ─── 2. Save incoming message to DB ─────────────────────────
  const savedMessage = await db.message.create({
    data: {
      tenant_id:       tenant.id,
      wa_message_id:   messageId,
      customer_phone:  customerPhone,
      content:         userText,
      role:            'user',
      message_type:    message.type,
      media_url:       mediaUrl,
      created_at:      timestamp
    }
  });

  // ─── 3. Upsert CRM contact ───────────────────────────────────
  const crmContact = await upsertCRMContact(tenant.id, {
    phone:      customerPhone,
    name:       contact?.profile?.name || customerPhone,
    last_seen:  new Date()
  });

  // ─── 4. Emit real-time event to dashboard ───────────────────
  io.to(`tenant:${tenant.id}`).emit('new_message', {
    message:  savedMessage,
    contact:  crmContact,
    tenantId: tenant.id
  });

  // ─── 5. Check if human takeover is active ───────────────────
  const humanKey = `human_takeover:${tenant.id}:${customerPhone}`;
  const isHuman  = await redis.get(humanKey);
  if (isHuman) {
    // Don't reply — human agent is handling this conversation
    logger.info(`Human takeover active for ${customerPhone}`);
    return;
  }

  // ─── 6. Detect intent ────────────────────────────────────────
  const intent = await detectIntent(userText, tenant);
  logger.info(`Intent detected: ${intent} for tenant ${tenant.id}`);

  // ─── 7. Route to appropriate flow ────────────────────────────
  let botReply = '';
  let flowData = null;

  switch (intent) {
    case 'BOOK_APPOINTMENT':
      ({ reply: botReply, data: flowData } =
        await handleAppointmentFlow(tenant, customerPhone, userText, crmContact));
      break;

    case 'PLACE_ORDER':
      ({ reply: botReply, data: flowData } =
        await handleOrderFlow(tenant, customerPhone, userText, crmContact));
      break;

    case 'ORDER_STATUS':
      botReply = await getOrderStatus(tenant, customerPhone, userText);
      break;

    case 'CANCEL_APPOINTMENT':
    case 'RESCHEDULE':
      ({ reply: botReply, data: flowData } =
        await handleAppointmentFlow(tenant, customerPhone, userText, crmContact, intent));
      break;

    default:
      // General AI response via RAG
      botReply = await buildAIResponse(tenant, customerPhone, userText);
  }

  if (!botReply) return;

  // ─── 8. Send reply via WhatsApp API ──────────────────────────
  const sent = await sendWhatsAppMessage(
    tenant.wa_phone_number_id,
    tenant.wa_access_token,
    customerPhone,
    botReply
  );

  // ─── 9. Save bot reply to DB ─────────────────────────────────
  const botMessage = await db.message.create({
    data: {
      tenant_id:      tenant.id,
      wa_message_id:  sent.messages?.[0]?.id,
      customer_phone: customerPhone,
      content:        botReply,
      role:           'bot',
      intent:         intent,
      flow_data:      flowData ? JSON.stringify(flowData) : null,
      created_at:     new Date()
    }
  });

  // ─── 10. Emit bot reply to dashboard ─────────────────────────
  io.to(`tenant:${tenant.id}`).emit('bot_reply', {
    message:  botMessage,
    tenantId: tenant.id
  });

  // ─── 11. Queue auto-learning job ─────────────────────────────
  // Sends conversation to learning pipeline to improve AI over time
  await queueLearning({
    tenantId:      tenant.id,
    customerPhone,
    userMessage:   userText,
    botReply,
    intent,
    timestamp:     new Date()
  });

  // ─── 12. Update CRM last interaction ─────────────────────────
  await db.crmContact.update({
    where: { id: crmContact.id },
    data:  {
      last_message:    userText,
      last_seen:       new Date(),
      message_count:   { increment: 1 }
    }
  });
}

// ─── AI RESPONSE WITH RAG ────────────────────────────────────
async function buildAIResponse(tenant: any, customerPhone: string, userText: string): Promise<string> {

  // Get last N messages for conversation context
  const history = await db.message.findMany({
    where:   { tenant_id: tenant.id, customer_phone: customerPhone },
    orderBy: { created_at: 'desc' },
    take:    CONTEXT_WINDOW
  });

  const conversationHistory = history.reverse().map(m => ({
    role:    m.role === 'bot' ? 'assistant' : 'user',
    content: m.content
  }));

  // Retrieve relevant context from tenant's ChromaDB collection
  const ragContext = await retrieveContext(tenant.id, userText, 4);

  // Build final prompt
  const systemPrompt = buildSystemPrompt(tenant, ragContext);

  // Call Ollama
  const response = await getAIResponse({
    systemPrompt,
    conversationHistory,
    userMessage: userText,
    model:       tenant.ai_config?.model_name || 'llama3',
    temperature: tenant.ai_config?.temperature || 0.7,
  });

  return response;
}

function buildSystemPrompt(tenant: any, ragContext: string[]): string {
  return `You are a helpful WhatsApp assistant for ${tenant.business_name}.

BUSINESS INFORMATION:
${tenant.ai_config?.system_prompt || 'Be helpful and professional.'}

RELEVANT KNOWLEDGE BASE:
${ragContext.join('\n\n')}

INSTRUCTIONS:
- Keep replies concise (under 150 words) — this is WhatsApp, not email
- Be warm, professional, and helpful
- If you don't know something, say "Let me check and get back to you"
- Never mention competitor businesses
- Format phone numbers, prices, and dates clearly
- Always end with "Is there anything else I can help you with?"
- Respond in the same language the customer uses`;
}

async function getOrderStatus(tenant: any, customerPhone: string, userText: string): Promise<string> {
  // Extract order ID from message or look up by phone
  const orders = await db.order.findMany({
    where:   { tenant_id: tenant.id, customer_phone: customerPhone },
    orderBy: { created_at: 'desc' },
    take:    3
  });

  if (!orders.length) {
    return "I couldn't find any recent orders for your number. Could you share your order ID?";
  }

  const latest = orders[0];
  return `Your latest order (${latest.order_number}) is currently: *${latest.status}*.\n\nItems: ${latest.items_summary}\nDate: ${latest.created_at.toLocaleDateString()}\n\nIs there anything else I can help you with?`;
}

async function downloadMedia(message: any, tenant: any): Promise<string | null> {
  try {
    // Get media URL from WhatsApp
    const mediaId  = message[message.type]?.id;
    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${tenant.wa_access_token}` }
    });
    const mediaData = await mediaRes.json();

    // Download and upload to Google Drive
    const { uploadToDrive } = await import('../drive/drive.service');
    const driveUrl = await uploadToDrive(tenant.id, mediaData.url, tenant.wa_access_token, message.type);
    return driveUrl;
  } catch (err) {
    logger.error('Media download error:', err);
    return null;
  }
}
