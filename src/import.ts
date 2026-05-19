import { existsSync, mkdirSync, cpSync, readFileSync, rmSync, renameSync, writeFileSync, readdirSync } from 'fs';
import { dirname, join, sep } from 'path';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { envPaths } from './env.js';
import { logger } from './logger.js';

interface Manifest {
  version: string;
  createdAt: string;
  files: string[];
  clioVersion: string;
}

interface ImportPlan {
  manifest: Manifest;
  files: { source: string; target: string; exists: boolean }[];
  conflicts: { source: string; target: string }[];
}

function extractArchive(inputPath: string, dest: string): Manifest {
  const result = spawnSync('tar', ['xzf', inputPath, '-C', dest], { stdio: 'pipe' });
  if (result.status !== 0) {
    const msg = result.stderr?.toString() || 'unknown error';
    throw new Error(`tar extraction failed: ${msg}`);
  }

  // The archive contains a single top-level dir (clio-env/)
  const topDir = join(dest, 'clio-env');
  const manifestPath = join(topDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('invalid archive: manifest.json not found');
  }

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (manifest.version !== '1') {
    throw new Error(`unsupported export version: ${manifest.version}`);
  }
  return manifest;
}

/** Find the version subdirectory for a plugin (e.g. superpowers/5.1.0/). */
function resolvePluginDir(org: string, pluginName: string): string | null {
  const pluginDir = join(envPaths().pluginsDir, org, pluginName);
  if (!existsSync(pluginDir)) return null;

  try {
    const entries = readdirSync(pluginDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) return join(pluginDir, e.name);
    }
  } catch { /* ignore */ }
  return null;
}

/** Map archive paths to real filesystem paths. */
function resolveTarget(archivePath: string): string | null {
  const paths = envPaths();

  const prefixMap: Record<string, string> = {
    'claude/settings.json': paths.claudeSettings,
    'claude/CLAUDE.md': paths.claudeGlobals,
    'clio/config.json': paths.clioConfig,
    'clio/db.sqlite': paths.clioDb,
  };

  // Direct matches first
  if (prefixMap[archivePath]) return prefixMap[archivePath];

  // Skills: claude/skills/*.md → ~/.claude/skills/
  const skillMatch = archivePath.match(/^claude\/skills\/(.+\.md)$/);
  if (skillMatch) return join(paths.userSkillsDir, skillMatch[1]);

  // Plugin skills: plugins/<org>/<name>/skills/<skill>/SKILL.md
  // → ~/.claude/plugins/cache/<org>/<name>/<version>/skills/<skill>/SKILL.md
  const pluginMatch = archivePath.match(/^plugins\/([^/]+)\/([^/]+)\/skills\/(.+)$/);
  if (pluginMatch) {
    const [, org, pluginName, rest] = pluginMatch;
    const pluginDir = resolvePluginDir(org, pluginName);
    if (pluginDir) return join(pluginDir, 'skills', rest);
  }

  return null;
}

function buildPlan(inputPath: string, workDir: string): ImportPlan {
  const rootDir = join(workDir, 'clio-env');
  const manifest = extractArchive(inputPath, workDir);

  const files: ImportPlan['files'] = [];
  const conflicts: ImportPlan['conflicts'] = [];

  for (const f of manifest.files) {
    if (f === 'manifest.json') continue;
    const source = join(rootDir, f);
    const target = resolveTarget(f);
    if (!target) continue;

    const exists = existsSync(target);
    files.push({ source, target, exists });

    if (exists) {
      conflicts.push({ source, target });
    }
  }

  return { manifest, files, conflicts };
}

export function importEnvironment(inputPath: string, options?: { dryRun?: boolean; force?: boolean }): void {
  const dryRun = options?.dryRun ?? false;
  const force = options?.force ?? false;
  const workDir = join(tmpdir(), `clio-import-${randomUUID().slice(0, 8)}`);

  try {
    mkdirSync(workDir, { recursive: true });
    const plan = buildPlan(inputPath, workDir);

    // --- Summary ---
    console.log(`\n  Archive:  ${inputPath}`);
    console.log(`  Created:  ${plan.manifest.createdAt.slice(0, 10)}`);
    console.log(`  Files:    ${plan.files.length}`);
    console.log(`  Conflicts: ${plan.conflicts.length}`);

    if (plan.conflicts.length > 0) {
      console.log('\n  Existing files that will be overwritten:');
      for (const c of plan.conflicts) {
        console.log(`    ${c.target}`);
      }
    }

    if (dryRun) {
      console.log('\n  Dry-run — no changes made.');
      return;
    }

    if (plan.conflicts.length > 0 && !force) {
      console.log('\n  Use --force to overwrite, or --dry-run to preview.');
      return;
    }

    // --- Execute ---
    let restored = 0;
    for (const f of plan.files) {
      if (f.target) {
        mkdirSync(dirname(f.target), { recursive: true });

        // Backup existing file
        if (f.exists && force) {
          const bak = f.target + '.bak';
          if (!existsSync(bak)) {
            renameSync(f.target, bak);
          }
        }

        cpSync(f.source, f.target);
        restored++;
      }
    }

    // Restore clio DB: must ensure parent dir exists
    const clioDbDir = dirname(envPaths().clioDb);
    mkdirSync(clioDbDir, { recursive: true });

    logger.info(`imported: ${restored} files restored to ${inputPath}`);
    console.log(`\n  ✓ ${restored} files restored. Start a new Claude Code session.`);

  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
