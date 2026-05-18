# Clio Scenarios — Business Logic

> Version: v0.1
> Ordered by user-perceived sequence, covering full business logic at each trigger point.

---

## Scenario 1: User Install

### Trigger
User runs `clio install`

### Business Logic

```
1. Create ~/.clio/ directory tree
   ├── config.json          <- write default config
   ├── data/
   │   └── clio.db          <- init SQLite (run all CREATE TABLE)
   └── models/              <- empty dir, embedding model downloads on demand

2. Read ~/.claude/settings.json
   <- if file doesn't exist, create empty JSON { mcpServers: {}, hooks: {} }

3. Add clio entry in mcpServers:
   └── command: "node", args: ["<dist>/server.js"], env: { CLIO_HOME }

4. Add 5 entries in hooks:
   ├── SessionStart      -> node <dist>/hooks/session-start.js
   ├── UserPromptSubmit  -> node <dist>/hooks/prompt-submit.js
   ├── PostToolUse       -> node <dist>/hooks/post-tool-use.js
   ├── PreCompact        -> node <dist>/hooks/pre-compact.js
   └── Stop              -> node <dist>/hooks/stop.js

5. Verify:
   ├── Start Clio process -> IPC socket reachable
   ├── SQLite readable/writable
   └── Print "✓ Clio installed successfully"
```

### Edge Cases

| Case | Behavior |
|------|----------|
| Already installed (.clio/ exists) | Keep existing data, only update settings.json |
| settings.json has other MCP configs | Append clio entry, don't overwrite existing config |
| ~/.claude/ directory doesn't exist | Auto-create |
| Node.js version < 20 | Not handled here, fails at runtime (enforced by package.json engines) |

---

## Scenario 2: New Session Start (SessionStart)

### Trigger
User starts a new Claude Code session

### Business Logic

```
Hook receives SessionStart event
  |
  |- Send recall_initial_context() via Unix socket
  |
  └─ Clio daemon receives request:
       |
       |- 1. Query semantic_memories (conditions):
       |     |- is_archived = 0
       |     |- confidence >= 0.7
       |     └─ sort: (access_count x 0.3 + confidence x 0.7) DESC
       |        LIMIT config.recall.top_k_startup (default 5)
       |
       |- 2. Query all profile entries
       |
       |- 3. Assemble injection text:
       |     |- "<!-- clio: user profile -->"
       |     |- "preferences: ..." (from profile)
       |     └─ one line per memory: "fact: ..." / "preference: ..."
       |
       |- 4. Count tokens, truncate if over budget_session_start (500)
       |
       └─ 5. Return assembled text -> Hook writes to stdout -> Claude system prompt
```

### Injection Sample

```
<!-- clio: user profile -->
- preferences: tech_stack.database-driver=asyncpg
- preference: uses asyncpg for database operations
- decision: chose FastAPI over Django due to performance requirements
- fact: project uses Python 3.12 + uv as package manager
```

### Edge Cases

| Case | Behavior |
|------|----------|
| No memories exist | Return empty string -> no injection -> Claude behavior unchanged |
| Fewer than 5 memories | Return however many exist |
| Token over budget | Truncate from low-priority (low confidence) entries |
| IPC socket connection fails | Hook silently exits (try-catch swallowed) -> no injection |
| Embedding model not loaded | No impact, getInitialContext doesn't depend on embedding |

---

## Scenario 3: User Input Detection (UserPromptSubmit — Preference/Correction)

### Trigger
User sends a message in the Claude Code input box

### Business Logic

```
Hook receives UserPromptSubmit event
  |
  |- Parallel (fire & forget + await recall):
  |
  |- [fire & forget] Call detect_preferences(text)
  |   |
  |   └─ Clio receives request:
  |        |- Match 3 regex groups in priority order:
  |        |   [correction]   should be | should use | ought to be | stop
  |        |   [preference]   prefer | always use | best practice | i like
  |        |   [decision]     choose | decided | migrate | switched to
  |        |
  |        |- Match found -> write to working_memories:
  |        |   └─ pattern_type = matched type
  |        |      confidence = correction(0.7) | preference(0.5) | decision(0.5)
  |        |
  |        └─ No match -> no write
  |
  └─ [await] Call recall_relevant(text)
      |
      └─ Clio receives request:
           |- 1. BM25 search (FTS5 MATCH) -> Top-10
           |- 2. Vector search (sqlite-vec) -> Top-10 (if model loaded)
           |- 3. RRF fusion -> take Top-3
           |- 4. Update access_count + last_accessed
           └─ 5. Return Top-3 text -> Hook writes to stdout -> injected into additional_context
```

### Edge Cases

| Case | Behavior |
|------|----------|
| Input empty or length < 3 | Skip preference detection + recall |
| No relevant memories | Injection content is empty |
| Vector search unavailable (embedding not loaded) | BM25-only search |
| Both BM25 and vector unavailable | Return empty |
| UserPromptSubmit fires before SessionStart | Degrade safely: Hook swallows exception |
| Input matches both correction and preference | Higher priority wins (correction > preference > decision) |

---

## Scenario 4: Tool Call Capture (PostToolUse)

### Trigger
Every Claude Code tool call after execution (may fire multiple times per turn)

### Business Logic

```
Hook receives PostToolUse event
  |
  |- Read env vars:
  |   |- CLAUDE_TOOL_NAME    -> toolName
  |   └─ CLAUDE_TOOL_OUTPUT  -> toolOutput
  |
  |- Filter skip-tools (skip immediately):
  |   └─ Read, Glob, listFiles
  |
  └─ Call capture_observation(toolName, toolOutput)
      |
      └─ Clio receives request:
           |- 1. Truncate: toolOutput.slice(0, max_tool_output_chars=2048)
           |- 2. Redact: apply 5 regex patterns
           |     |- api_key / API KEY -> API_KEY_REDACTED
           |     |- AKIA... -> AWS_KEY_REDACTED
           |     |- sk-... -> OPENAI_KEY_REDACTED
           |     |- ghp_... -> GITHUB_TOKEN_REDACTED
           |     └─ /Users/xxx/ -> /Users/[USER]/
           |- 3. Length check: after redaction < 10 chars -> discard
           |- 4. SHA-256 dedup: same hash within 5 min -> discard
           |- 5. Write to working_memories:
           |     └─ id, session_id, source='tool_use',
           |        content=redacted_text, pattern_type=NULL
           └─ 6. Return ack
```

### Typical Call Count Per Session

```
Assume 10 turns, each turn Claude averages 2-3 tool calls:
  ┌─ Write operations (Edit/Write/Bash): ~15-20 times -> generates 15-20 working memories
  └─ Read operations (Read/Glob/ls):    ~10-15 times -> all skipped

Per session: ~15-20 working memories
```

### Edge Cases

| Case | Behavior |
|------|----------|
| toolOutput is empty | Skip (length < 10) |
| toolName is undefined | Skip |
| Same output within 5 min | Skip (SHA-256 dedup) |
| Content contains sensitive info | Redacted before storage, raw value never exposed |
| Redacted content loses meaning | Still retained (e.g. "my key is API_KEY_REDACTED") |

---

## Scenario 5: Context Compression Guard (PreCompact)

### Trigger
Claude Code is about to perform context compression (happens in long conversations)

### Business Logic

```
Hook receives PreCompact event
  |
  └─ Call save_session_snapshot({ sessionId })
      |
      └─ Clio receives request:
           |- Read CLAUDE_SESSION_ID
           |- Update sessions table:
           |   └─ UPSERT sessions SET tool_count = current_count
           └─ Return ack

Purpose: After PreCompact, Hook context is lost.
         tool_count in sessions table is used at Stop time to estimate working memory completeness.
```

### Edge Cases

| Case | Behavior |
|------|----------|
| sessionId unknown | Insert with 'unknown' |
| PreCompact fires after no tool calls | tool_count = 0 still saved |
| Same session compressed multiple times | Overwrite tool_count each time |

---

## Scenario 6: Session End Compression (Stop)

### Trigger
User ends session (exit / close terminal / timeout)

### This is the only place LLM is called

### Business Logic

```
Hook receives Stop event
  |
  └─ Call summarize_session({ sessionId })
      |
      └─ Clio receives request:
           |
           |- [A] Collect working memories
           |    |- Query working_memories WHERE session_id = ?
           |    |- Extract all content fields
           |    └─ If empty -> skip LLM call, go to [F] cleanup
           |
           |- [B] LLM compression (only LLM call point)
           |    |- Assemble prompt:
           |    |    "Extract 1-5 key facts from this conversation log. Only include:
           |    |     1. Explicit technical preferences
           |    |     2. Important technical decisions (with reasons)
           |    |     3. Corrections made to Claude
           |    |     Output as JSON array, each item with
           |    |     content, type(fact|preference|decision|pattern),
           |    |     topic, value"
           |    |- Model: claude-sonnet-4-20250514
           |    |- max_tokens: 500
           |    |- Input: ~2000 tokens (working memories + latest user messages)
           |    |
           |    |- Success -> parse JSON
           |    └─ Fail (timeout/exception) -> skip compression, keep working memories for retry
           |
           |- [C] Process each LLM result
           |    |- Denoise: content length < 20 -> discard
           |    |- Dedup: content already in semantic_memories -> discard
           |    |- Redact: re-apply sensitive info regex
           |    |- Write to semantic_memories:
           |    |   └─ id, content, memory_type, topic, value,
           |    |      confidence=0.5, source_session=sessionId
           |    |- Index FTS5: INSERT INTO memories_fts
           |    └─ Index vector: call EmbeddingService.embed()
           |                     -> INSERT INTO memories_vec
           |
           |- [D] InstinctEngine.detect(sessionId)
           |    |- Query new semantic memories from this session
           |    |- For each memory with topic:
           |    |   |- instincts table has same topic+value -> hit_count++, confidence increases
           |    |   └─ instincts table doesn't have -> create new instinct (confidence=0.3)
           |    └─ When instinct.confidence >= 0.7 -> promoteToSemantic()
           |
           |- [E] DecayEngine.run()
           |    |- Semantic memory decay: -0.1 confidence per 30 days since last access
           |    |- Archive: confidence < 0.1 -> is_archived=1
           |    |- Expire instincts: 30 days no hit -> status=expired
           |    └─ Clean working memories: 7 days old -> DELETE
           |
           |- [F] ProfileEngine.sync()
           |    |- Query: memory_type IN ('preference','decision') AND confidence >= 0.7
           |    └─ Upsert each into profile table
           |
           └─ [G] Cleanup
                └─ DELETE working_memories WHERE session_id = ?
```

### LLM Compression I/O Example

```
Input (~2000 tokens):
  User: Write a FastAPI database connection
  Claude: [generates code using psycopg2]
  User: No, use asyncpg, we discussed this before
  Claude: [revises to asyncpg implementation]

Output (JSON):
  [
    { "content": "uses asyncpg instead of psycopg2 for PostgreSQL",
      "type": "preference", "topic": "database-driver", "value": "asyncpg" },
    { "content": "project uses FastAPI framework",
      "type": "fact", "topic": "framework", "value": "FastAPI" }
  ]
```

### Instinct Promotion Threshold

```
An instinct's evolution path:

  1st occurrence -> confidence=0.3, hit_count=1  (pending)
  2nd occurrence -> confidence=0.45, hit_count=2  (pending)
  3rd occurrence -> confidence=0.6, hit_count=3  (pending)
  4th occurrence -> confidence=0.75 >= 0.7 -> promote!
                    -> create pattern-type semantic_memory
                    -> instinct.status = 'promoted'

Requires the same topic+value to appear across 4+ different sessions.
```

### Edge Cases

| Case | Behavior |
|------|----------|
| No tool calls in session | Working memories empty -> skip LLM -> go straight to Decay -> cleanup |
| LLM returns invalid JSON | Parse failure -> try-catch skips compression -> keep working memories |
| LLM times out (>10s) | Same as above |
| ANTHROPIC_API_KEY not set | LLM call fails -> skip compression |
| New memory fully duplicates existing one | SHA-256 dedup -> discard |
| New memory too short (< 20 chars) | Denoise -> discard |
| Embedding model not loaded | Skip vector index write, don't affect other steps |
| An instinct is already promoted | Subsequent hits don't re-promote |
| Multiple values for same topic | Each detected independently |

---

## Scenario 7: User Memory Management (MCP Tools)

### Trigger
User calls slash commands in Claude Code conversation (implemented via MCP tools)

### memorize — Manual Memory Write

```
Claude: /remember project uses PostgreSQL
       |
       └─ MCP Client -> call clio memorize
           Input: { content: "project uses PostgreSQL", memoryType: "fact", topic: "database", value: "PostgreSQL" }
           Output: "memory saved: <uuid>"

Write: INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence)
       VALUES (?, ?, 'fact', 'database', 'PostgreSQL', 0.7)
       # manual write defaults to confidence=0.7 (higher than auto-extracted 0.5)
```

### recall — Manual Memory Search

```
Claude: /memory recall "database"
       |
       └─ MCP Client -> call clio recall
           Input: { query: "database" }
           Output: "preference: uses asyncpg for database
                  decision: chose PostgreSQL over MySQL
                  fact: project uses SQLAlchemy 2.0"

Search: same logic as recall_relevant (BM25 + vector + RRF)
```

### forget — Delete Memory

```
Claude: /memory forget <id>
       |
       └─ MCP Client -> call clio forget
           Input: { id: "xxx" }
           Output: "deleted"

Delete: DELETE FROM semantic_memories WHERE id = ?
        DELETE FROM memories_fts WHERE rowid = ?
        DELETE FROM memories_vec WHERE id = ?
```

### get_profile — View Profile

```
Claude: /profile show
       |
       └─ MCP Client -> call clio get_profile
           Output: [
             { "key": "tech_stack.database-driver", "value": "asyncpg", "confidence": 0.8 },
             { "key": "tech_stack.framework", "value": "FastAPI", "confidence": 0.75 },
             { "key": "code_style.quotes", "value": "single", "confidence": 0.7 }
           ]
```

### list_instincts — View Instincts

```
Claude: /instinct list
       |
       └─ MCP Client -> call clio list_instincts
           Output: [
             { "topic": "database-driver", "value": "asyncpg",
               "confidence": 0.6, "hit_count": 3, "status": "pending" }
           ]

Only returns status = 'pending' instincts (promoted ones aren't shown)
```

---

## Scenario 8: System Maintenance (Decay)

### Trigger
- Every Stop Hook's summarizeSession includes it automatically
- Manual trigger by user (reserved interface)

### Decay Rules

```
1. Semantic memory decay:
   Each unrecalled memory, from last_accessed:
     └─ Every 30 days confidence -= 0.1
     └─ Floor at 0 (never negative)
     └─ Recalled once -> last_accessed updated -> timer resets

2. Archive conditions (either):
     |- confidence < 0.1 (completely stale)
     └─ confidence < 0.3 AND 90 days untouched

3. Instinct expiry:
     └─ status = 'pending' AND last_hit > 30 days ago -> status = 'expired'

4. Working memory cleanup:
     └─ created_at < 7 days ago -> DELETE
```

### Decay Example

```
Day 0:   Memory "uses asyncpg" created, confidence=0.7
Day 30:  Not recalled -> confidence=0.6
Day 60:  Not recalled -> confidence=0.5
Day 90:  Not recalled -> confidence=0.4 (not yet at archive threshold 0.3, keep)
Day 120: Not recalled -> confidence=0.3
         AND 120 days since last access > 90 days -> archive is_archived=1

But if recalled on day 45:
Day 45:  last_accessed updated to day 45, confidence unchanged (0.6)
Day 75:  30 days from day 45 -> confidence=0.5
         ... timer resets from day 45
```

---

## Scenario 9: Degradation Scenarios

| Failure Point | Manifestation | Impact |
|---------------|---------------|--------|
| **MCP Server fails to start** | process.exit(1), error on stderr | Claude Code works normally, memory features completely unavailable |
| **IPC socket creation fails** | startIpcServer rejects -> server crash | Same as above |
| **SQLite write fails** | better-sqlite3 throws -> try-catch swallows | That memory lost, subsequent operations continue |
| **Embedding model download fails** | load() rejects -> isLoaded() returns false | Degrades to BM25-only search, vector search unavailable |
| **LLM call times out** | Anthropic SDK throws -> summarizeSession skips | Session produces no new semantic memories, working memories kept for retry |
| **Memory store empty** | getInitialContext returns '' | No context injected, Claude behavior unchanged |
| **Disk space full** | SQLite write fails -> try-catch swallows | Gradually loses new memories, existing memories still readable |
| **Hook script crashes** | Script crash -> Claude Code swallows internally | That hook event lost, subsequent events unaffected |
| **settings.json overwritten** (Claude Code upgrade) | Clio's MCP + Hook config lost | User needs to re-run clio install |

---

## Data Flow Summary

```
                  Capture (automatic)                      Manage (manual)
               ┌──────────────┐                   ┌──────────────────┐
               │ PostToolUse   │                   │ /remember        │
               │ UserPrompt    │                   │ /memory recall   │
               │ Submit        │                   │ /memory forget   │
               └──────┬───────┘                   └────────┬─────────┘
                      │                                    │
                      ▼                                    ▼
            ┌─────────────────┐              ┌──────────────────┐
            │ working_memories │              │ semantic_memories│
            │ (temp, 7d TTL)  │──Stop LLM──→│ (persistent,     │
            └─────────────────┘   compress    │  confidence decay)│
                                              └────────┬─────────┘
                                                       │
                                         ┌─────────────┼─────────────┐
                                         ▼             ▼             ▼
                                  ┌──────────┐  ┌──────────┐  ┌──────────┐
                                  │ instincts │  │  profile  │  │ FTS5 +   │
                                  │(pattern   │  │ (user     │  │ Vector   │
                                  │ detection)│  │  persona) │  │ Index    │
                                  └──────────┘  └──────────┘  └──────────┘

                  Recall (automatic)                      Recall (manual)
               ┌──────────────┐                   ┌──────────────────┐
               │ SessionStart  │                   │ /memory recall   │
               │ UserPrompt    │                   │ -> same search   │
               │ Submit        │                   │    logic         │
               └──────┬───────┘                   └──────────────────┘
                      │
                      ▼
            ┌──────────────────┐
            │ BM25 + Vector    │
            │ -> RRF -> Top-3/5│
            │ -> Inject into   │
            │   System Prompt  │
            └──────────────────┘
```
