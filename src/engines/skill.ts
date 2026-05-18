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
  {
    name: 'Requirements Analysis',
    description: 'Analyze requirements, identify gaps, and produce structured specifications.',
    keywords: 'requirement,analysis,spec,specification,PRD,需求分析,需求文档',
    content: `## Skill: Requirements Analysis

Analyze a feature request or problem description to produce a clear, structured specification.

## Instructions

1. Identify **core goal** — what is the user actually trying to achieve?
2. List **constraints** — technical, business, timeline, resource
3. Surface **unstated assumptions** — what does the requester take for granted?
4. Identify **ambiguities** — terms or behaviors that could be interpreted differently
5. Extract **success criteria** — how will we know it's done?
6. Note **risks and dependencies** — what could go wrong, what must exist first

## Output Format

Present findings as:

- **Goal**: one-sentence summary
- **Constraints**: bullet list
- **Assumptions**: bullet list (flag each as safe / risky / unknown)
- **Open Questions**: numbered list of things to clarify with the requester
- **Success Criteria**: bullet list (each must be measurable)
- **Risks**: bullet list with severity

## Quality Checks

- Does every requirement have a clear "why"?
- Can you write a test for each success criterion?
- Could two developers build incompatible solutions from this spec?`,
  },
  {
    name: 'Architecture Design',
    description: 'Design system architecture with clear component boundaries, data flow, and trade-offs.',
    keywords: 'architecture,design,system design,component,module,structure,架构设计',
    content: `## Skill: Architecture Design

Design system architecture following proven patterns with clear rationale.

## Instructions

1. **Understand the problem** — what functions must the system perform?
2. **Identify boundaries** — what are the natural seams in the problem?
3. **Define components** — each component has one responsibility and a well-defined interface
4. **Map data flow** — how does data enter, transform, and leave each component?
5. **Choose patterns** — justify each pattern choice with concrete benefits
6. **Address cross-cutting concerns** — error handling, logging, auth, observability

## Design Principles

- **Separation of concerns**: each module does one thing
- **Dependency direction**: depend on abstractions, not concretions; point inward
- **Error boundaries**: a failure in one component should not crash unrelated components
- **Testability**: can each component be tested in isolation?

## Output Format

### Architecture Diagram (ASCII)

\`\`\`
┌─────────┐     ┌──────────┐     ┌─────────┐
│  Input  │────▶│  Core    │────▶│ Output  │
└─────────┘     └──────────┘     └─────────┘
                      │
                      ▼
                ┌──────────┐
                │ Storage  │
                └──────────┘
\`\`\`

### Component Registry

| Component | Responsibility | Interface | Dependencies |
|-----------|---------------|-----------|-------------|
| Parser    | Parse input   | parse()   | Tokenizer   |

### Data Flow

Describe the lifecycle of a single request/event through the system.

### Trade-offs

List design decisions and what was sacrificed for each.`,
  },
  {
    name: 'Codebase Navigation',
    description: 'Navigate and understand large codebases: find entry points, trace data flow, map module dependencies.',
    keywords: 'codebase,navigate,explore,understand,large project,entry point,data flow,查看代码,阅读代码',
    content: `## Skill: Codebase Navigation

Navigate unfamiliar large codebases efficiently to find relevant code and understand structure.

## Instructions

1. **Find entry points** — \`package.json\` (main/bin), \`index.ts\`, \`main.ts\`, CLI entry point
2. **Map top-level structure** — list top-level directories, read directory names as module hints
3. **Trace a data flow end-to-end** — pick one feature, trace from input to output
4. **Identify key abstractions** — base classes, interfaces, types that appear everywhere
5. **Read tests first** — tests document how code is actually used
6. **Check configuration** — \`tsconfig.json\`, \`Dockerfile\`, CI configs reveal stack decisions

## Heuristics

- \`src/index.ts\` or \`src/main.ts\` is usually the entry point
- \`src/types.ts\` or \`src/types/\` contains shared type definitions
- A \`src/utils/\` or \`src/helpers/\` directory often grows into a dumping ground — watch for signs of missing abstractions
- Test files named \`*.test.ts\` or \`*.spec.ts\` near the implementation file tell you how it's meant to be used
- \`git log --oneline --follow <file>\` shows a file's recent change history

## Output Format

\`\`\`
Project: <name>
Entry point: <path>
Stack: <key technologies>

Module Map:
- src/module-a/ — handles X (entry: index.ts)
- src/module-b/ — handles Y

Data Flow (feature X):
  Input → Module A.parse() → Core.process() → Module B.render() → Output

Key Types:
- type Foo = ...

Open Questions:
- What does module C do?
\`\`\``,
  },
  {
    name: 'Refactoring Plan',
    description: 'Plan safe, incremental refactoring of large complex code with test coverage and migration strategy.',
    keywords: 'refactor,refactoring,migration,restructure,clean code,重构,重构计划',
    content: `## Skill: Refactoring Plan

Plan safe, incremental refactoring of complex code with minimal disruption.

## Instructions

1. **Understand current state** — read the code, identify what it does and what's wrong
2. **Define target state** — what should the code look like after refactoring?
3. **Identify safe extraction boundaries** — code units that can be extracted without changing behavior
4. **Plan incremental steps** — each step must keep the system working (Strangler Fig pattern)
5. **Add characterization tests** — write tests that capture current behavior BEFORE changing code
6. **Flag risks** — shared mutable state, implicit dependencies, side effects

## Principles

- **One change at a time**: each commit changes one thing. If you need to rename and restructure, do them in separate commits.
- **Characterization tests first**: before changing a function, write tests that document what it actually does (even if wrong)
- **Strangler Fig**: add the new path alongside the old, route traffic gradually, remove the old path
- **No mixed refactoring**: never fix bugs while refactoring — the refactoring might introduce bugs, and you won't know which change caused them

## Output Format

### Current Problems
- What's wrong and why it matters

### Target Architecture
- Brief description of the desired state

### Migration Plan

1. **Step 1: Characterization tests** — files to add, what they cover
2. **Step 2: Extract module** — what moves where, why safe
3. **Step 3: Update callers** — what changes, what doesn't
4. **Step N: Remove old code** — what gets deleted

### Risk Register
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| ...  | High/Med  | ...        |

### Rollback Plan
How to revert each step if something breaks.`,
  },
  {
    name: 'Test Strategy',
    description: 'Design comprehensive test strategies: unit, integration, e2e coverage with risk-based prioritization.',
    keywords: 'test,testing,coverage,unit test,integration test,e2e,TDD,测试,测试策略',
    content: `## Skill: Test Strategy

Design a test strategy that balances coverage, speed, and maintenance cost.

## Instructions

### 1. Categorize Tests by Scope

- **Unit tests** (fast, many): test single functions/classes in isolation. Mock external dependencies.
- **Integration tests** (medium, few): test component interactions with real dependencies (DB, API).
- **E2E tests** (slow, minimal): test critical user journeys through the full system.

### 2. Prioritize by Risk

Test in this order:
1. Core business logic — if this breaks, nothing works
2. Error handling — untested error paths = silent failures in production
3. Edge cases — empty states, boundary values, concurrent access
4. Happy path — the most common flow (often already covered by above)
5. UI/rendering — lowest priority, highest maintenance cost

### 3. Test Structure (AAA)

\`\`\`
// Arrange — set up the test data and preconditions
// Act — execute the code under test
// Assert — verify the behavior and outcomes
\`\`\`

### 4. Coverage Goals

- Unit: 80%+ line coverage (measure with \`--coverage\`)
- Integration: every public API endpoint / module entry point
- E2E: top 3-5 user journeys

### 5. What NOT to Test

- Third-party library behavior (test your usage, not their code)
- Trivial getters/setters
- Configuration values (test that config loads, not each value)
- Implementation details (test behavior, not internal calls)

## Output Format

\`\`\`
Test Plan: <Feature>

Unit Tests:
- [ ] function A handles empty input
- [ ] function A handles boundary value X
- [ ] function B propagates error from dependency

Integration Tests:
- [ ] API endpoint /foo returns 200 with valid input
- [ ] API endpoint /foo returns 400 with invalid input

E2E Tests:
- [ ] User can complete flow X

Risk Gaps:
- Error path in module Y is untested
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
