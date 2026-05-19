import { createHash } from 'crypto';

const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/api[_-]?key["']?\s*[:=]\s*["']?[\w-]{16,}/gi, 'API_KEY_REDACTED'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS_KEY_REDACTED'],
  [/sk-[a-zA-Z0-9]{20,}/g, 'OPENAI_KEY_REDACTED'],
  [/ghp_[A-Za-z0-9_]{36}/g, 'GITHUB_TOKEN_REDACTED'],
  [/\/Users\/[^/\s]+\//g, '/Users/[USER]/'],
];

export function redact(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
