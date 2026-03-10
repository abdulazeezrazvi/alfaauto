// ============================================================
// ALFA — Auto-Learning Service (Exclusive Feature)
// AI that learns from every conversation automatically
// File: backend/src/modules/ai/learning.service.ts
// ============================================================

import Queue from 'bull';
import { db }             from '../../config/database';
import { redis }          from '../../config/redis';
import { indexDocument }  from './rag.service';
import { getAIResponse }  from './ollama.service';
import { logger }         from '../../utils/logger';

const learnQueue = new Queue('auto-learning', { redis: { host: 'localhost', port: 6379 } });

interface LearningJob {
  tenantId:      string;
  customerPhone: string;
  userMessage:   string;
  botReply:      string;
  intent:        string;
  timestamp:     Date;
}

// ─── QUEUE A LEARNING JOB ────────────────────────────────────
export async function queueLearning(job: LearningJob) {
  await learnQueue.add(job, {
    delay:    5 * 60 * 1000, // Wait 5 mins (in case human corrects the bot)
    attempts: 2,
    removeOnComplete: 100
  });
}

// ─── PROCESS LEARNING JOBS ───────────────────────────────────
export function startLearnWorker() {
  learnQueue.process(async (job) => {
    const { tenantId, customerPhone, userMessage, botReply, intent, timestamp } = job.data;

    // Check if a human agent corrected this conversation
    const correctionKey = `correction:${tenantId}:${customerPhone}`;
    const correction    = await redis.get(correctionKey);

    if (correction) {
      // Human corrected the bot — learn from the correction
      await learnFromCorrection(tenantId, userMessage, botReply, correction);
      await redis.del(correctionKey);
    } else {
      // No correction — evaluate if bot response was good
      await evaluateAndLearn(tenantId, userMessage, botReply, intent);
    }
  });

  logger.info('Auto-learning worker started');
}

// ─── LEARN FROM HUMAN CORRECTION ─────────────────────────────
async function learnFromCorrection(
  tenantId:    string,
  userMessage: string,
  badReply:    string,
  goodReply:   string
) {
  // Create a Q&A pair from the correction
  const learningText = `
Question: ${userMessage}
Correct Answer: ${goodReply}
Note: This was corrected by a human agent. Always prefer this answer.
  `.trim();

  // Index this Q&A pair as a high-priority knowledge chunk
  const docId = `learned_${Date.now()}`;
  await indexDocument(tenantId, docId, learningText, {
    source:   'human_correction',
    priority: 'high',
    learned_at: new Date().toISOString()
  });

  // Save to DB for audit trail
  await db.learningEntry.create({
    data: {
      tenant_id:    tenantId,
      user_message: userMessage,
      bot_reply:    badReply,
      correction:   goodReply,
      source:       'human_correction',
      indexed:      true
    }
  });

  logger.info(`Learned from human correction for tenant ${tenantId}`);
}

// ─── EVALUATE BOT RESPONSE ────────────────────────────────────
async function evaluateAndLearn(
  tenantId:    string,
  userMessage: string,
  botReply:    string,
  intent:      string
) {
  // Use AI to evaluate if the response was helpful and complete
  const evaluation = await getAIResponse({
    systemPrompt: `You are evaluating WhatsApp bot responses for quality.
    Rate the response on a scale of 1-5 and respond ONLY with a JSON object:
    {"score": <1-5>, "should_learn": <true/false>, "reason": "<brief reason>"}
    
    Score 4-5 = learn from it (reinforce good behavior)
    Score 1-2 = don't learn (poor response)
    Score 3   = neutral, skip`,
    conversationHistory: [],
    userMessage: `Customer asked: "${userMessage}"\nBot replied: "${botReply}"\nIntent: ${intent}`,
    model: 'llama3',
    temperature: 0.1
  });

  try {
    const result = JSON.parse(evaluation.replace(/```json|```/g, '').trim());

    if (result.should_learn && result.score >= 4) {
      // Good response — reinforce it as a positive example
      const learningText = `
Good example for: ${intent}
Customer asked: ${userMessage}
Good response: ${botReply}
      `.trim();

      const docId = `positive_${Date.now()}`;
      await indexDocument(tenantId, docId, learningText, {
        source:    'auto_positive',
        score:     result.score,
        intent:    intent,
        learned_at: new Date().toISOString()
      });

      logger.info(`Reinforced positive response (score: ${result.score}) for tenant ${tenantId}`);
    }
  } catch (e) {
    // Evaluation parsing failed — skip silently
  }
}

// ─── HUMAN AGENT CORRECTION ENDPOINT ─────────────────────────
// Called when a human agent types a better reply in the dashboard
export async function recordCorrection(
  tenantId:      string,
  customerPhone: string,
  correction:    string
) {
  const correctionKey = `correction:${tenantId}:${customerPhone}`;
  // Store for 10 minutes — the learning job picks it up
  await redis.setex(correctionKey, 600, correction);
  logger.info(`Correction recorded for tenant ${tenantId}, customer ${customerPhone}`);
}

// ─── WEEKLY KNOWLEDGE CONSOLIDATION ──────────────────────────
// Runs every Sunday — consolidates learned Q&As into clean knowledge
export async function consolidateWeeklyLearning(tenantId: string) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const entries = await db.learningEntry.findMany({
    where: {
      tenant_id:  tenantId,
      created_at: { gte: oneWeekAgo },
      source:     'human_correction'
    }
  });

  if (entries.length === 0) return;

  // Summarize all corrections into a clean FAQ document
  const correctionsSummary = entries
    .map(e => `Q: ${e.user_message}\nA: ${e.correction}`)
    .join('\n\n');

  const docId = `weekly_consolidation_${Date.now()}`;
  await indexDocument(tenantId, docId, correctionsSummary, {
    source:     'weekly_consolidation',
    entry_count: entries.length
  });

  logger.info(`Consolidated ${entries.length} corrections for tenant ${tenantId}`);
}
