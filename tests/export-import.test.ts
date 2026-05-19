import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, cpSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

const DIST = join(__dirname, '..', 'dist');
const CLI = join(DIST, 'index.js');

let tmpExportDir: string;
let tmpImportDir: string;
let archivePath: string;

/** Create a minimal mock clio environment under HOME. */
function createMockEnvironment(base: string): void {
  // ~/.clio/ (via CLIO_HOME)
  mkdirSync(join(base, 'data'), { recursive: true });
  writeFileSync(join(base, 'config.json'), JSON.stringify({ version: '0.1.0' }));

  // ~/.claude/
  const claude = join(base, '.claude');
  mkdirSync(claude);
  writeFileSync(join(claude, 'settings.json'), JSON.stringify({ key: 'test' }));
  writeFileSync(join(claude, 'CLAUDE.md'), '# Test config');

  // ~/.claude/skills/
  const skills = join(claude, 'skills');
  mkdirSync(skills);
  writeFileSync(join(skills, 'test-skill.md'), '# Test Skill\n\nA test skill.');
}

describe('Export/Import CLI', () => {
  beforeAll(() => {
    tmpExportDir = join(tmpdir(), `clio-test-export-${randomUUID().slice(0, 8)}`);
    tmpImportDir = join(tmpdir(), `clio-test-import-${randomUUID().slice(0, 8)}`);
    archivePath = join(tmpdir(), `clio-test-${randomUUID().slice(0, 8)}.tar.gz`);

    createMockEnvironment(tmpExportDir);
    createMockEnvironment(tmpImportDir);
  });

  afterAll(() => {
    execSync(`rm -rf ${tmpExportDir} ${tmpImportDir} ${archivePath} 2>/dev/null || true`);
  });

  it('should export environment', () => {
    const result = execSync(
      `node ${CLI} export ${archivePath}`,
      {
        env: {
          ...process.env,
          CLIO_HOME: tmpExportDir,
          HOME: tmpExportDir,
          NODE_ENV: 'test',
        },
      }
    );

    expect(result.toString()).toContain('exporting');
    expect(existsSync(archivePath)).toBe(true);
  });

  it('should show import dry-run plan', () => {
    const result = execSync(
      `node ${CLI} import ${archivePath} --dry-run`,
      {
        env: {
          ...process.env,
          CLIO_HOME: tmpImportDir,
          HOME: tmpImportDir,
          NODE_ENV: 'test',
        },
        encoding: 'utf-8',
      }
    );

    expect(result).toContain('Archive:');
    expect(result).toContain('Dry-run');
  });

  it('should show import help when no path given', () => {
    expect(() => {
      execSync(`node ${CLI} import`, { encoding: 'utf-8', env: { ...process.env, NODE_ENV: 'test' } });
    }).toThrow('Usage: clio import');
  });

  it('should import with --force', () => {
    const result = execSync(
      `node ${CLI} import ${archivePath} --force`,
      {
        env: {
          ...process.env,
          CLIO_HOME: tmpImportDir,
          HOME: tmpImportDir,
          NODE_ENV: 'test',
        },
        encoding: 'utf-8',
      }
    );

    expect(result).toContain('restored');
    expect(existsSync(join(tmpImportDir, '.claude', 'settings.json'))).toBe(true);
  });

  it('should handle invalid archive', () => {
    const fakePath = join(tmpdir(), `fake-${randomUUID().slice(0, 8)}.tar.gz`);
    writeFileSync(fakePath, 'not-a-tar');
    expect(() => {
      execSync(`node ${CLI} import ${fakePath}`, {
        env: { ...process.env, NODE_ENV: 'test' },
        encoding: 'utf-8',
      });
    }).toThrow();
  });
});

describe('Export/Import via API', () => {
  let tmpHome: string;
  let outPath: string;

  beforeAll(async () => {
    tmpHome = join(tmpdir(), `clio-test-api-${randomUUID().slice(0, 8)}`);
    outPath = join(tmpdir(), `clio-test-api-${randomUUID().slice(0, 8)}.tar.gz`);
    createMockEnvironment(tmpHome);
  });

  afterAll(() => {
    execSync(`rm -rf ${tmpHome} ${outPath} 2>/dev/null || true`);
  });

  it('import rejects a non-existent archive', async () => {
    const { importEnvironment } = await import('../dist/import.js');
    expect(() => importEnvironment('/nonexistent/archive.tar.gz')).toThrow();
  });
});

describe('CLI command routing', () => {
  it('should show usage for no command', () => {
    const result = execSync(`node ${CLI}`, { encoding: 'utf-8' });
    expect(result).toContain('Usage');
    expect(result).toMatch(/install|start|stop|status|download-models|export|import/);
  });

  it('should show status when not installed', () => {
    const result = execSync(`node ${CLI} status`, {
      env: { ...process.env, CLIO_HOME: '/tmp/clio-nonexistent-test', NODE_ENV: 'test' },
      encoding: 'utf-8',
    });
    expect(result).toContain('not installed');
  });
});
