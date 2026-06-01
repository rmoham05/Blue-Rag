import cors from '@fastify/cors';
import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { config as defaultConfig } from './config.js';
import { applyBundledModelDefaults } from './bundledModels.js';
import { runIndex, indexStatus } from './indexer.js';
import { ejectLlamaCppEmbeddingModel, ejectLlamaCppModel, generateWithLlamaCpp, isLlamaCppModel, llamaCppModelPath, loadLlamaCppModel } from './llamaCppRuntime.js';
import { ejectOllamaModel, importGgufToOllama, loadLocalModelLibrary, loadOllamaModel, refreshLocalModelLibrary, resolveLocalModelFile, saveLocalModelFolder } from './localModels.js';
import { loadModelConfig, saveModelConfig } from './modelConfig.js';
import { checkOllama, embedText, generateAnswer } from './ollama.js';
import { addFolder, clearFolders, cosineSimilarity, filterChunksForFolders, loadChunks, loadFolders, removeFolder, replaceFolders } from './store.js';
import type { AppConfig } from './types.js';

export async function createApp(config: AppConfig = defaultConfig) {
  await loadModelConfig(config);
  await applyBundledModelDefaults(config);
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('Ollama') ? 503 : 500;
    reply.status(status).send({
      error: status === 503 ? 'Local model runtime error' : 'Internal Server Error',
      message
    });
  });

  app.get('/health', async () => {
    let ollama: unknown = null;
    try {
      ollama = await checkOllama(config);
    } catch (error) {
      ollama = { error: error instanceof Error ? error.message : String(error) };
    }
    return {
      ok: true,
      app: { name: 'blue-rag', apiVersion: 5 },
      config: { ...config, dataDir: config.dataDir },
      ollama
    };
  });

  app.get('/folders', async () => loadFolders(config));

  app.get('/models', async () => {
    let ollama: { models?: Array<{ name?: string; model?: string; details?: { family?: string } }> };
    try {
      ollama = await checkOllama(config) as { models?: Array<{ name?: string; model?: string; details?: { family?: string } }> };
    } catch {
      ollama = { models: [] };
    }
    const models = (ollama.models ?? []).map(model => ({
      name: model.name ?? model.model ?? '',
      family: model.details?.family ?? ''
    })).filter(model => model.name);
    return {
      current: { llmModel: config.llmModel, embedModel: config.embedModel },
      models
    };
  });

  app.post('/models', async (request) => {
    const body = z.object({
      llmModel: z.string().min(1).optional(),
      embedModel: z.string().min(1).optional()
    }).parse(request.body);
    return saveModelConfig(config, body);
  });

  app.get('/local-models', async () => loadLocalModelLibrary(config));

  app.post('/local-models/folder', async (request) => {
    const body = z.object({ path: z.string().min(1) }).parse(request.body);
    return saveLocalModelFolder(config, body.path);
  });

  app.post('/local-models/refresh', async () => refreshLocalModelLibrary(config));

  app.post('/local-models/file', async (request) => {
    const body = z.object({ filePath: z.string().min(1) }).parse(request.body);
    return resolveLocalModelFile(body.filePath);
  });

  app.post('/local-models/import', async (request) => {
    const body = z.object({ filePath: z.string().min(1), modelName: z.string().min(1).optional() }).parse(request.body);
    const result = await importGgufToOllama(config, body.filePath, body.modelName);
    await saveModelConfig(config, { llmModel: result.modelName });
    return result;
  });

  app.post('/local-models/load-direct', async (request) => {
    const body = z.object({ filePath: z.string().min(1) }).parse(request.body);
    const result = await loadLlamaCppModel(config, body.filePath);
    await saveModelConfig(config, { llmModel: `llamacpp:${result.modelPath}` });
    return result;
  });

  app.post('/models/load', async (request) => {
    const body = z.object({ modelName: z.string().min(1).optional() }).parse(request.body);
    const modelName = body.modelName ?? config.llmModel;
    if (isLlamaCppModel(modelName)) return loadLlamaCppModel(config, llamaCppModelPath(modelName));
    return loadOllamaModel(config, modelName);
  });

  app.post('/models/eject', async (request) => {
    const body = z.object({ modelName: z.string().min(1).optional() }).parse(request.body);
    const modelName = body.modelName ?? config.llmModel;
    if (isLlamaCppModel(modelName)) return ejectLlamaCppModel();
    return ejectOllamaModel(config, modelName);
  });

  app.post('/folders', async (request) => {
    const body = z.object({ path: z.string().min(1) }).parse(request.body);
    return addFolder(config, body.path);
  });

  app.post('/folders/replace', async (request) => {
    const body = z.object({ path: z.string().min(1) }).parse(request.body);
    return replaceFolders(config, body.path);
  });

  app.post('/folders/remove', async (request) => {
    const body = z.object({ path: z.string().min(1) }).parse(request.body);
    return removeFolder(config, body.path);
  });

  app.post('/folders/clear', async () => clearFolders(config));

  app.post('/index/run', async () => runIndex(config));
  app.get('/index/status', async () => indexStatus);

  app.post('/chat/ask', async (request) => {
    const body = z.object({ question: z.string().min(1), top_k: z.number().int().positive().max(20).optional() }).parse(request.body);
    const folders = await loadFolders(config);
    const chunks = filterChunksForFolders(await loadChunks(config), folders);
    if (!chunks.length) {
      return { answer: 'No documents have been indexed yet.', sources: [] };
    }

    const queryEmbedding = await embedText(config, body.question);
    const topK = body.top_k ?? config.topK;
    const ranked = chunks
      .map(chunk => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const relevant = ranked.filter(item => item.score >= 0.34);
    if (!relevant.length) {
      return {
        answer: 'I could not find sufficiently relevant information in the indexed documents to answer that. Try asking a more specific question, or index documents that discuss this topic directly.',
        sources: ranked.map((item, index) => ({
          id: index + 1,
          score: item.score,
          file: item.chunk.metadata.filePath,
          fileName: item.chunk.metadata.fileName,
          chunkIndex: item.chunk.metadata.chunkIndex,
          snippet: item.chunk.text.slice(0, 700)
        }))
      };
    }

    const context = relevant.map((item, index) => {
      const sourceId = index + 1;
      const text = item.chunk.text.length > 1600 ? `${item.chunk.text.slice(0, 1600)}…` : item.chunk.text;
      return `[${sourceId}] File: ${item.chunk.metadata.fileName}\nPath: ${item.chunk.metadata.filePath}\nScore: ${item.score.toFixed(4)}\nText:\n${text}`;
    }).join('\n\n---\n\n');

    const prompt = `You are an offline multilingual RAG assistant optimized for Persian/Farsi and English documents.\n\nRules:\n- Answer using only the provided context when possible.\n- If the context is insufficient, say that clearly.\n- Answer in the same language as the user's question. If the user asks in Persian/Farsi, answer naturally in Persian.\n- For Persian/Farsi answers, preserve right-to-left sentence order. Keep English technical terms short and place them in parentheses only when useful. Do not over-mix English inside Persian sentences.\n- Cite sources inline like [1], [2].\n- Do not invent facts, filenames, clauses, dates, amounts, or people.\n\nContext:\n${context}\n\nUser question:\n${body.question}\n\nAnswer:`;

    let answer: string;
    if (isLlamaCppModel(config.llmModel)) {
      await loadLlamaCppModel(config, llamaCppModelPath(config.llmModel));
      answer = await generateWithLlamaCpp(prompt);
    } else {
      answer = await generateAnswer(config, prompt);
    }

    return {
      answer,
      sources: relevant.map((item, index) => ({
        id: index + 1,
        score: item.score,
        file: item.chunk.metadata.filePath,
        fileName: item.chunk.metadata.fileName,
        chunkIndex: item.chunk.metadata.chunkIndex,
        snippet: item.chunk.text.slice(0, 700)
      }))
    };
  });

  return app;
}

export async function startServer(config: AppConfig = defaultConfig) {
  const app = await createApp(config);
  await app.listen({ port: config.port, host: '127.0.0.1' });
  return app;
}

export async function stopLocalRuntimes() {
  await ejectLlamaCppModel();
  await ejectLlamaCppEmbeddingModel();
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  await startServer();
}
