import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './types.js';

const modelConfigFile = (config: AppConfig) => path.join(config.dataDir, 'model-config.json');

type ModelConfigPatch = Pick<AppConfig, 'llmModel' | 'embedModel'>;

export async function loadModelConfig(config: AppConfig) {
  try {
    const raw = JSON.parse(await fs.readFile(modelConfigFile(config), 'utf8')) as Partial<ModelConfigPatch>;
    if (raw.llmModel) config.llmModel = raw.llmModel;
    if (raw.embedModel) config.embedModel = raw.embedModel;
  } catch {
    // First run: no saved override yet.
  }
  return config;
}

export async function saveModelConfig(config: AppConfig, patch: Partial<ModelConfigPatch>) {
  await fs.mkdir(config.dataDir, { recursive: true });
  if (patch.llmModel) config.llmModel = patch.llmModel;
  if (patch.embedModel) config.embedModel = patch.embedModel;
  await fs.writeFile(modelConfigFile(config), JSON.stringify({
    llmModel: config.llmModel,
    embedModel: config.embedModel
  }, null, 2), 'utf8');
  return { llmModel: config.llmModel, embedModel: config.embedModel };
}
