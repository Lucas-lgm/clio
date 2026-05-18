import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const CLIO_HOME = join(homedir(), '.clio');

export interface ClioConfig {
  recall: {
    budget_session_start: number;
    budget_per_query: number;
    top_k_startup: number;
    top_k_realtime: number;
  };
  capture: {
    sensitivity: 'high' | 'medium' | 'low';
    max_tool_output_chars: number;
    dedup_window_seconds: number;
  };
  decay: {
    confidence_decay_per_30d: number;
    archive_threshold: number;
    instinct_ttl_days: number;
  };
  storage: {
    max_semantic_memories: number;
  };
}

const DEFAULT_CONFIG: ClioConfig = {
  recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
  capture: { sensitivity: 'medium', max_tool_output_chars: 2048, dedup_window_seconds: 300 },
  decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 },
  storage: { max_semantic_memories: 500 },
};

export function loadConfig(): ClioConfig {
  const configPath = join(CLIO_HOME, 'config.json');
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
}

export function getClioHome(): string {
  return process.env.CLIO_HOME ?? join(homedir(), '.clio');
}

export function ensureClioHome(): void {
  const clioHome = getClioHome();
  mkdirSync(clioHome, { recursive: true });
  mkdirSync(join(clioHome, 'data'), { recursive: true });
  mkdirSync(join(clioHome, 'models'), { recursive: true });
}
