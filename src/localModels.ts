import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from './types.js';

const execFileAsync = promisify(execFile);
const localModelConfigFile = (config: AppConfig) => path.join(config.dataDir, 'local-model-library.json');

export type LocalModelFile = {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
  isSplit: boolean;
  shardIndex?: number;
  shardCount?: number;
  shardFiles?: string[];
  displayName: string;
};

export type LocalModelLibrary = {
  folderPath?: string;
  files: LocalModelFile[];
};

type RawGgufFile = Omit<LocalModelFile, 'isSplit' | 'displayName' | 'shardFiles'>;

async function existsDirectory(folderPath: string) {
  const resolved = path.resolve(folderPath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error('Path is not a directory');
  return resolved;
}

function splitInfo(fileName: string) {
  const match = fileName.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
  if (!match) return null;
  return {
    prefix: match[1],
    shardIndex: Number(match[2]),
    shardCount: Number(match[3])
  };
}

function groupSplitGgufs(files: RawGgufFile[]): LocalModelFile[] {
  const normal: LocalModelFile[] = [];
  const splitGroups = new Map<string, RawGgufFile[]>();

  for (const file of files) {
    const info = splitInfo(file.fileName);
    if (!info) {
      normal.push({ ...file, isSplit: false, displayName: file.fileName });
      continue;
    }
    const groupKey = `${path.dirname(file.filePath).toLowerCase()}::${info.prefix.toLowerCase()}::${info.shardCount}`;
    const group = splitGroups.get(groupKey) ?? [];
    group.push({ ...file, shardIndex: info.shardIndex, shardCount: info.shardCount });
    splitGroups.set(groupKey, group);
  }

  for (const group of splitGroups.values()) {
    group.sort((a, b) => (a.shardIndex ?? 0) - (b.shardIndex ?? 0));
    const first = group.find(file => file.shardIndex === 1) ?? group[0];
    const info = splitInfo(first.fileName);
    const totalBytes = group.reduce((sum, file) => sum + file.sizeBytes, 0);
    normal.push({
      ...first,
      sizeBytes: totalBytes,
      isSplit: true,
      shardIndex: 1,
      shardCount: info?.shardCount ?? group.length,
      shardFiles: group.map(file => file.filePath),
      displayName: `${info?.prefix ?? path.basename(first.fileName, '.gguf')} (${group.length}/${info?.shardCount ?? group.length} shards)`
    });
  }

  return normal.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function walkForGguf(dir: string, maxFiles = 400): Promise<LocalModelFile[]> {
  const raw: RawGgufFile[] = [];
  async function walk(current: string) {
    if (raw.length >= maxFiles) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (raw.length >= maxFiles) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'release', 'dist'].includes(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        const stat = await fs.stat(full);
        const info = splitInfo(entry.name);
        raw.push({
          filePath: full,
          fileName: entry.name,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          shardIndex: info?.shardIndex,
          shardCount: info?.shardCount
        });
      }
    }
  }
  await walk(dir);
  return groupSplitGgufs(raw);
}

export async function loadLocalModelLibrary(config: AppConfig): Promise<LocalModelLibrary> {
  try {
    return JSON.parse(await fs.readFile(localModelConfigFile(config), 'utf8')) as LocalModelLibrary;
  } catch {
    return { files: [] };
  }
}

export async function saveLocalModelFolder(config: AppConfig, folderPath: string): Promise<LocalModelLibrary> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const resolved = await existsDirectory(folderPath);
  const files = await walkForGguf(resolved);
  const library = { folderPath: resolved, files };
  await fs.writeFile(localModelConfigFile(config), JSON.stringify(library, null, 2), 'utf8');
  return library;
}

export async function refreshLocalModelLibrary(config: AppConfig): Promise<LocalModelLibrary> {
  const current = await loadLocalModelLibrary(config);
  if (!current.folderPath) return current;
  return saveLocalModelFolder(config, current.folderPath);
}

export async function resolveLocalModelFile(filePath: string): Promise<LocalModelFile> {
  const resolved = path.resolve(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || path.extname(resolved).toLowerCase() !== '.gguf') {
    throw new Error('Selected model must be a .gguf file');
  }

  const fileName = path.basename(resolved);
  const info = splitInfo(fileName);
  const selected: RawGgufFile = {
    filePath: resolved,
    fileName,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    shardIndex: info?.shardIndex,
    shardCount: info?.shardCount
  };

  if (!info) {
    return { ...selected, isSplit: false, displayName: fileName };
  }

  const dir = path.dirname(resolved);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const shards: RawGgufFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.gguf')) continue;
    const shardInfo = splitInfo(entry.name);
    if (!shardInfo || shardInfo.prefix !== info.prefix || shardInfo.shardCount !== info.shardCount) continue;
    const shardPath = path.join(dir, entry.name);
    const shardStat = await fs.stat(shardPath);
    shards.push({
      filePath: shardPath,
      fileName: entry.name,
      sizeBytes: shardStat.size,
      modifiedAt: shardStat.mtime.toISOString(),
      shardIndex: shardInfo.shardIndex,
      shardCount: shardInfo.shardCount
    });
  }

  const selectedLower = resolved.toLowerCase();
  const grouped = groupSplitGgufs(shards);
  const match = grouped.find(file => file.shardFiles?.some(shard => shard.toLowerCase() === selectedLower));
  if (match) return match;

  return {
    ...selected,
    isSplit: true,
    shardFiles: [resolved],
    displayName: `${info.prefix} (1/${info.shardCount} shards)`
  };
}

function safeModelNameFromFile(filePath: string) {
  const name = path.basename(filePath, path.extname(filePath));
  const split = splitInfo(path.basename(filePath));
  const base = (split?.prefix ?? name)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `local-${base || 'model'}`;
}

export async function importGgufToOllama(config: AppConfig, filePath: string, requestedName?: string) {
  const resolved = path.resolve(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || path.extname(resolved).toLowerCase() !== '.gguf') {
    throw new Error('Selected model must be a .gguf file');
  }

  const info = splitInfo(path.basename(resolved));
  if (info) {
    throw new Error('This is a split GGUF model. The current Ollama-backed importer cannot safely import split GGUF shards because Ollama stores only the selected shard internally. Use a single-file GGUF model, merge the shards into one GGUF first, or pull the model directly through Ollama if available.');
  }

  const modelName = (requestedName?.trim() || safeModelNameFromFile(resolved)).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.:-]{0,90}$/.test(modelName)) {
    throw new Error('Model name can only contain letters, numbers, dot, dash, underscore, and colon');
  }

  const modelfilePath = path.join(config.dataDir, `${modelName.replace(/[:/\\]/g, '-')}.Modelfile`);
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(modelfilePath, `FROM ${JSON.stringify(resolved)}\n`, 'utf8');

  try {
    const { stdout, stderr } = await execFileAsync('ollama', ['create', modelName, '-f', modelfilePath], { timeout: 30 * 60_000 });
    return { modelName, filePath: resolved, stdout, stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import GGUF model into Ollama. Details: ${message}`);
  }
}

export async function loadOllamaModel(config: AppConfig, modelName: string) {
  const res = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      prompt: ' ',
      stream: false,
      keep_alive: '30m',
      options: { num_predict: 1 }
    })
  });
  if (!res.ok) throw new Error(`Failed to load model: HTTP ${res.status} ${await res.text()}`);
  return { modelName, loaded: true };
}

export async function ejectOllamaModel(config: AppConfig, modelName: string) {
  const res = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      prompt: '',
      stream: false,
      keep_alive: 0
    })
  });
  if (!res.ok) throw new Error(`Failed to eject model: HTTP ${res.status} ${await res.text()}`);
  return { modelName, loaded: false };
}
