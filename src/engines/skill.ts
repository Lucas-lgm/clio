import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

export interface SkillManifest {
  name: string;
  description: string;
  keywords: string;
}

export interface Skill extends SkillManifest {
  id: string;
  content: string;
  type: string;
  usage_count: number;
  success_count: number;
}

const DEFAULT_SKILLS: Omit<Skill, 'id' | 'usage_count' | 'success_count' | 'type'>[] = [
  {
    name: 'Git Commit',
    description: 'Write a conventional git commit message from the staged diff.',
    keywords: 'commit,git commit,conventional commit,commit message',
    content: `## Skill: Git Commit

Generate a git commit message from the staged diff following conventional commits.

## Instructions

1. Run \`git diff --cached\` to get the staged diff (the caller must have staged changes)
2. Write a commit message in conventional commit format:
   \`\`\`
   <type>(<scope>): <description>

   <body>
   \`\`\`
3. Types: feat, fix, docs, refactor, test, chore, perf, style, ci, build, revert
4. Scope is optional — use the module or file name affected
5. First line under 72 characters, imperative mood ("Add" not "Added")
6. Body explains what and why, not how — wrap at 72 characters
7. Do NOT include a blank line before the first line

## Examples

\`\`\`
feat(auth): add OAuth2 refresh token flow

- Add refresh token rotation on each use
- Revoke old tokens immediately upon rotation
\`\`\`

\`\`\`
fix(parser): handle null input in formatDate

The formatDate helper crashed when passed null from legacy API
responses. Return empty string instead.
\`\`\``,
  },
  {
    name: 'Shell Audit',
    description: 'Review a shell command for safety and correctness issues.',
    keywords: 'shell,command,bash,audit,safety,security,review',
    content: `## Skill: Shell Audit

Review a shell command or script for safety issues before execution.

## Instructions

Check for these common issues:

1. **Destructive operations**: \`rm -rf\`, \`dd\`, \`mkfs\`, \`> file\` — confirm the target is correct
2. **Pipe safety**: \`cmd1 | cmd2\` — does cmd1 failing silently corrupt data?
3. **Variable quoting**: unquoted \`$VAR\` with spaces or glob characters can cause surprising behavior
4. **Command injection**: user input in \`eval\`, \`$(...)\`, backticks
5. **Relative paths**: \`rm -rf ./\` vs \`rm -rf /\` — one extra space can be catastrophic
6. **Sudo usage**: is sudo needed? can the command run without root?
7. **Side effects**: does the command modify system state, network, or other projects?

## Output Format

For each issue found:
- **Severity**: HIGH / MEDIUM / LOW
- **Line or command**: what to change
- **Risk**: what could go wrong
- **Fix**: how to make it safe

If no issues found, say "No safety issues detected."`,
  },
  {
    name: 'PR Description',
    description: 'Generate a structured pull request description from git diff.',
    keywords: 'pr,pull request,description,review,diff,changes',
    content: `## Skill: PR Description

Write a clear pull request description from the branch's git diff.

## Instructions

1. Run \`git log main...HEAD --oneline\` and \`git diff main...HEAD --stat\` for context
2. Structure the description with these sections:

### Title
Short, descriptive, under 70 characters. Same commit type prefix convention applies.

### Summary
2-3 sentences: what changed, why it changed, how it changes behavior.

### Changes
Bullet list of meaningful change groups — group related files together, don't list every file.

### Test Plan
Concrete steps to verify the change works. Be specific about commands to run and expected output.

### Breaking Changes (if any)
Describe what breaks and migration steps.

## Examples

\`\`\`
## Summary
Migrate the job queue from Bull to BullMQ for better Redis cluster support and
finer concurrency control. The old Bull v3.x dependency is removed.

## Changes
- Replace BullQueue with BullMQ's Worker and Queue classes
- Update job processor signatures to use the new Job type
- Add rate limiting per queue via groupId option
- Remove bull package from dependencies

## Test Plan
1. \`npm test\` — all existing tests pass
2. \`docker compose up redis -d && npm run dev\` — verify jobs enqueue and process
3. \`curl localhost:3000/jobs/stats\` — confirm metrics are reported

## Breaking Changes
None — the queue API is internal and no consumers changed.
\`\`\``,
  },
];

export class SkillEngine {
  constructor(private db: Database.Database) {
    this.seed();
  }

  /** Insert default built-in skills if none exist. */
  private seed(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS cnt FROM skills').get() as any;
    if (count.cnt > 0) return;

    const stmt = this.db.prepare(
      `INSERT INTO skills (id, name, description, keywords, content, type)
       VALUES (?, ?, ?, ?, ?, 'builtin')`
    );

    for (const skill of DEFAULT_SKILLS) {
      stmt.run(randomUUID(), skill.name, skill.description, skill.keywords, skill.content);
    }

    logger.info(`skill: ${DEFAULT_SKILLS.length} default skills seeded`);
  }

  /** Get lightweight manifest for startup injection. */
  getManifest(): SkillManifest[] {
    return this.db.prepare(
      'SELECT name, description, keywords FROM skills ORDER BY type, name'
    ).all() as SkillManifest[];
  }

  /** Get full skill content by name. */
  getSkill(name: string): Skill | null {
    const record = this.db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as Skill | undefined;
    if (!record) return null;
    this.db.prepare('UPDATE skills SET usage_count = usage_count + 1 WHERE name = ?').run(name);
    return record;
  }

  /** Record skill usage outcome for evolution tracking. */
  recordOutcome(name: string, success: boolean): void {
    if (success) {
      this.db.prepare('UPDATE skills SET success_count = success_count + 1 WHERE name = ?').run(name);
    }
  }

  /** Get usage statistics for all skills. */
  getStats(): { name: string; usage: number; success: number; type: string }[] {
    return this.db.prepare(
      "SELECT name, usage_count AS usage, success_count AS success, type FROM skills ORDER BY usage_count DESC"
    ).all() as any[];
  }
}
