import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.resolve(projectRoot, 'release');
const relativeReleaseDir = path.relative(projectRoot, releaseDir);

if (relativeReleaseDir !== 'release' || path.isAbsolute(relativeReleaseDir) || relativeReleaseDir.startsWith('..')) {
  throw new Error(`Refusing to clean unexpected release path: ${releaseDir}`);
}

await fs.rm(releaseDir, { recursive: true, force: true });
await fs.mkdir(releaseDir, { recursive: true });
console.log(`Cleaned ${releaseDir}`);
