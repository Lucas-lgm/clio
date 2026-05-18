#!/usr/bin/env node
/**
 * Pre-download the embedding model and bundle it into the project.
 * Uses curl to respect HTTP_PROXY/HTTPS_PROXY env vars.
 * Run: npx tsx scripts/download-model.ts
 */
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main';
const OUT = join(__dirname, '..', 'bundled-models', 'Xenova', 'all-MiniLM-L6-v2');

const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
];

function download(url: string, dest: string): void {
  if (existsSync(dest)) {
    console.log(`  skip (exists): ${dest}`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  console.log(`  downloading: ${url}`);
  execSync(`curl -fsSL --connect-timeout 30 -o "${dest}" "${url}"`, {
    stdio: 'inherit',
    env: { ...process.env }, // respects HTTP_PROXY / HTTPS_PROXY
  });
  console.log(`  saved: ${dest}`);
}

function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`Downloading Xenova/all-MiniLM-L6-v2 to ${OUT}...`);
  for (const file of FILES) {
    download(`${BASE}/${file}`, join(OUT, file));
  }
  console.log('Done. Model bundled at', join(__dirname, '..', 'bundled-models'));
}

main();
