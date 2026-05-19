import type Database from 'better-sqlite3';

export interface SkillManifest {
  name: string;
  description: string;
}

export interface Skill extends SkillManifest {
  id: string;
  content: string;
  type: string;
  usage_count: number;
  success_count: number;
}

/**
 * SkillEngine — no default skills bundled.
 * Clio relies entirely on the Claude Code ecosystem (superpowers, ~/.claude/skills/).
 * Import/export for environment migration is planned.
 */
export class SkillEngine {
  constructor(private db: Database.Database) {}

  getManifest(): SkillManifest[] {
    return [];
  }

  getSkill(_name: string): Skill | null {
    return null;
  }

  recordOutcome(_name: string, _success: boolean): void {}
}
