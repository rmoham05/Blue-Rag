import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { embedText } from './ollama.js';
import { filterChunksForFolders, loadChunks, loadFolders, saveChunks } from './store.js';
import { chunkText, extractText, supportedExtensions } from './text.js';
import type { AppConfig, ChunkRecord, IndexStatus } from './types.js';

export const indexStatus: IndexStatus = {
  running: false,
  filesSeen: 0,
  filesIndexed: 0,
  chunksIndexed: 0,
  errors: []
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function walk(dir: string, onError: (file: string, message: string) => void): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    onError(dir, `Could not read folder: ${errorMessage(error)}`);
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', '__pycache__'].includes(entry.name)) continue;
      files.push(...await walk(full, onError));
    } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

async function sha256(filePath: string) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function runIndex(config: AppConfig) {
  if (indexStatus.running) throw new Error('Indexing is already running');

  indexStatus.running = true;
  indexStatus.startedAt = new Date().toISOString();
  indexStatus.finishedAt = undefined;
  indexStatus.filesSeen = 0;
  indexStatus.filesIndexed = 0;
  indexStatus.chunksIndexed = 0;
  indexStatus.errors = [];

  try {
    const folders = await loadFolders(config);
    const existing = filterChunksForFolders(await loadChunks(config), folders);
    const existingByFile = new Map<string, ChunkRecord[]>();
    for (const chunk of existing) {
      const list = existingByFile.get(chunk.metadata.filePath) ?? [];
      list.push(chunk);
      existingByFile.set(chunk.metadata.filePath, list);
    }

    let nextChunks = [...existing];

    for (const folder of folders) {
      const files = await walk(folder.path, (file, message) => {
        indexStatus.errors.push({ file, message });
      });

      for (const filePath of files) {
        indexStatus.filesSeen += 1;
        try {
          const stat = await fs.stat(filePath);
          const hash = await sha256(filePath);
          const oldChunks = existingByFile.get(filePath);
          if (oldChunks?.[0]?.metadata.sha256 === hash) continue;

          const text = await extractText(filePath);
          const chunks = chunkText(text, config.chunkChars, config.chunkOverlap);
          const fileChunks: ChunkRecord[] = [];

          for (let i = 0; i < chunks.length; i++) {
            const embedding = await embedText(config, chunks[i]);
            fileChunks.push({
              id: crypto.randomUUID(),
              text: chunks[i],
              embedding,
              metadata: {
                filePath,
                fileName: path.basename(filePath),
                extension: path.extname(filePath).toLowerCase(),
                modifiedMs: stat.mtimeMs,
                sizeBytes: stat.size,
                sha256: hash,
                chunkIndex: i
              }
            });
          }

          nextChunks = nextChunks.filter(c => c.metadata.filePath !== filePath);
          nextChunks.push(...fileChunks);
          indexStatus.filesIndexed += 1;
          indexStatus.chunksIndexed += fileChunks.length;
          await saveChunks(config, nextChunks);
        } catch (error) {
          indexStatus.errors.push({ file: filePath, message: errorMessage(error) });
        }
      }
    }

    await saveChunks(config, nextChunks);
  } finally {
    indexStatus.running = false;
    indexStatus.finishedAt = new Date().toISOString();
  }

  return indexStatus;
}
