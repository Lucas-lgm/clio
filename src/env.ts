import { homedir } from 'os';
import { join } from 'path';
import { getClioHome } from './config.js';

/** Paths for all environment data managed by clio. */
export function envPaths() {
  const home = homedir();
  const claudeDir = join(home, '.claude');
  const clioHome = getClioHome();

  return {
    claudeDir,
    claudeSettings: join(claudeDir, 'settings.json'),
    claudeGlobals: join(claudeDir, 'CLAUDE.md'),
    userSkillsDir: join(claudeDir, 'skills'),
    pluginsDir: join(claudeDir, 'plugins', 'cache'),
    clioHome,
    clioConfig: join(clioHome, 'config.json'),
    clioDbDir: join(clioHome, 'data'),
    clioDb: join(clioHome, 'data', 'clio.db'),
  };
}
