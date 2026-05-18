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

interface SkillEntry {
  name: string;
  description: string;
  keywords: string;
  content: string;
}

// Built-in skills (project-agnostic utilities)
const BUILTIN_SKILLS: SkillEntry[] = [
  {
    name: 'Git Commit',
    description: 'Write a conventional git commit message from the staged diff.',
    keywords: 'commit,git commit,conventional commit,commit message',
    content: [
      '## Skill: Git Commit',
      '',
      'Generate a git commit message from the staged diff following conventional commits.',
      '',
      '## Instructions',
      '',
      '1. Run `git diff --cached` to get the staged diff (the caller must have staged changes)',
      "2. Write a commit message in conventional commit format:",
      '   ```',
      '   <type>(<scope>): <description>',
      '',
      '   <body>',
      '   ```',
      '3. Types: feat, fix, docs, refactor, test, chore, perf, style, ci, build, revert',
      '4. Scope is optional — use the module or file name affected',
      '5. First line under 72 characters, imperative mood ("Add" not "Added")',
      '6. Body explains what and why, not how — wrap at 72 characters',
      '7. Do NOT include a blank line before the first line',
      '',
      '## Examples',
      '',
      '```',
      'feat(auth): add OAuth2 refresh token flow',
      '',
      '- Add refresh token rotation on each use',
      '- Revoke old tokens immediately upon rotation',
      '```',
      '',
      '```',
      'fix(parser): handle null input in formatDate',
      '',
      'The formatDate helper crashed when passed null from legacy API',
      'responses. Return empty string instead.',
      '```',
    ].join('\n'),
  },
  {
    name: 'Shell Audit',
    description: 'Review a shell command for safety and correctness issues.',
    keywords: 'shell,command,bash,audit,safety,security,review',
    content: [
      '## Skill: Shell Audit',
      '',
      'Review a shell command or script for safety issues before execution.',
      '',
      '## Instructions',
      '',
      'Check for these common issues:',
      '',
      '1. **Destructive operations**: `rm -rf`, `dd`, `mkfs`, `> file` — confirm the target is correct',
      "2. **Pipe safety**: `cmd1 | cmd2` — does cmd1 failing silently corrupt data?",
      '3. **Variable quoting**: unquoted `$VAR` with spaces or glob characters can cause surprising behavior',
      '4. **Command injection**: user input in `eval`, `$(...)`, backticks',
      '5. **Relative paths**: `rm -rf ./` vs `rm -rf /` — one extra space can be catastrophic',
      '6. **Sudo usage**: is sudo needed? can the command run without root?',
      '7. **Side effects**: does the command modify system state, network, or other projects?',
      '',
      '## Output Format',
      '',
      'For each issue found:',
      '- **Severity**: HIGH / MEDIUM / LOW',
      '- **Line or command**: what to change',
      '- **Risk**: what could go wrong',
      '- **Fix**: how to make it safe',
      '',
      'If no issues found, say "No safety issues detected."',
    ].join('\n'),
  },
  {
    name: 'PR Description',
    description: 'Generate a structured pull request description from git diff.',
    keywords: 'pr,pull request,description,review,diff,changes',
    content: [
      '## Skill: PR Description',
      '',
      "Write a clear pull request description from the branch's git diff.",
      '',
      '## Instructions',
      '',
      '1. Run `git log main...HEAD --oneline` and `git diff main...HEAD --stat` for context',
      '2. Structure the description with these sections:',
      '',
      '### Title',
      'Short, descriptive, under 70 characters. Same commit type prefix convention applies.',
      '',
      '### Summary',
      '2-3 sentences: what changed, why it changed, how it changes behavior.',
      '',
      '### Changes',
      "Bullet list of meaningful change groups — group related files together, don't list every file.",
      '',
      '### Test Plan',
      'Concrete steps to verify the change works. Be specific about commands to run and expected output.',
      '',
      '### Breaking Changes (if any)',
      'Describe what breaks and migration steps.',
      '',
      '## Examples',
      '',
      '```',
      '## Summary',
      'Migrate the job queue from Bull to BullMQ for better Redis cluster support and',
      'finer concurrency control. The old Bull v3.x dependency is removed.',
      '',
      '## Changes',
      "- Replace BullQueue with BullMQ's Worker and Queue classes",
      '- Update job processor signatures to use the new Job type',
      '- Add rate limiting per queue via groupId option',
      '- Remove bull package from dependencies',
      '',
      '## Test Plan',
      '1. `npm test` — all existing tests pass',
      '2. `docker compose up redis -d && npm run dev` — verify jobs enqueue and process',
      '3. `curl localhost:3000/jobs/stats` — confirm metrics are reported',
      '',
      '## Breaking Changes',
      'None — the queue API is internal and no consumers changed.',
      '```',
    ].join('\n'),
  },
];

/**
 * Community skills from mattpocock/skills (https://github.com/mattpocock/skills).
 * Copied as-is from the original SKILL.md files — skill/ folder mirrors this list.
 *
 * to-prd        → 需求分析: Turn conversation into a PRD
 * tdd           → 测试方向: Red-green-refactor TDD loop
 * improve-codebase-architecture → 架构设计: Deep module analysis
 * zoom-out      → 查看大型项目: High-level codebase perspective
 * request-refactor-plan → 重构大型复杂项目: Tiny-commit refactoring plan
 */
const COMMUNITY_SKILLS: SkillEntry[] = [
  {
    name: 'to-prd',
    description: 'Turn the current conversation context into a PRD and publish it to the project issue tracker.',
    keywords: 'prd,requirements,spec,product requirements document,需求分析',
    content: [
      '## Skill: to-prd',
      '',
      'This skill takes the current conversation context and codebase understanding and produces a PRD. Do NOT interview the user — just synthesize what you already know.',
      '',
      '## Process',
      '',
      '1. Explore the repo to understand the current state of the codebase, if you haven\'t already. Use the project\'s domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you\'re touching.',
      '',
      '2. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.',
      '',
      '3. Write the PRD using the template below, then publish it.',
      '',
      '## PRD Template',
      '',
      '### Problem Statement',
      'The problem that the user is facing, from the user\'s perspective.',
      '',
      '### Solution',
      'The solution to the problem, from the user\'s perspective.',
      '',
      '### User Stories',
      'A numbered list of user stories in the format: "As an <actor>, I want a <feature>, so that <benefit>". This list should be extensive and cover all aspects of the feature.',
      '',
      '### Implementation Decisions',
      'A list of implementation decisions including modules to build/modify, interfaces, technical clarifications, architectural decisions, schema changes, API contracts.',
      '',
      '### Testing Decisions',
      'What makes a good test (only test external behavior, not implementation details), which modules will be tested, prior art for the tests.',
      '',
      '### Out of Scope',
      'Things that are explicitly out of scope.',
    ].join('\n'),
  },
  {
    name: 'improve-codebase-architecture',
    description: 'Find deepening opportunities in a codebase, informed by the domain language and architecture decisions.',
    keywords: 'architecture,refactoring,deep modules,codebase improvement,架构设计',
    content: [
      '## Skill: Improve Codebase Architecture',
      '',
      'Surface architectural friction and propose deepening opportunities — refactors that turn shallow modules into deep ones. The aim is testability and navigability.',
      '',
      '## Key Concepts',
      '',
      '- **Module** — anything with an interface and an implementation',
      '- **Interface** — everything a caller must know: types, invariants, error modes, ordering, config',
      '- **Depth** — leverage at the interface: a lot of behaviour behind a small interface',
      '- **Seam** — where an interface lives; a place behaviour can be altered without editing in place',
      '- **Leverage** — what callers get from depth',
      '- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place',
      '',
      '## Process',
      '',
      '### 1. Explore',
      '',
      'Read the project\'s domain glossary and any ADRs first. Use the Agent tool with subagent_type=Explore to walk the codebase.',
      '',
      'Note where you experience friction:',
      '- Where does understanding one concept require bouncing between many small modules?',
      '- Where are modules shallow — interface nearly as complex as the implementation?',
      '- Where do tightly-coupled modules leak across their seams?',
      '- Which parts of the codebase are untested, or hard to test through their current interface?',
      '',
      '### 2. Present candidates',
      '',
      'For each candidate, present: **Files** involved, **Problem** with current architecture, **Solution** in plain English, **Benefits** in terms of locality and leverage.',
      '',
      'Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"',
      '',
      '### 3. Grilling loop',
      '',
      'Once the user picks a candidate, drop into a grilling conversation. Walk the design tree — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.',
    ].join('\n'),
  },
  {
    name: 'zoom-out',
    description: 'Get broader context and a higher-level perspective on unfamiliar code sections.',
    keywords: 'navigate,codebase,overview,context,abstraction,查看大型项目,阅读代码',
    content: [
      '## Skill: Zoom Out',
      '',
      'When you don\'t know this area of code well, go up a layer of abstraction.',
      '',
      '## Instructions',
      '',
      'Give a map of all the relevant modules and callers, using the project\'s domain glossary vocabulary.',
      '',
      '1. Identify the entry points for the feature area',
      '2. Map the key modules and their relationships',
      '3. Trace the data flow through the system',
      '4. Note any architectural patterns in use',
      '5. Identify where the complexity lives',
      '',
      '## Output',
      '',
      'Provide a high-level overview that helps the reader understand how the code fits into the bigger picture. Focus on the boundaries between modules and how they communicate, not on implementation details.',
    ].join('\n'),
  },
  {
    name: 'request-refactor-plan',
    description: 'Create a detailed refactor plan with tiny commits via user interview.',
    keywords: 'refactor,refactoring,migration,plan,incremental,重构,重构计划',
    content: [
      '## Skill: Request Refactor Plan',
      '',
      'Create a detailed refactor plan through user interview, then produce an actionable plan.',
      '',
      '## Process',
      '',
      '1. Ask the user for a detailed description of the problem they want to solve and any potential ideas for solutions.',
      '2. Explore the repo to verify their assertions and understand the current state.',
      '3. Ask whether they have considered other options, and present alternatives.',
      '4. Interview the user about the implementation. Be extremely detailed and thorough.',
      '5. Hammer out the exact scope — what to change and what not to change.',
      '6. Check for test coverage. If insufficient, ask about testing plans.',
      '7. Break the implementation into a plan of tiny commits (Martin Fowler: "make each refactoring step as small as possible").',
      '',
      '## Refactor Plan Template',
      '',
      '### Problem Statement',
      'The problem from the developer\'s perspective.',
      '',
      '### Solution',
      'The solution from the developer\'s perspective.',
      '',
      '### Commits',
      'A detailed implementation plan broken into the tiniest commits possible. Each commit should leave the codebase in a working state.',
      '',
      '### Decision Document',
      'Modules to build/modify, interfaces, technical clarifications, architectural decisions, schema changes, API contracts.',
      '',
      '### Testing Decisions',
      'Which modules will be tested, prior art for the tests.',
      '',
      '### Out of Scope',
      'What is explicitly not part of this refactor.',
    ].join('\n'),
  },
  {
    name: 'tdd',
    description: 'Test-driven development with red-green-refactor loop, focused on behavior through public interfaces.',
    keywords: 'tdd,test,testing,red-green-refactor,behavior testing,测试,测试驱动',
    content: [
      '## Skill: Test-Driven Development',
      '',
      '## Philosophy',
      '',
      'Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn\'t.',
      '',
      'Good tests are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists.',
      '',
      '## Anti-Pattern: Horizontal Slices',
      '',
      'Do NOT write all tests first, then all implementation. This produces crap tests that test imagined behavior, not actual behavior.',
      '',
      'Correct approach: Vertical slices via tracer bullets. One test → one implementation → repeat.',
      '',
      '## Workflow',
      '',
      '### 1. Planning',
      '',
      'Before writing any code: confirm with user what interface changes are needed, which behaviors to test, and identify opportunities for deep modules (small interface, deep implementation).',
      '',
      '### 2. Tracer Bullet',
      '',
      'Write ONE test that confirms ONE thing: RED (write test → fails), GREEN (minimal code → passes).',
      '',
      '### 3. Incremental Loop',
      '',
      'For each remaining behavior: RED (write next test → fails), GREEN (minimal code → passes).',
      '',
      'Rules: one test at a time, only enough code to pass current test, don\'t anticipate future tests, keep tests focused on observable behavior.',
      '',
      '### 4. Refactor',
      '',
      'After all tests pass: extract duplication, deepen modules, apply SOLID principles where natural. Run tests after each refactor step.',
      '',
      '## Checklist Per Cycle',
      '',
      'Test describes behavior, not implementation. Test uses public interface only. Test would survive internal refactor. Code is minimal for this test. No speculative features added.',
    ].join('\n'),
  },
];

export class SkillEngine {
  constructor(private db: Database.Database) {
    this.seed();
  }

  /** Insert all default skills if none exist. */
  private seed(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS cnt FROM skills').get() as any;
    if (count.cnt > 0) return;

    const allSkills = [...BUILTIN_SKILLS, ...COMMUNITY_SKILLS];
    const stmt = this.db.prepare(
      `INSERT INTO skills (id, name, description, keywords, content, type)
       VALUES (?, ?, ?, ?, ?, 'builtin')`
    );

    for (const skill of allSkills) {
      stmt.run(randomUUID(), skill.name, skill.description, skill.keywords, skill.content);
    }

    logger.info(`skill: ${allSkills.length} default skills seeded`);
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
