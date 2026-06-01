import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLlamaCppModel, llamaCppModelPath } from './llamaCppRuntime.js';
import type { AppConfig } from './types.js';

type BundledModels = {
  llm?: string;
  embedding?: string;
};

function moduleDir() {
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

async function existingDirectories(candidates: string[]) {
  const directories: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      if ((await fs.stat(resolved)).isDirectory()) directories.push(resolved);
    } catch {
      // Optional model folders are expected to be absent in development.
    }
  }
  return [...new Set(directories.map(dir => dir.toLowerCase()))].map(lower => directories.find(dir => dir.toLowerCase() === lower)!);
}

async function walkForGgufs(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf') && !entry.name.toLowerCase().startsWith('mmproj-')) {
        files.push(full);
      }
    }
  }
  await walk(dir);
  return files.sort((a, b) => a.localeCompare(b));
}

function preferredGguf(files: string[]) {
  return files.find(file => /-00001-of-\d{5}\.gguf$/i.test(path.basename(file)))
    ?? files.find(file => !/-\d{5}-of-\d{5}\.gguf$/i.test(path.basename(file)))
    ?? files[0];
}

async function firstGgufUnder(dir: string) {
  if (!await exists(dir)) return undefined;
  return preferredGguf(await walkForGgufs(dir));
}

async function findBundledModels(): Promise<BundledModels> {
  const roots = await existingDirectories([
    process.env.RAG_MODELS_DIR ?? '',
    path.resolve(process.cwd(), 'models'),
    path.resolve(moduleDir(), '..', 'models'),
    path.resolve(moduleDir(), '..', '..', 'models')
  ].filter(Boolean));

  for (const root of roots) {
    const llm = await firstGgufUnder(path.join(root, 'llm'));
    const embedding = await firstGgufUnder(path.join(root, 'embeddings'));
    if (llm || embedding) return { llm, embedding };
  }

  return {};
}

async function localModelMissing(model: string) {
  return isLlamaCppModel(model) && !await exists(llamaCppModelPath(model));
}

export async function applyBundledModelDefaults(config: AppConfig) {
  const bundled = await findBundledModels();

  if (bundled.llm && (
    config.llmModel === 'auto'
    || config.llmModel === 'qwen2.5:7b-instruct'
    || await localModelMissing(config.llmModel)
  )) {
    config.llmModel = `llamacpp:${bundled.llm}`;
  }

  if (bundled.embedding && (
    config.embedModel === 'auto'
    || config.embedModel === 'bge-m3'
    || await localModelMissing(config.embedModel)
  )) {
    config.embedModel = `llamacpp:${bundled.embedding}`;
  }

  return bundled;
}
