import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, ChunkRecord, IndexedFolder } from './types.js';

const foldersFile = (config: AppConfig) => path.join(config.dataDir, 'folders.json');
const chunksFile = (config: AppConfig) => path.join(config.dataDir, 'chunks.json');

async function ensureDataDir(config: AppConfig) {
  await fs.mkdir(config.dataDir, { recursive: true });
}

export async function loadFolders(config: AppConfig): Promise<IndexedFolder[]> {
  await ensureDataDir(config);
  try {
    return JSON.parse(await fs.readFile(foldersFile(config), 'utf8')) as IndexedFolder[];
  } catch {
    return [];
  }
}

export async function saveFolders(config: AppConfig, folders: IndexedFolder[]) {
  await ensureDataDir(config);
  await fs.writeFile(foldersFile(config), JSON.stringify(folders, null, 2), 'utf8');
}

async function resolveDirectory(folderPath: string) {
  const resolved = path.resolve(folderPath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error('Path is not a directory');
  return resolved;
}

export function isInsideFolder(filePath: string, folderPath: string) {
  const relative = path.relative(folderPath, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function filterChunksForFolders(chunks: ChunkRecord[], folders: IndexedFolder[]) {
  return chunks.filter(chunk => folders.some(folder => isInsideFolder(chunk.metadata.filePath, folder.path)));
}

export async function addFolder(config: AppConfig, folderPath: string) {
  const resolved = await resolveDirectory(folderPath);
  const folders = await loadFolders(config);
  if (!folders.some(f => f.path.toLowerCase() === resolved.toLowerCase())) {
    folders.push({ path: resolved, addedAt: new Date().toISOString() });
    await saveFolders(config, folders);
  }
  return folders;
}

export async function replaceFolders(config: AppConfig, folderPath: string) {
  const resolved = await resolveDirectory(folderPath);
  const folders = [{ path: resolved, addedAt: new Date().toISOString() }];
  await saveFolders(config, folders);
  await saveChunks(config, []);
  return folders;
}

export async function removeFolder(config: AppConfig, folderPath: string) {
  const resolved = path.resolve(folderPath);
  const folders = await loadFolders(config);
  const nextFolders = folders.filter(f => f.path.toLowerCase() !== resolved.toLowerCase());
  const chunks = await loadChunks(config);
  const nextChunks = chunks.filter(chunk => !isInsideFolder(chunk.metadata.filePath, resolved));
  await saveFolders(config, nextFolders);
  await saveChunks(config, nextChunks);
  return nextFolders;
}

export async function clearFolders(config: AppConfig) {
  await saveFolders(config, []);
  await saveChunks(config, []);
  return [];
}

export async function loadChunks(config: AppConfig): Promise<ChunkRecord[]> {
  await ensureDataDir(config);
  try {
    return JSON.parse(await fs.readFile(chunksFile(config), 'utf8')) as ChunkRecord[];
  } catch {
    return [];
  }
}

export async function saveChunks(config: AppConfig, chunks: ChunkRecord[]) {
  await ensureDataDir(config);
  await fs.writeFile(chunksFile(config), JSON.stringify(chunks), 'utf8');
}

export function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
