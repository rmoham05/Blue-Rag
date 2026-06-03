import 'dotenv/config';
import path from 'node:path';
import type { AppConfig } from './types.js';

const numberFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config: AppConfig = {
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  llmModel: process.env.RAG_LLM_MODEL ?? 'qwen2.5:7b-instruct',
  embedModel: process.env.RAG_EMBED_MODEL ?? 'bge-m3',
  dataDir: path.resolve(process.env.RAG_DATA_DIR ?? './.rag-data'),
  chunkChars: numberFromEnv('RAG_CHUNK_CHARS', 1600),
  chunkOverlap: numberFromEnv('RAG_CHUNK_OVERLAP', 250),
  topK: numberFromEnv('RAG_TOP_K', 8),
  port: numberFromEnv('RAG_PORT', 3344)
};
