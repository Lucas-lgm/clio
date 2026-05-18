import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { join } from 'path';
import { CLIO_HOME } from '../config.js';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

export class EmbeddingService {
  private extractor: FeatureExtractionPipeline | null = null;

  async load(): Promise<void> {
    this.extractor = await pipeline('feature-extraction', MODEL_NAME, {
      cache_dir: join(CLIO_HOME, 'models'),
    });
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
