# Product Requirements: Claude Code Intelligent Memory & Skill Evolution Plugin

> Document Version: 2.0
> Last Updated: 2026-05-15
> Codename: **Clio**

---

## 1. Product Overview

### 1.1 One-Line Positioning
**Turn Claude Code into a development partner with "long-term memory" that gets smarter the more you use it — memories and skills auto-accumulate and evolve across projects.**

### 1.2 Core Pain Points Solved

| Pain Point | Current State | After Clio |
|------------|---------------|------------|
| **Session amnesia** | Each new session, Claude forgets project preferences and past decisions | Auto-load historically relevant memories, no need to re-explain |
| **Experience waste** | Problems solved and templates written must be re-created next time | Auto-settle into reusable Skills, one-click invocation |
| **Cross-project fragmentation** | Habits and preferences don't carry across projects | Global user profile works across projects while respecting project individuality |
| **Cannot self-evolve** | Claude doesn't learn your personal style from feedback | Continuously learns your tech stack, coding style, and common mistakes via user profile |

### 1.3 Core Value Proposition
> **Install once, it knows you better over time. Memories and skills follow you across projects and sessions, never lost.**

---

## 2. Target Users

### 2.1 Primary User Persona

| Dimension | Description |
|-----------|-------------|
| **Identity** | Independent developer, full-stack engineer, tech team lead |
| **Usage frequency** | Uses Claude Code 4+ hours daily |
| **Project count** | Maintains 3+ projects simultaneously with varying tech stacks |
| **Pain points** | Repeatedly explaining project structure and tech preferences; rewriting similar code templates; habits not reusable across projects |
| **Willingness to pay** | Willing to pay for productivity tools (if monetized) |

### 2.2 Secondary Users
- **Tech teams**: Want unified team coding standards and shared Skills for faster onboarding
- **Open source contributors**: Contribute to multiple projects long-term, want each project to remember its own conventions

---

## 3. Core Features

### 3.1 Memory System

#### 3.1.1 Memory Hierarchy (based on agentmemory's 4-layer model, adapted for Clio's semantic types)

Memory is divided into four tiers, progressively refined from raw observations to mature knowledge:

```
Working Memory
  └─ Current session raw context (cleared at session end)
     | LLM compression at session end
Episodic Memory
  └─ Compressed single-session summary (retained 30 days, decays by access frequency)
     | Cross-session pattern detection
Semantic Memory
  └─ Persistent facts, preferences, decisions (permanent, manually deletable)
     | Solutions repeated >= 3 times
Procedural Memory
  └─ Reusable Skill templates (invoked on demand or auto-recommended)
```

Each memory entry carries the following metadata:

- **Semantic type**: `fact` / `preference` / `decision` / `pattern`
- **Confidence** (float 0-1): auto-calculated from cross-session consistency, user feedback can weight it
- **Source session ID**: traceable back to original conversation
- **Access count + last access time**: for forgetting-curve decay
- **Tags** (auto-extracted keywords, used for search weighting)

#### 3.1.2 Automatic Memory Capture

- **Trigger**: Incremental capture after each Tool Use via `PostToolUse` Hook; LLM compression and refinement at session end
- **Stored content**: Tech choices, code structure preferences, user corrections, recurring patterns
- **Sensitive info filtering**: Auto-detect and redact API keys, secrets, file paths with usernames, IP addresses
- **Capture scope control**: User configurable via `clio.capture.sensitivity` (`high`/`medium`/`low`); `high` only captures explicitly `/remember`ed content
- **Conflict detection**: When new memory conflicts with existing, mark as "pending confirmation" and resolve via `/memory resolve` (manual) or auto (high confidence overrides low)

#### 3.1.3 Memory Decay & Auto-Maintenance

- **Ebbinghaus forgetting curve**: Memory "importance score" decays exponentially over time, boosted on successful recall
- **Auto-archive**: Semantic memory below importance threshold -> downgrade to episodic level -> eventually auto-clean
- **Periodic compression**: Monthly, LLM summarizes large volumes of low-value memories into one summary entry, then deletes originals
- **User configurable**: Decay speed, archive threshold, compression frequency all adjustable

#### 3.1.4 Intelligent Recall

- **Session startup injection**:
  - Layer 1 (~500 tokens): Project profile + 2-3 recent high-frequency decisions
  - Layer 2 (on demand): Real-time hybrid search on user query
  - Always silent: Injected into system prompt, no interruption to user conversation flow
- **Search method**: BM25 keyword + vector embedding + Reciprocal Rank Fusion hybrid sort
- **Token budget management**: User configurable `clio.recall.budget` (default 2000 tokens); Clio strictly selects most relevant memories within budget
- **Compaction awareness**: On Claude Code context compression (`PreCompact` event), proactively write current session key state to temp storage, restore after compression
- **Injection points**: `SessionStart` + `UserPromptSubmit` (on-demand real-time retrieval)

#### 3.1.5 Memory Management Commands

| Command | Function |
|---------|----------|
| `/memory list` | List project/global memories (paginated, sortable by type/confidence/time) |
| `/memory show <id>` | View single memory details (confidence, source, related sessions) |
| `/memory forget <id>` | Delete a memory |
| `/memory recall "query"` | Manual memory search |
| `/memory resolve` | List and resolve conflicting memories |
| `/memory prune` | Manually trigger decay cleanup (dry-run mode previews what will be deleted) |
| `/memory stats` | Memory hit rate statistics, tier counts, etc. |

#### 3.1.6 MCP Tools (Beyond Slash Commands)

All memory operations also exposed as MCP tools for programmatic read/write:

| MCP Tool | Purpose |
|----------|---------|
| `memorize` | Write a memory (type + content + tags) |
| `recall` | Semantic search for relevant memories |
| `get_contradictions` | Get current conflicting memories |
| `forget` | Delete specified memory |

---

### 3.2 Skill System

#### 3.2.1 Auto-Settlement Skills

- **Detection conditions** (confidence-driven):
  - Same solution appears >= 2 times in conversations -> create "instinct" (low-confidence draft, marked `pending`)
  - Same solution appears >= 3 times -> promote to Skill candidate, request user confirmation
  - User explicitly uses `/learn` -> enter confirmation flow directly
  - Test suite passes -> auto-capture test patterns
- **Confidence evolution**: Each successful reuse increases confidence; 3 failed reuses auto-mark as "needs review"
- **User confirmation**: After generating draft, request user edit/confirm, not forced. User can set `clio.skill.auto_confirm` to skip confirmation

#### 3.2.2 Instinct System

Instincts are the precursor to Skills — low-confidence, unconfirmed pattern fragments:

- Auto-created: No user intervention needed, `pending` status
- Display: Visible in `/instinct list`, doesn't affect normal conversation
- TTL: Auto-expires after 30 days if not promoted to Skill
- `/evolve` command: Manually cluster related instincts into one Skill
- Confidence display: Each instinct shows `confidence: 0.XX` for reliability awareness

#### 3.2.3 Progressive Skill Loading

- **Lightweight Manifest**: Session start only loads Skill name, description, trigger keywords
- **On-demand activation**: Full Skill content loads only when user input matches trigger keywords
- **Auto-recommendation**: When match > 80%, proactively suggest "Use Skill xxx?"
- **Manual invocation**: `/use <skill-name>` loads the Skill

#### 3.2.4 Skill Self-Evolution

- **Failure tracking**: Each Skill records call count + success rate
- **Auto-downgrade**: 3 consecutive failures with 0 successful calls in 14 days -> mark "stale" and notify user for review
- **Self-update prompt**: Skill template can include `## Self-Update` section; AI can optimize Skill content on use, generate update draft for user confirmation

#### 3.2.5 Skill Management Commands

| Command | Function |
|---------|----------|
| `/skill list` | List all available Skills (with confidence, success rate, last use time) |
| `/skill show <name>` | View Skill details and usage stats |
| `/skill edit <name>` | Edit a Skill |
| `/skill delete <name>` | Delete a Skill |
| `/learn` | Force current conversation to settle as Skill draft |
| `/learn-rule` | Quickly record a simple rule (lighter than `/learn`, no full Skill created) |
| `/evolve` | Merge multiple instincts into one Skill |
| `/instinct list` | List all pending instincts |
| `/instinct prune` | Clean up expired instincts |

---

### 3.3 User Profile System (Key Differentiator — Currently a Community Gap)

#### 3.3.1 Auto-Learned Dimensions

- **Tech stack preferences**: Language, framework, database, testing tools (learned from code and conversations, with confidence)
- **Coding style**: Indentation, quotes, line width, type annotation preferences
- **Decision history**: Important tech choices and their rationale
- **Common error patterns**: User's frequently-made mistakes, AI can proactively warn

#### 3.3.2 Profile Evolution

- **Update timing**: Incremental observation after each Tool Use + comprehensive analysis after session end
- **Confidence system**: Each accepted suggestion -> confidence+; user correction -> corresponding entry confidence- or new correction entry created
- **Conflict handling**: Project-level config can temporarily override global profile; can merge or discard after project ends
- **Manual correction**: User can edit profile directly via `/profile edit`

#### 3.3.3 Profile Management Commands

| Command | Function |
|---------|----------|
| `/profile show` | Show current profile summary (with confidence and learned time for each preference) |
| `/profile edit` | Manually edit profile |
| `/profile reset` | Reset profile (with caution) |
| `/profile merge` | Merge current project profile into global |

---

### 3.4 Cross-Project & Cross-Tool Capability

#### 3.4.1 Scope Hierarchy

- **Global**: Long-term memories, Skills, profile applicable across all projects (stored in `~/.clio/`)
- **Project**: Effective only for current project (stored in `<project>/.clio/`)
- **Session**: Temporary memories, auto-cleaned at session end

#### 3.4.2 Portable Bundle

- User can export project's memories + Skills to a `.clio-bundle` file via `/bundle export`
- `/bundle import <path>` restores in another project
- Use cases: migrating from old projects, team sharing, CI/CD environment consistency

#### 3.4.3 Cross-Tool Compatibility (V2, but architected for)

- MCP Server layer designed to interface with multiple AI coding tools
- Architecture reserves adapter interfaces for future Cursor CLI, Codex CLI, Gemini CLI support
- Memory storage format stays tool-agnostic, only recall/write layers adapt

#### 3.4.4 Auto-Selection Strategy

- Auto-detect current git repo path as project root on startup
- Load order: project-level config > global config
- Memory recall: search both global + project, project-level memories weighted higher

---

## 4. User Stories

### Story 1: Cross-Session Memory
> Xiaoming told Claude yesterday in Project A "we use asyncpg not psycopg2." Today when starting a new session and asking "write a database connection pool," Claude auto-uses asyncpg without Xiaoming repeating himself.

### Story 2: Auto-Settlement Skill
> Last week, Xiaoming asked Claude to generate FastAPI CRUD endpoints three times. After the third time, Clio prompts: "Repeated pattern detected. Save 'FastAPI CRUD Generation' as a Skill?" Xiaoming confirms, and next time only needs to say "Use CRUD Skill to generate endpoints for User model."

### Story 3: Cross-Project Profile
> Xiaoming habitually uses ruff formatting, pytest testing, single-quote strings. He builds this profile in Project A. When starting Project B, Claude auto-adopts the same code style without reconfiguration.

### Story 4: Team Skill Sharing
> Team lead saves internal API conventions as a Skill and exports as Bundle. After cloning the project, team members load unified Skills via `/bundle import`, ensuring consistent conventions.

### Story 5: Learning from Mistakes
> Xiaoming tells Claude "don't use dataclass, use Pydantic BaseModel." Claude remembers this. Next time generating model classes, it auto-uses Pydantic. Later, Xiaoming needs dataclass for a specific case and corrects once. Clio lowers confidence on that preference and creates an exception rule: "default to Pydantic unless @dataclass is specified."

---

## 5. MVP Scope

| Module | Included | Not Included (V2) |
|--------|----------|-------------------|
| **Memory System** | 4-tier memory model (working/episodic/semantic/procedural)<br>Semantic types + confidence + tag metadata<br>Cross-session recall (hybrid BM25 + vector)<br>Token budget management<br>Sensitive info filtering<br>Ebbinghaus decay & auto maintenance<br>Conflict detection & resolution<br>Compaction awareness<br>Manual management commands + MCP tools | Memory graph associations<br>Memory visualization |
| **Skill System** | Manual Skill creation (`/learn`)<br>Lightweight `/learn-rule`<br>Instinct system (pending + TTL)<br>Auto-settlement (>= 3 detections)<br>`/evolve` instinct -> Skill<br>Progressive loading (manifest + on-demand)<br>Skill management commands<br>Failure tracking & stale marking | Auto Skill recommendation |
| **User Profile** | Learn tech stack preferences<br>Learn coding style (indentation, quotes, etc.)<br>Confidence system<br>Display and manual profile editing | Proactive error warnings<br>Cross-project conflict auto-resolution |
| **Cross-Project** | Global/project two-tier scoping<br>Project config overrides global<br>Bundle export/import | Cross-tool compatibility (Cursor/Codex)<br>Team shared git sync |
| **Install Experience** | One-command install<br>Auto-configure hooks + MCP<br>Health check | GUI configuration |

---

## 6. User Experience & Interaction Design

### 6.1 Install Flow
```bash
# User executes
npm install -g clio
clio install

# Output
✓ Clio installed successfully
✓ Claude Code Hooks configured
✓ MCP Server started
✓ Memory index initialized
 Tip: Start claude, type /memory list
```

### 6.2 Usage Pattern (Invisible by Default)
- **Silent operation**: Mostly invisible to user, memories auto-captured and recalled
- **Active control**: Manage memories, instincts, and Skills via slash commands
- **Settlement confirmation**: Only prompts once when pattern detected, doesn't interrupt workflow (user can globally disable confirmation)
- **Progressive exposure**: New users see no management command hints for first 3 sessions, mild hint on 4th: "/memory list to see your memories"

### 6.3 First-Time Guidance
After first install, on starting Claude Code, proactively prompts:
> Welcome to Clio. I'll remember your preferences and technical decisions across sessions. Try: "remember I like single quotes" and I'll auto-use them going forward. Type /help for more.

---

## 7. Non-Functional Requirements

| Dimension | Requirement |
|-----------|-------------|
| **Performance** | Memory retrieval latency < 100ms; session startup overhead < 500ms |
| **Resource** | Memory < 200MB; disk < 500MB (10k memories) |
| **Privacy** | All data local storage; auto-redact sensitive info (API keys, paths); no network |
| **Reliability** | Memory crash doesn't affect Claude Code core functionality; supports data export/backup; compaction safe |
| **Extensibility** | Pluggable embedding models; standardized MCP tool interface; multi-tool adapter architecture reserved |
| **Compatibility** | macOS / Linux; latest Claude Code version |

---

## 8. Technical Constraints

- **Implementation**: Full TypeScript, single-process architecture (MCP Server + Unix Socket IPC for Hooks)
- **MCP SDK**: `@modelcontextprotocol/sdk` (Anthropic reference implementation)
- **Storage**: SQLite + FTS5 + sqlite-vec (via `better-sqlite3`)
- **Embedding model**: `all-MiniLM-L6-v2` (384 dim, `@xenova/transformers` WASM on-device inference)
- **LLM calls**: Anthropic TypeScript SDK, reuses Claude Code environment config
- **Distribution**: `npm install -g @clio/cli`
- **Claude Code integration**: Uses `~/.claude/settings.json` Hooks + MCP Servers config
- **Hook events**: `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `Stop`

---

## 9. Community References & Acknowledgments

Clio's design references these excellent community projects:

| Project | Reference Points |
|---------|-----------------|
| **agentmemory** | 4-tier memory model, Ebbinghaus decay, hybrid search (BM25+Vector+RRF), conflict detection, sensitive info filtering, MCP tool exposure |
| **everything-claude-code** | Instinct system + confidence scoring, `/evolve` command, Import/Export, Compaction awareness, TTL auto-expiry |
| **pro-workflow** | `/learn-rule` lightweight rules, token budget management, knowledge planes (wiki), Compaction state preservation |
| **agentic-stack** | Progressive loading, Skill self-evolution (failure tracking + stale marking), data flywheel, Bundle portable packages, cross-tool adapter architecture |
| **obsidian-mind** | Layered token loading strategy, message classification, lifecycle Hook coverage |
| **my-claude-code-setup** | CLAUDE series files dual-layer memory architecture (git-shared + local private) |

---

## 10. Future Roadmap

| Version | Planned Features |
|---------|-----------------|
| **V1.0** | Full MVP scope from this PRD |
| **V1.5** | Auto Skill recommendation (context-triggered); profile conflict auto-resolution; full auto Instinct -> Skill pipeline |
| **V2.0** | Cross-tool compatibility (Cursor CLI, Codex CLI, Gemini CLI); team shared Bundle; memory graph visualization dashboard |
| **V2.5** | Skill Marketplace (community sharing); data flywheel (auto test case generation); Web UI management |
| **V3.0** | Optional cloud sync; cross-user anonymous learning (privacy-preserving); multi-agent coordination memory |

---

## 11. Success Metrics

| Metric | Target (3 months post-launch) |
|--------|-------------------------------|
| Daily Active Users (DAU) | 500+ |
| Average Skills per user | >= 3 |
| Memory recall adoption rate (no manual override) | >= 80% |
| User retention (day 30) | >= 40% |
| GitHub Stars | >= 800 |

---

## 12. Risks & Mitigation

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Claude Code official updates break Hook compatibility | Medium | Design adapter layer, fast follow patches |
| Local embedding model underperforms | Low | Allow user to switch to faster models (e.g., OpenAI API as optional) |
| Users find "auto-settlement" annoying | Medium | Default only creates low-confidence instincts (silent), only prompts when promoting to Skill |
| Memory store grows unbounded | Low | Ebbinghaus decay + auto periodic compression summary, both mechanisms active simultaneously |

---

## 13. Appendix: Typical Usage Scenarios

**Scenario: New Project Setup**
```
User: Start a new project using FastAPI + SQLAlchemy + asyncpg
Clio: [Remembered tech stack preference, confidence 0.7]
      I noticed you previously preferred repository pattern in Project X. Continue?
User: Yes, use repository pattern.
Clio: [Recorded decision, confidence increased to 0.85]

[Session ends]

--- Next day, new session ---
User: Create a user model
Clio: [Auto-loaded: project preferences + tech stack + repository pattern decision]
      Based on your preferences, I'll use SQLAlchemy 2.0 style + asyncpg.
      Should I generate the corresponding repository class?
User: Yes.
Clio: [Generates code, auto-conforms to previously agreed patterns]
```

**Scenario: Error Correction & Learning**
```
User: Don't use sync style here, use async/await
Clio: [Recorded correction: prefers async/await over sync, confidence initial 0.6]
      Noted. Next time I encounter I/O operations, I'll prefer async/await.
User: OK.

[Next day, another session]
User: Write a file reading function
Clio: [Recalled: async/await preference, confidence 0.7 (successful reuse +1)]
      Use async/await or sync?
User: async.
Clio: [Confidence +0.1, increased to 0.8]
```
