import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import type { AppConfig } from './types.js';

let llamaProcess: ChildProcessWithoutNullStreams | null = null;
let loadedModelPath: string | null = null;
let embeddingProcess: ChildProcessWithoutNullStreams | null = null;
let loadedEmbeddingModelPath: string | null = null;
const LLAMA_PORT = 3345;
const EMBEDDING_PORT = 3346;
const execFileAsync = promisify(execFile);

type LlamaBackend = 'cuda' | 'vulkan' | 'cpu' | 'custom';

type LlamaRuntime = {
  exe: string;
  backend: LlamaBackend;
};

function distDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function inferBackend(filePath: string): LlamaBackend {
  const normalized = filePath.toLowerCase();
  if (process.env.RAG_LLAMA_BACKEND) return process.env.RAG_LLAMA_BACKEND.toLowerCase() as LlamaBackend;
  if (normalized.includes(`${path.sep}cuda${path.sep}`) || normalized.includes('-cuda-')) return 'cuda';
  if (normalized.includes(`${path.sep}vulkan${path.sep}`) || normalized.includes('-vulkan-')) return 'vulkan';
  if (normalized.includes(`${path.sep}cpu${path.sep}`) || normalized.includes('-cpu-')) return 'cpu';
  return 'custom';
}

export async function findLlamaServerRuntime(): Promise<LlamaRuntime> {
  const candidates = [
    process.env.LLAMA_SERVER_PATH,
    path.resolve(process.cwd(), 'vendor', 'llama.cpp', 'cuda', 'llama-server.exe'),
    path.resolve(process.cwd(), 'vendor', 'llama.cpp', 'vulkan', 'llama-server.exe'),
    path.resolve(process.cwd(), 'vendor', 'llama.cpp', 'cpu', 'llama-server.exe'),
    path.resolve(distDir(), '..', 'vendor', 'llama.cpp', 'cuda', 'llama-server.exe'),
    path.resolve(distDir(), '..', 'vendor', 'llama.cpp', 'vulkan', 'llama-server.exe'),
    path.resolve(distDir(), '..', 'vendor', 'llama.cpp', 'cpu', 'llama-server.exe')
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await exists(candidate)) return { exe: candidate, backend: inferBackend(candidate) };
  }
  throw new Error(`llama.cpp runtime not found. Expected llama-server.exe under vendor/llama.cpp/cpu.`);
}

export async function findLlamaServerExe() {
  return (await findLlamaServerRuntime()).exe;
}

async function preferredGpuDevice(runtime: LlamaRuntime) {
  if (runtime.backend === 'cpu') return undefined;
  if (process.env.RAG_LLAMA_DEVICE) return process.env.RAG_LLAMA_DEVICE;

  try {
    const { stdout } = await execFileAsync(runtime.exe, ['--list-devices'], { timeout: 15_000 });
    const lines = stdout.split(/\r?\n/);
    const preferred = lines.find(line => /nvidia|geforce|rtx/i.test(line)) ?? lines.find(line => /cuda|vulkan/i.test(line));
    return preferred?.trim().match(/^([^:]+):/)?.[1];
  } catch {
    return undefined;
  }
}

function gpuLayersFor(runtime: LlamaRuntime) {
  if (process.env.RAG_LLAMA_GPU_LAYERS) return process.env.RAG_LLAMA_GPU_LAYERS;
  return runtime.backend === 'cpu' ? '0' : 'auto';
}

function positiveIntFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return String(fallback);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.floor(parsed)) : String(fallback);
}

async function waitForServer(port: number, timeoutMs = 10 * 60_000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
      lastError = `${res.status} ${await res.text().catch(() => '')}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw new Error(`Timed out waiting for llama.cpp server to load the model. Last status: ${lastError}`);
}

export async function loadLlamaCppModel(config: AppConfig, modelPath: string) {
  const resolved = path.resolve(modelPath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || path.extname(resolved).toLowerCase() !== '.gguf') {
    throw new Error('llama.cpp can only load .gguf model files');
  }

  if (llamaProcess && loadedModelPath?.toLowerCase() === resolved.toLowerCase()) {
    config.llmModel = `llamacpp:${resolved}`;
    return { runtime: 'llama.cpp', modelPath: resolved, port: LLAMA_PORT, alreadyLoaded: true };
  }

  await ejectLlamaCppModel();
  const runtime = await findLlamaServerRuntime();
  const device = await preferredGpuDevice(runtime);
  const gpuLayers = gpuLayersFor(runtime);
  const args = [
    '--host', '127.0.0.1',
    '--port', String(LLAMA_PORT),
    '--model', resolved,
    '--ctx-size', '4096',
    '--threads', String(Math.max(2, Math.min(12, Math.floor((await import('node:os')).cpus().length * 0.75)))),
    '--gpu-layers', gpuLayers,
    '--no-webui'
  ];
  if (device) args.splice(args.length - 1, 0, '--device', device);

  llamaProcess = spawn(runtime.exe, args, { windowsHide: true });
  loadedModelPath = resolved;

  let stderr = '';
  llamaProcess.stderr.on('data', chunk => {
    stderr += chunk.toString();
    if (stderr.length > 20000) stderr = stderr.slice(-20000);
  });
  llamaProcess.on('exit', () => {
    llamaProcess = null;
    loadedModelPath = null;
  });

  try {
    await waitForServer(LLAMA_PORT);
  } catch (error) {
    await ejectLlamaCppModel();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nllama.cpp output:\n${stderr}`);
  }

  config.llmModel = `llamacpp:${resolved}`;
  return { runtime: 'llama.cpp', backend: runtime.backend, device, gpuLayers, modelPath: resolved, port: LLAMA_PORT, alreadyLoaded: false };
}

export async function ejectLlamaCppModel() {
  if (!llamaProcess) return { runtime: 'llama.cpp', loaded: false };
  const proc = llamaProcess;
  llamaProcess = null;
  loadedModelPath = null;
  proc.kill();
  return { runtime: 'llama.cpp', loaded: false };
}

export async function loadLlamaCppEmbeddingModel(config: AppConfig, modelPath: string) {
  const resolved = path.resolve(modelPath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || path.extname(resolved).toLowerCase() !== '.gguf') {
    throw new Error('llama.cpp embeddings can only load .gguf model files');
  }

  if (embeddingProcess && loadedEmbeddingModelPath?.toLowerCase() === resolved.toLowerCase()) {
    config.embedModel = `llamacpp:${resolved}`;
    return { runtime: 'llama.cpp', modelPath: resolved, port: EMBEDDING_PORT, alreadyLoaded: true };
  }

  await ejectLlamaCppEmbeddingModel();
  const runtime = await findLlamaServerRuntime();
  const device = await preferredGpuDevice(runtime);
  const gpuLayers = gpuLayersFor(runtime);
  const args = [
    '--host', '127.0.0.1',
    '--port', String(EMBEDDING_PORT),
    '--model', resolved,
    '--threads', String(Math.max(2, Math.min(12, Math.floor((await import('node:os')).cpus().length * 0.75)))),
    '--gpu-layers', gpuLayers,
    '--batch-size', positiveIntFromEnv('RAG_LLAMA_EMBED_BATCH', 2048),
    '--ubatch-size', positiveIntFromEnv('RAG_LLAMA_EMBED_UBATCH', 2048),
    '--embedding',
    '--embd-normalize', '2',
    '--no-webui'
  ];
  if (device) args.splice(args.length - 1, 0, '--device', device);

  embeddingProcess = spawn(runtime.exe, args, { windowsHide: true });
  loadedEmbeddingModelPath = resolved;

  let stderr = '';
  embeddingProcess.stderr.on('data', chunk => {
    stderr += chunk.toString();
    if (stderr.length > 20000) stderr = stderr.slice(-20000);
  });
  embeddingProcess.on('exit', () => {
    embeddingProcess = null;
    loadedEmbeddingModelPath = null;
  });

  try {
    await waitForServer(EMBEDDING_PORT);
  } catch (error) {
    await ejectLlamaCppEmbeddingModel();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nllama.cpp embedding output:\n${stderr}`);
  }

  config.embedModel = `llamacpp:${resolved}`;
  return { runtime: 'llama.cpp', backend: runtime.backend, device, gpuLayers, modelPath: resolved, port: EMBEDDING_PORT, alreadyLoaded: false };
}

export async function ejectLlamaCppEmbeddingModel() {
  if (!embeddingProcess) return { runtime: 'llama.cpp', loaded: false };
  const proc = embeddingProcess;
  embeddingProcess = null;
  loadedEmbeddingModelPath = null;
  proc.kill();
  return { runtime: 'llama.cpp', loaded: false };
}

export function isLlamaCppModel(model: string) {
  return model.startsWith('llamacpp:');
}

export function llamaCppModelPath(model: string) {
  return model.replace(/^llamacpp:/, '');
}

export async function generateWithLlamaCpp(prompt: string) {
  if (!llamaProcess) throw new Error('llama.cpp model is not loaded. Click Load for the local GGUF model first.');
  const res = await fetch(`http://127.0.0.1:${LLAMA_PORT}/completion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      n_predict: 850,
      temperature: 0.15,
      top_p: 0.9,
      stop: ['\n\nUser question:']
    })
  });
  if (!res.ok) throw new Error(`llama.cpp generation failed: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json() as { content?: string; completion?: string };
  return (data.content ?? data.completion ?? '').trim();
}

export async function embedWithLlamaCpp(input: string) {
  if (!embeddingProcess) throw new Error('llama.cpp embedding model is not loaded.');

  const openAiRes = await fetch(`http://127.0.0.1:${EMBEDDING_PORT}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'local-embedding', input })
  });
  if (openAiRes.ok) {
    const data = await openAiRes.json() as { data?: Array<{ embedding?: number[] }> };
    const embedding = data.data?.[0]?.embedding;
    if (embedding?.length) return embedding;
  }

  const legacyRes = await fetch(`http://127.0.0.1:${EMBEDDING_PORT}/embedding`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: input })
  });
  if (!legacyRes.ok) {
    throw new Error(`llama.cpp embedding failed: HTTP ${legacyRes.status} ${await legacyRes.text()}`);
  }
  const data = await legacyRes.json() as { embedding?: number[]; embeddings?: number[][] };
  const embedding = data.embedding ?? data.embeddings?.[0];
  if (!embedding?.length) throw new Error('llama.cpp returned no embedding');
  return embedding;
}
