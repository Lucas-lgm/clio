import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { envPaths } from './env.js';
import { getDb, closeDb } from './storage/database.js';
import { getClioHome } from './config.js';
import { logger } from './logger.js';

interface Manifest {
  version: string;
  createdAt: string;
  files: string[];
  clioVersion: string;
}

const EXPORT_VERSION = '1';

/** Collect plugin skill files into export dir. */
function copyPluginSkills(exportDir: string): number {
  const paths = envPaths();
  let count = 0;

  try {
    const entries = readdirSync(paths.pluginsDir, { withFileTypes: true });
    for (const org of entries) {
      if (!org.isDirectory()) continue;
      const orgDir = join(paths.pluginsDir, org.name);
      try {
        const plugins = readdirSync(orgDir, { withFileTypes: true });
        for (const plugin of plugins) {
          if (!plugin.isDirectory()) continue;
          // Look for skills/ subdirectory within plugin versions
          const pluginDir = join(orgDir, plugin.name);
          const skillsDir = findPluginSkillsDir(pluginDir);
          if (!skillsDir) continue;

          const pluginName = plugin.name.replace(/^\d+\.\d+\.\d+\/?$/, '').trim() || plugin.name;
          const targetBase = join(exportDir, 'plugins', org.name, pluginName, 'skills');

          const skillDirs = readdirSync(skillsDir, { withFileTypes: true });
          for (const skill of skillDirs) {
            if (!skill.isDirectory()) continue;
            const skillFile = join(skillsDir, skill.name, 'SKILL.md');
            if (!existsSync(skillFile)) continue;
            const targetDir = join(targetBase, skill.name);
            mkdirSync(targetDir, { recursive: true });
            cpSync(skillFile, join(targetDir, 'SKILL.md'));
            count++;
          }
        }
      } catch { /* skip problematic plugins */ }
    }
  } catch { /* plugins dir may not exist */ }

  return count;
}

/** Recursively find a skills/ subdirectory (may be nested under version). */
function findPluginSkillsDir(dir: string): string | null {
  const direct = join(dir, 'skills');
  if (existsSync(direct)) return direct;

  // Check one level deeper (version dir structure)
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = join(dir, entry.name, 'skills');
      if (existsSync(nested)) return nested;
    }
  } catch { /* ignore */ }
  return null;
}

function copyUserSkills(exportDir: string): number {
  const paths = envPaths();
  const target = join(exportDir, 'claude', 'skills');
  try {
    const files = readdirSync(paths.userSkillsDir);
    mkdirSync(target, { recursive: true });
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      cpSync(join(paths.userSkillsDir, f), join(target, f));
    }
    return files.filter(f => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

function checkpointDb(): void {
  const db = getDb();
  db.pragma('wal_checkpoint(TRUNCATE)');
  closeDb();
}

export function exportEnvironment(outputPath?: string): string {
  const outPath = outputPath ?? join(process.cwd(), `clio-env-${new Date().toISOString().slice(0, 10)}.tar.gz`);
  const workDir = join(tmpdir(), `clio-export-${randomUUID().slice(0, 8)}`);
  const exportRoot = join(workDir, 'clio-env');

  try {
    mkdirSync(exportRoot, { recursive: true });

    // 1. Claude settings
    const paths = envPaths();
    if (existsSync(paths.claudeSettings)) {
      const target = join(exportRoot, 'claude', 'settings.json');
      mkdirSync(dirname(target), { recursive: true });
      cpSync(paths.claudeSettings, target);
    }

    // 2. CLAUDE.md
    if (existsSync(paths.claudeGlobals)) {
      const target = join(exportRoot, 'claude', 'CLAUDE.md');
      mkdirSync(dirname(target), { recursive: true });
      cpSync(paths.claudeGlobals, target);
    }

    // 3. User skills
    const userSkills = copyUserSkills(exportRoot);

    // 4. Plugin skills
    const pluginSkills = copyPluginSkills(exportRoot);

    // 5. clio config
    if (existsSync(paths.clioConfig)) {
      const target = join(exportRoot, 'clio', 'config.json');
      mkdirSync(dirname(target), { recursive: true });
      cpSync(paths.clioConfig, target);
    }

    // 6. clio DB
    checkpointDb();
    if (existsSync(paths.clioDb)) {
      const target = join(exportRoot, 'clio', 'db.sqlite');
      mkdirSync(dirname(target), { recursive: true });
      cpSync(paths.clioDb, target);
    }

    // 7. Write manifest
    const allFiles: string[] = [];
    collectFiles(exportRoot, exportRoot, allFiles);
    const manifest: Manifest = {
      version: EXPORT_VERSION,
      createdAt: new Date().toISOString(),
      files: allFiles,
      clioVersion: '0.1.0',
    };
    writeFileSync(join(exportRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 8. Archive
    const result = spawnSync('tar', ['czf', resolve(outPath), '-C', workDir, 'clio-env'], {
      stdio: 'pipe',
    });

    if (result.status !== 0) {
      const msg = result.stderr?.toString() || 'unknown error';
      throw new Error(`tar failed: ${msg}`);
    }

    const stats = existsSync(outPath) ? readFileSync(outPath).length : 0;
    logger.info(`exported: ${outPath} (${(stats / 1024 / 1024).toFixed(1)} MB, ${manifest.files.length} files)`);

    return outPath;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function collectFiles(dir: string, base: string, acc: string[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        collectFiles(full, base, acc);
      } else {
        acc.push(relative(base, full));
      }
    }
  } catch { /* ignore */ }
}
