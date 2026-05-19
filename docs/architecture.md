# Clio Architecture

> Core diagrams: ER, class, and flow diagrams
> Date: 2026-05-19

---

## 1. ER Diagram

```mermaid
erDiagram
    semantic_memories ||--o{ memories_fts : "FTS5-indexed"
    semantic_memories ||--o{ memories_vec : "vector-indexed"
    semantic_memories ||..o{ instincts : "trains"

    sessions ||--o{ working_memories : "contains"

    semantic_memories {
        uuid id PK "primary key"
        text content "memory content"
        enum memory_type "fact|preference|decision|pattern"
        string topic "topic tag (e.g. database-driver)"
        string value "value (e.g. asyncpg)"
        float confidence "0.0-1.0 confidence score"
        uuid source_session "source session FK->sessions"
        int access_count "recall count"
        datetime last_accessed "last access time"
        datetime created_at "creation time"
        datetime updated_at "update time"
        uuid conflict_id "conflicting memory ID (self-ref FK, MVP placeholder)"
        bool is_archived "archived flag"
    }

    memories_fts {
        int rowid "maps to semantic_memories.rowid"
        text content "FTS5 full-text indexed content"
        text topic "FTS5 topic"
        text value "FTS5 value"
    }

    memories_vec {
        uuid id PK "maps to semantic_memories.id"
        float embedding[384] "384-dim vector embedding"
    }

    working_memories {
        uuid id PK "primary key"
        uuid session_id "session ID FK->sessions"
        enum source "tool_use|user_prompt"
        text content "raw observation (redacted)"
        enum pattern_type "preference|correction|decision|null"
        datetime created_at "creation time"
    }

    instincts {
        uuid id PK "primary key"
        string topic "topic"
        string value "value"
        float confidence "0.0-1.0 confidence score"
        int hit_count "hit count"
        datetime last_hit "last hit"
        datetime created_at "creation time"
        enum status "pending|promoted|expired"
    }

    sessions {
        uuid id PK "session ID"
        string project_path "project path"
        text summary "LLM-compressed summary"
        datetime started_at "session start time"
        datetime ended_at "session end time"
        int tool_count "tool call count"
        int token_estimate "estimated token consumption"
    }

    profile {
        string key PK "e.g. tech_stack.database-driver"
        string value "value (e.g. asyncpg)"
        float confidence "0.0-1.0"
        string source "source description"
        datetime created_at "creation time"
        datetime updated_at "update time"
    }
```

### Entity Relationship Notes

| Entity | Est. Rows (MVP) | Cleanup Strategy |
|--------|-----------------|------------------|
| `semantic_memories` | ~500 | auto-archive when confidence < 0.1 |
| `working_memories` | ~50,000 | keep last 7 days |
| `instincts` | ~100 | pending TTL expires after 30 days |
| `sessions` | ~1,000 | keep last 90 days |
| `profile` | ~20 | never clean |
| `memories_fts` | ~500 | cleaned with semantic_memories |
| `memories_vec` | ~500 | cleaned with semantic_memories |

---

## 2. Class Diagram

```mermaid
classDiagram
    class ClioServer {
        +start() void
        -handleIpcRequest(req) IpcResponse
        -setupMcpTools() void
    }

    class Config {
        +CLIO_HOME string
        +loadConfig() ClioConfig
        +ensureClioHome() void
    }

    class Database {
        +getDb() Database
        +closeDb() void
        +initSchema(db) void
    }

    class EmbeddingService {
        -extractor FeatureExtractionPipeline
        +load() Promise~void~
        +isLoaded() boolean
        +embed(text) Promise~Float32Array~
    }

    class CaptureEngine {
        -db Database
        -config ClioConfig
        -anthropic Anthropic
        -recentHashes string[]
        +observe(toolName, toolOutput) void
        +capturePreference(text, patternType, sessionId?) void
        +summarizeSession(sessionId, projectPath?) Promise~void~
        +saveSnapshot(data) void
    }

    class RecallEngine {
        -db Database
        -config ClioConfig
        -embedding EmbeddingService
        +getInitialContext() string
        +recallRelevant(query) Promise~string~
        -rrf(bm25, vector, k) any[]
        -escapeFts5(text) string
    }

    class InstinctEngine {
        -db Database
        +detect(sessionId) void
        -promoteToSemantic(instinct, sessionId) void
    }

    class DecayEngine {
        -db Database
        -config ClioConfig
        +run() void
    }

    class ProfileEngine {
        -db Database
        +sync() void
    }

    class SessionPipeline {
        -capture CaptureEngine
        -instinct InstinctEngine
        -decay DecayEngine
        -profile ProfileEngine
        +processSession(sessionId, projectPath?) Promise~void~
    }

    class IpcServer {
        <<module>>
        +startIpcServer(handler) Promise~string~
    }

    class IpcClient {
        <<module>>
        +sendToClio(type, payload) Promise~unknown~
    }

    class SessionStartHook {
        <<standalone>>
        +main() Promise~void~
    }

    class PromptSubmitHook {
        <<standalone>>
        +main() Promise~void~
    }

    class PostToolUseHook {
        <<standalone>>
        +main() Promise~void~
    }

    class PreCompactHook {
        <<standalone>>
        +main() Promise~void~
    }

    class StopHook {
        <<standalone>>
        +main() Promise~void~
    }

    class CliInstall {
        <<module>>
        +install() void
        +status() void
    }

    ClioServer --> Config : reads
    ClioServer --> Database : inits
    ClioServer --> EmbeddingService : creates
    ClioServer --> CaptureEngine : creates
    ClioServer --> RecallEngine : creates
    ClioServer --> InstinctEngine : creates
    ClioServer --> DecayEngine : creates
    ClioServer --> ProfileEngine : creates
    ClioServer --> SessionPipeline : creates
    ClioServer --> IpcServer : starts

    SessionPipeline --> CaptureEngine : calls (summarize)
    SessionPipeline --> InstinctEngine : calls (detect)
    SessionPipeline --> DecayEngine : calls (run)
    SessionPipeline --> ProfileEngine : calls (sync)

    CaptureEngine --> Database : uses
    CaptureEngine --> AnthropicSDK : calls (summarize)

    RecallEngine --> Database : queries
    RecallEngine --> EmbeddingService : embeds query

    InstinctEngine --> Database : reads/writes instincts
    DecayEngine --> Database : batch updates
    ProfileEngine --> Database : upserts profile

    IpcClient ..> IpcServer : connects via Unix socket

    SessionStartHook --> IpcClient : uses
    PromptSubmitHook --> IpcClient : uses
    PostToolUseHook --> IpcClient : uses
    PreCompactHook --> IpcClient : uses
    StopHook --> IpcClient : uses
```

### Core Dependencies

```
Engines depend on Storage, not on each other
  ┌──────────────────────┐
  │  ClioServer          │  ← single entry point composing all modules
  ├──────────────────────┤
  │  SessionPipeline     │  ← orchestrates: CaptureEngine ➔ InstinctEngine ➔ DecayEngine ➔ ProfileEngine
  │  CaptureEngine       │  ← standalone (capture + LLM summarization only)
  │  RecallEngine        │  ← standalone, only depends on Database + EmbeddingService
  │  InstinctEngine      │  ← standalone
  │  DecayEngine         │  ← standalone
  │  ProfileEngine       │  ← standalone
  └──────────────────────┘
```

---

## 3. Core Flowcharts

### 3.1 Install Flow

```mermaid
flowchart TD
    A["User runs `npm install -g @clio/cli`"] --> B["User runs `clio install`"]
    B --> C["Create ~/.clio/ directory structure"]
    C --> D["Init SQLite database<br>run initSchema()"]
    D --> E{config.json exists?}
    E -->|no| F["Write default config"]
    E -->|yes| G["Skip"]
    F --> H["Read ~/.claude/settings.json"]
    G --> H
    H --> I["Add MCP Server config<br>command: node dist/server.js"]
    I --> J["Add 5 Hooks<br>pointing to dist/hooks/*.js"]
    J --> K["Save settings.json"]
    K --> L["Verify: IPC socket reachable?<br>SQLite readable/writable?"]
    L -->|fail| M["Print error"]
    L -->|ok| N["Print ✓ Clio installed"]
```

### 3.2 Capture Flow (PostToolUse)

```mermaid
flowchart TD
    A["PostToolUse Hook fires"] --> B{Tool in allowlist?}
    B -->|Read/Glob/listFiles| C["Skip, ignore"]
    B -->|other tools| D["Read toolName + toolOutput<br>truncate to 2048 chars"]
    D --> E["Redact: regex replace API Key / Token / path"]
    E --> F["Content length < 10?"]
    F -->|yes| G["Discard"]
    F -->|no| H["SHA-256 hash, 5-min dedup window"]
    H -->|duplicate| I["Discard"]
    H -->|new content| J["Write to working_memories<br>session_id + source='tool_use'"]
```

### 3.3 Preference Detection Flow (UserPromptSubmit)

```mermaid
flowchart TD
    A["UserPromptSubmit Hook fires"] --> B["Read user input text"]
    B --> C{Matches correction pattern?}
    C -->|yes| D["Write to working_memories<br>pattern_type='correction'<br>confidence=0.7"]
    C -->|no| E{Matches preference pattern?}
    E -->|yes| F["Write to working_memories<br>pattern_type='preference'<br>confidence=0.5"]
    E -->|no| G{Matches decision pattern?}
    G -->|yes| H["Write to working_memories<br>pattern_type='decision'<br>confidence=0.5"]
    G -->|no| I["Only recall memories, no write"]
    D --> J["Real-time retrieval: BM25 + vector + RRF"]
    F --> J
    H --> J
    I --> J
    J --> K["Inject Top-3 memories<br>into UserPromptSubmit additional_context"]
```

### 3.4 Session End Compression Flow (Stop)

```mermaid
flowchart TD
    A["Stop Hook fires"] --> B["Collect all working_memories for this session"]
    B --> C["Assemble LLM prompt<br>extract 1-5 key facts from conversation"]
    C --> D["Call Anthropic API"]
    D -->|fail| E["Skip compression this time<br>keep working memories for retry"]
    D -->|ok| F["Parse JSON result"]
    F --> G["Process each fact:"]
    G --> H{Redact -> dedup -> denoise}
    H -->|duplicate or invalid| I["Discard"]
    H -->|new valid memory| J["Write to semantic_memories"]
    J --> K["Update FTS5 index"]
    K --> L["Generate vector embedding -> write to memories_vec"]
    L --> M["SessionPipeline.processSession()"]
    M --> N["Trigger InstinctEngine.detect()"]
    N --> O["Trigger DecayEngine.run()"]
    O --> P["Trigger ProfileEngine.sync()"]
    P --> Q["Clean up working_memories for this session"]
```

### 3.5 Recall Flow (SessionStart + UserPromptSubmit)

```mermaid
flowchart TD
    subgraph SessionStart
        A["SessionStart Hook"] --> B["Call getInitialContext()"]
        B --> C["Query semantic_memories<br>confidence>=0.7<br>sort: access*0.3+confidence*0.7"]
        C --> D["Take Top-5 + all profile entries"]
        D --> E["Assemble ~500 tokens<br>inject into system prompt"]
    end

    subgraph UserPromptSubmit
        F["User input"] --> G["Call recallRelevant(text)"]
        G --> H["input -> embedding -> vector search Top-10"]
        G --> I["BM25 FTS5 search Top-10"]
        H --> J["RRF fusion sort"]
        I --> J
        J --> K["Take Top-3"]
        K --> L["Update access_count + last_accessed"]
        L --> M["Inject into additional_context"]
    end
```

### 3.6 Instinct Evolution Flow

```mermaid
flowchart TD
    A["Stop: new semantic memory written"] --> B["InstinctEngine.detect()"]
    B --> C["Iterate each new memory"]
    C --> D{"topic empty?"}
    D -->|yes| E["Skip"]
    D -->|no| F{"instincts table already has<br>same topic+value?"}
    F -->|no| G["Create instinct<br>confidence=0.3, hit_count=1"]
    F -->|yes| H["hit_count+1"]
    H --> I["confidence = min(0.7, 0.3+hit*0.15)"]
    I --> J{"confidence >= 0.7<br>AND status = pending?"}
    J -->|no| K["Update instinct"]
    J -->|yes| L["promoteToSemantic()"]
    L --> M["Create pattern-type semantic memory"]
    M --> N["instinct.status = promoted"]

    O["0.3: initial (first occurrence)"] -.- P["0.45: hit=1"]
    P -.- Q["0.6: hit=2"]
    Q -.- R["0.7: hit=3 reaches promotion threshold"]
```

### 3.7 Decay Flow

```mermaid
flowchart TD
    A["DecayEngine.run() triggered<br>(every Stop + manual prune)"] --> B["Semantic memory decay"]
    B --> C["Iterate unarchived memories"]
    C --> D{"Last access > 30 days?"}
    D -->|no| E["Skip"]
    D -->|yes| F["confidence -= (N/30)*0.1<br>N = days since last access"]
    F --> G["Archive check"]
    G --> H{"confidence < 0.1<br>OR<br>(confidence<0.3 AND 90 days untouched)?"}
    H -->|yes| I["is_archived = 1"]
    H -->|no| J["Keep"]
    C --> K{"More memories?"}

    K -->|yes| C
    K -->|no| L["Expire old instincts"]
    L --> M["status = 'expired'<br>last_hit > 30 days ago"]
    M --> N["Clean working memories"]
    N --> O["DELETE working_memories<br>created_at < 7 days ago"]
```

---

## 4. Process Model

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Hook as Hook script (shim)
    participant IPC as Unix Socket
    participant Clio as Clio daemon

    Note over Clio: Startup: initSchema, load embedding model, start IPC server

    CC->>Hook: SessionStart
    Hook->>IPC: connect + send('recall_initial_context')
    IPC->>Clio: handleIpcRequest()
    Clio->>Clio: RecallEngine.getInitialContext()
    Clio-->>IPC: { data: "...profile + top-5 memories..." }
    IPC-->>Hook: JSON response
    Hook-->>CC: stdout -> additional_context (~500 tokens)

    CC->>Hook: UserPromptSubmit
    Hook-->>IPC: send('detect_preferences', { text }) (fire & forget)
    Hook->>IPC: send('recall_relevant', { text })
    IPC->>Clio: handle (parallel)
    Clio-->>IPC: preferences (no wait) + memories (await)
    IPC-->>Hook: response
    Hook-->>CC: stdout -> additional_context (< 300 tokens)

    CC->>Hook: PostToolUse (xN per session)
    Hook-->>IPC: send('capture_observation', { toolName, toolOutput })
    IPC->>Clio: CaptureEngine.observe()
    Clio-->>IPC: ack
    IPC-->>Hook: done (~1ms)

    CC->>Hook: Stop
    Hook->>IPC: send('summarize_session', { sessionId })
    IPC->>Clio: SessionPipeline.processSession()
    Clio->>Clio: CaptureEngine.summarizeSession()
    Clio->>Clio: collect working_memories
    Clio->>Clio: LLM: extract facts
    Clio->>Clio: store + index + embed
    Clio->>Clio: InstinctEngine.detect()
    Clio->>Clio: DecayEngine.run()
    Clio->>Clio: ProfileEngine.sync()
    Clio-->>IPC: done
    IPC-->>Hook: response
```
