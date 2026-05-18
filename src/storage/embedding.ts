import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { env } from '@xenova/transformers';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { CLIO_HOME } from '../config.js';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const BUNDLED_PATH = join(__dirname, '..', '..', 'bundled-models');

function resolveCacheDir(): string {
  // Bundled models shipped with npm package
  if (existsSync(join(BUNDLED_PATH, 'Xenova', 'all-MiniLM-L6-v2', 'config.json'))) {
    return BUNDLED_PATH;
  }
  // Fall back to user-specific cache (~/.clio/models/)
  return join(CLIO_HOME, 'models');
}

export class EmbeddingService {
  private extractor: FeatureExtractionPipeline | null = null;

  async load(): Promise<void> {
    const cacheDir = resolveCacheDir();
    logger.info(`loading embedding model: ${MODEL_NAME} (cache: ${cacheDir})`);

    // Use local model path for bundled models, disable remote to avoid download attempts
    if (cacheDir === BUNDLED_PATH) {
      env.localModelPath = BUNDLED_PATH;
      env.allowRemoteModels = false;
    }

    this.extractor = await pipeline('feature-extraction', MODEL_NAME, {
      cache_dir: cacheDir,
    });
    logger.info('embedding model loaded');
  }

  isLoaded(): boolean {
    return this.extractor !== null;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) throw new Error('embedding model not loaded');
    const result = await this.extractor(text, { pooling: 'mean', normalize: true });
    return result.data as Float32Array;
  }
}
