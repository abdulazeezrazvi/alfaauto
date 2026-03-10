// ============================================================
// ALFA — Ollama + ChromaDB RAG Service (CPU Optimized)
// File: backend/src/modules/ai/rag.service.ts
// ============================================================

import { ChromaClient, Collection } from 'chromadb';
import { logger } from '../../utils/logger';

// CPU-optimized settings for 4-8 core, 8-16GB RAM
const OLLAMA_BASE_URL   = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL       = 'nomic-embed-text'; // Lightweight, fast embedding model
const CHROMA_URL        = process.env.CHROMA_URL || 'http://localhost:8000';
const CHUNK_SIZE        = 400;   // tokens per chunk
const CHUNK_OVERLAP     = 50;    // overlap between chunks
const TOP_K             = 4;     // number of context chunks to retrieve

let chromaClient: ChromaClient;

function getChromaClient(): ChromaClient {
  if (!chromaClient) {
    chromaClient = new ChromaClient({ path: CHROMA_URL });
  }
  return chromaClient;
}

// ─── GET COLLECTION (creates if not exists) ──────────────────
async function getTenantCollection(tenantId: string): Promise<Collection> {
  const client = getChromaClient();
  const collectionName = `tenant_${tenantId.replace(/-/g, '_')}`;

  return await client.getOrCreateCollection({
    name:     collectionName,
    metadata: { tenant_id: tenantId, created_at: new Date().toISOString() }
  });
}

// ─── EMBED TEXT (Ollama nomic-embed-text) ────────────────────
export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });

  if (!res.ok) throw new Error(`Embedding failed: ${res.statusText}`);
  const data = await res.json();
  return data.embedding;
}

// ─── INDEX DOCUMENT FOR TENANT ───────────────────────────────
export async function indexDocument(
  tenantId:   string,
  documentId: string,
  content:    string,
  metadata:   Record<string, any> = {}
): Promise<{ chunks: number }> {

  const collection = await getTenantCollection(tenantId);
  const chunks     = chunkText(content);

  logger.info(`Indexing ${chunks.length} chunks for tenant ${tenantId}, doc ${documentId}`);

  // Process in batches to avoid memory issues on basic CPU server
  const BATCH_SIZE = 10;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const embeddings = await Promise.all(batch.map(chunk => embedText(chunk)));
    const ids        = batch.map((_, j) => `${documentId}_chunk_${i + j}`);
    const metadatas  = batch.map((_, j) => ({
      ...metadata,
      tenant_id:   tenantId,
      document_id: documentId,
      chunk_index: i + j,
      chunk_total: chunks.length
    }));

    await collection.add({
      ids,
      embeddings,
      documents: batch,
      metadatas
    });
  }

  return { chunks: chunks.length };
}

// ─── RETRIEVE RELEVANT CONTEXT FOR TENANT ────────────────────
export async function retrieveContext(
  tenantId:  string,
  query:     string,
  topK:      number = TOP_K
): Promise<string[]> {
  try {
    const collection    = await getTenantCollection(tenantId);
    const queryEmbedding = await embedText(query);

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults:        topK,
      // CRITICAL: only query THIS tenant's collection — isolation guaranteed
    });

    return results.documents?.[0]?.filter(Boolean) || [];
  } catch (err) {
    logger.error(`RAG retrieval error for tenant ${tenantId}:`, err);
    return [];
  }
}

// ─── DELETE DOCUMENT FROM TENANT COLLECTION ──────────────────
export async function deleteDocument(tenantId: string, documentId: string) {
  const collection = await getTenantCollection(tenantId);
  await collection.delete({ where: { document_id: documentId } });
}

// ─── DELETE ALL TENANT DATA ───────────────────────────────────
export async function deleteTenantCollection(tenantId: string) {
  const client         = getChromaClient();
  const collectionName = `tenant_${tenantId.replace(/-/g, '_')}`;
  await client.deleteCollection({ name: collectionName });
}

// ─── SYNC FROM GOOGLE SHEET ───────────────────────────────────
export async function indexFromSheet(
  tenantId:    string,
  sheetData:   any[][],
  documentId:  string = 'google_sheet_sync'
): Promise<{ chunks: number }> {
  // Convert sheet rows to readable text chunks
  const textContent = sheetData
    .map(row => row.join(' | '))
    .join('\n');

  return await indexDocument(tenantId, documentId, textContent, {
    source: 'google_sheets',
    synced_at: new Date().toISOString()
  });
}

// ─── TEXT CHUNKING ───────────────────────────────────────────
function chunkText(text: string): string[] {
  const words   = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(' ');
    if (chunk.trim().length > 20) { // Skip tiny chunks
      chunks.push(chunk.trim());
    }
    if (i + CHUNK_SIZE >= words.length) break;
  }

  return chunks;
}

// ─── COLLECTION STATS ────────────────────────────────────────
export async function getCollectionStats(tenantId: string) {
  const collection = await getTenantCollection(tenantId);
  const count      = await collection.count();
  return { tenantId, documentCount: count };
}
