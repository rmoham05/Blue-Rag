import type { AppConfig } from './types.js';
import { embedWithLlamaCpp, isLlamaCppModel, llamaCppModelPath, loadLlamaCppEmbeddingModel } from './llamaCppRuntime.js';

function ollamaError(error: unknown, action: string, config: AppConfig) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('fetch failed') || message.includes('ECONNREFUSED') || message.includes('terminated') || message.includes('aborted')) {
    return new Error(`Ollama ${action} failed. Make sure Ollama is running at ${config.ollamaBaseUrl} and the local models are available. Details: ${message}`);
  }
  return new Error(`Ollama ${action} failed: ${message}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 900));
    }
  }
  throw lastError;
}

export async function checkOllama(config: AppConfig) {
  try {
    const res = await fetchWithTimeout(`${config.ollamaBaseUrl}/api/tags`, {}, 10_000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (error) {
    throw ollamaError(error, 'health check', config);
  }
}

export async function embedText(config: AppConfig, input: string): Promise<number[]> {
  if (isLlamaCppModel(config.embedModel)) {
    await loadLlamaCppEmbeddingModel(config, llamaCppModelPath(config.embedModel));
    return embedWithLlamaCpp(input);
  }

  let res: Response;
  try {
    res = await fetchWithRetry(`${config.ollamaBaseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.embedModel, input })
    }, 60_000, 2);
  } catch (error) {
    throw ollamaError(error, 'embedding', config);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama embedding failed: HTTP ${res.status} ${body}`);
  }

  const data = await res.json() as { embeddings?: number[][]; embedding?: number[] };
  const embedding = data.embeddings?.[0] ?? data.embedding;
  if (!embedding?.length) throw new Error('Ollama returned no embedding');
  return embedding;
}

export async function generateAnswer(config: AppConfig, prompt: string): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.llmModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.15,
          top_p: 0.9,
          num_ctx: 4096,
          num_predict: 450
        }
      })
    }, 180_000, 2);
  } catch (error) {
    throw ollamaError(error, 'generation', config);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama generation failed: HTTP ${res.status} ${body}`);
  }

  const data = await res.json() as { response?: string };
  return data.response?.trim() ?? '';
}
