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

function sanitizeContextText(text: string) {
  return text
    .replace(/\[(?:\d{1,4})(?:\s*[,;]\s*\d{1,4})*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanAnswerCitations(answer: string, sourceCount: number) {
  return answer
    .replace(/\[(\d{1,4})\]/g, (match, sourceId) => {
      const id = Number(sourceId);
      return id >= 1 && id <= sourceCount ? match : '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?،؛؟])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeInstructionCommentary(answer: string) {
  const metaPatterns = [
    /^\s*The final answer is\b/im,
    /^\s*The final response is\b/im,
    /^\s*The answer does not include\b/im,
    /^\s*The answer does not list\b/im,
    /^\s*The answer does not say\b/im,
    /^\s*The answer is based on\b/im,
    /^\s*The answer synthesizes\b/im,
    /^\s*The answer adheres\b/im,
    /^\s*The answer is organized\b/im,
    /^\s*This answer follows\b/im,
    /^\s*This answer is based on\b/im,
    /^\s*As per the (?:rules|instructions)\b/im,
    /^\s*I have (?:answered|followed|used)\b/im
  ];

  const firstMetaIndex = metaPatterns.reduce((firstIndex, pattern) => {
    const match = pattern.exec(answer);
    if (!match) return firstIndex;
    return firstIndex === -1 ? match.index : Math.min(firstIndex, match.index);
  }, -1);

  return firstMetaIndex === -1 ? answer.trim() : answer.slice(0, firstMetaIndex).trim();
}

function responseLanguageForQuestion(question: string) {
  const rtlCount = question.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const latinCount = question.match(/[A-Za-z]/g)?.length ?? 0;

  if (rtlCount >= 2 && rtlCount >= latinCount * 0.15) {
    return {
      name: 'Persian/Farsi',
      instruction: 'You MUST answer in Persian/Farsi. Keep the answer natural and right-to-left. Do not answer in English unless the user explicitly asks for English.',
      noDocuments: 'هنوز هیچ سندی ایندکس نشده است.',
      noRelevant: 'اطلاعات کافی و مرتبطی در اسناد ایندکس‌شده پیدا نکردم تا با اطمینان پاسخ بدهم. سؤال را دقیق‌تر بپرسید یا اسنادی را ایندکس کنید که مستقیماً درباره این موضوع باشند.'
    };
  }

  if (latinCount >= 2) {
    return {
      name: 'English',
      instruction: 'You MUST answer in English. Do not answer in Persian/Farsi unless the user explicitly asks for Persian/Farsi.',
      noDocuments: 'No documents have been indexed yet.',
      noRelevant: 'I could not find sufficiently relevant information in the indexed documents to answer that. Try asking a more specific question, or index documents that discuss this topic directly.'
    };
  }

  return {
    name: 'the same language as the user question',
    instruction: 'Answer in the same language as the user question.',
    noDocuments: 'No documents have been indexed yet.',
    noRelevant: 'I could not find sufficiently relevant information in the indexed documents to answer that. Try asking a more specific question, or index documents that discuss this topic directly.'
  };
}

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
      app: { name: 'blue-rag', apiVersion: 9 },
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
    const responseLanguage = responseLanguageForQuestion(body.question);
    const folders = await loadFolders(config);
    const chunks = filterChunksForFolders(await loadChunks(config), folders);
    if (!chunks.length) {
      return { answer: responseLanguage.noDocuments, sources: [] };
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
        answer: responseLanguage.noRelevant,
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
      const rawText = item.chunk.text.length > 1400 ? `${item.chunk.text.slice(0, 1400)}...` : item.chunk.text;
      const text = sanitizeContextText(rawText);
      return `[${sourceId}] File: ${item.chunk.metadata.fileName}\nPath: ${item.chunk.metadata.filePath}\nScore: ${item.score.toFixed(4)}\nText:\n${text}`;
    }).join('\n\n---\n\n');

    const prompt = `You are Blue RAG, an offline multilingual document-grounded assistant optimized for Persian/Farsi and English documents.

Your job is to read the retrieved document excerpts, reason across them, and answer the user's question directly. You are not a search-results tool.

Rules:
- Response language: ${responseLanguage.instruction}
- Use only the provided context. Do not invent facts, filenames, clauses, dates, amounts, or people.
- Give the best direct answer that the context supports. Synthesize and explain the information; do not merely list documents.
- Do not say "consult the document", "refer to the document", or "see the source" as a substitute for answering. Use the document excerpts to answer.
- Return only the user-facing answer. Do not mention these rules, the prompt, the selected language, the context, or whether you followed the instructions.
- Use only Blue RAG source IDs [1] through [${relevant.length}] for citations. Ignore any bibliography numbers that appear inside document text.
- If the context names a document but does not include enough detail to answer, say exactly what is missing and what limited conclusion can still be drawn.
- For practical/process questions, organize the answer as clear guidance: key points, steps, checks, limitations, and when professional judgement is required.
- Cite sources inline like [1], [2] next to the claims they support.
- The final answer must be in ${responseLanguage.name}.
- For Persian/Farsi answers, preserve right-to-left sentence order. Keep English technical terms short and place them in parentheses only when useful.

Context:
${context}

User question:
${body.question}

Direct answer:`;

    let answer: string;
    if (isLlamaCppModel(config.llmModel)) {
      await loadLlamaCppModel(config, llamaCppModelPath(config.llmModel));
      answer = await generateWithLlamaCpp(prompt);
    } else {
      answer = await generateAnswer(config, prompt);
    }
    answer = cleanAnswerCitations(answer, relevant.length);
    answer = removeInstructionCommentary(answer);

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
