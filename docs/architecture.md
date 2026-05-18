# Clio Architecture

> 核心设计图：ER 图、类图、流程图
> 日期：2026-05-19

---

## 1. ER 图

```mermaid
erDiagram
    semantic_memories ||--o{ memories_fts : "FTS5-indexed"
    semantic_memories ||--o{ memories_vec : "vector-indexed"
    semantic_memories ||--o{ instincts : "derives-from"

    semantic_memories {
        uuid id PK "主键"
        text content "记忆内容"
        enum memory_type "fact|preference|decision|pattern"
        string topic "主题标签（如 database-driver）"
        string value "值（如 asyncpg）"
        float confidence "0.0-1.0 置信度"
        uuid source_session "来源会话 FK→sessions"
        int access_count "被召回次数"
        datetime last_accessed "最后访问时间"
        datetime created_at "创建时间"
        datetime updated_at "更新时间"
        uuid conflict_id "矛盾记忆 ID（自引用 FK，MVP 预留）"
        bool is_archived "是否已归档"
    }

    memories_fts {
        int rowid "对应 semantic_memories.rowid"
        text content "FTS5 全文索引内容"
        text topic "FTS5 主题"
        text value "FTS5 值"
    }

    memories_vec {
        uuid id PK "对应 semantic_memories.id"
        float embedding[384] "384 维向量嵌入"
    }

    working_memories {
        uuid id PK "主键"
        uuid session_id "会话 ID FK→sessions"
        enum source "tool_use|user_prompt"
        text content "原始观察内容（已脱敏）"
        enum pattern_type "preference|correction|decision|null"
        datetime created_at "创建时间"
    }

    instincts {
        uuid id PK "主键"
        string topic "主题"
        string value "值"
        float confidence "0.0-1.0 置信度"
        int hit_count "命中次数"
        datetime last_hit "最后命中"
        datetime created_at "创建时间"
        enum status "pending|promoted|expired"
    }

    sessions {
        uuid id PK "会话 ID"
        string project_path "项目路径"
        text summary "LLM 压缩摘要"
        datetime started_at "会话开始时间"
        datetime ended_at "会话结束时间"
        int tool_count "工具调用次数"
        int token_estimate "预估 Token 消耗"
    }

    profile {
        string key PK "如 tech_stack.database-driver"
        string value "值（如 asyncpg）"
        float confidence "0.0-1.0"
        string source "来源描述"
        datetime created_at "创建时间"
        datetime updated_at "更新时间"
    }
```

### 实体关系说明

| 实体 | 行数预估（MVP） | 清理策略 |
|------|----------------|----------|
| `semantic_memories` | ~500 条 | 置信度 < 0.1 自动归档 |
| `working_memories` | ~50,000 条 | 保留最近 7 天 |
| `instincts` | ~100 条 | pending 30 天 TTL 过期 |
| `sessions` | ~1,000 条 | 保留最近 90 天 |
| `profile` | ~20 条 | 永不清理 |
| `memories_fts` | ~500 行 | 随 semantic_memories 清理 |
| `memories_vec` | ~500 行 | 随 semantic_memories 清理 |

---

## 2. 类图

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
        +redact(text) string
        +detectPreferences(text) ClassificationResult
        +summarizeSession(sessionId, instinct, decay, profile) Promise~void~
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

    class IpcServer {
        +startIpcServer(handler) Promise~string~
    }

    class IpcClient {
        +sendToClio(type, payload) Promise~unknown~
    }

    class HookScript {
        +main() Promise~void~
    }

    class SessionStartHook {
        +main() void
    }

    class PromptSubmitHook {
        +main() void
    }

    class PostToolUseHook {
        +main() void
    }

    class PreCompactHook {
        +main() void
    }

    class StopHook {
        +main() void
    }

    class CliInstall {
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
    ClioServer --> IpcServer : starts

    CaptureEngine --> Database : uses
    CaptureEngine --> AnthropicSDK : calls (summarize)

    RecallEngine --> Database : queries
    RecallEngine --> EmbeddingService : embeds query

    InstinctEngine --> Database : reads/writes instincts
    DecayEngine --> Database : batch updates
    ProfileEngine --> Database : upserts profile

    IpcClient ..> IpcServer : connects via Unix socket

    HookScript <|-- SessionStartHook : extends
    HookScript <|-- PromptSubmitHook : extends
    HookScript <|-- PostToolUseHook : extends
    HookScript <|-- PreCompactHook : extends
    HookScript <|-- StopHook : extends

    HookScript --> IpcClient : uses
```

### 核心依赖关系

```
Engines 依赖 Storage，不依赖对方
  ┌──────────────────────┐
  │  ClioServer          │  ← 唯一组合所有模块的入口
  ├──────────────────────┤
  │  CaptureEngine       │  ← 调用 InstinctEngine + DecayEngine + ProfileEngine
  │  RecallEngine        │  ← 独立，只依赖 Database + EmbeddingService
  │  InstinctEngine      │  ← 独立
  │  DecayEngine         │  ← 独立
  │  ProfileEngine       │  ← 独立
  └──────────────────────┘
```

---

## 3. 核心流程图

### 3.1 安装流程

```mermaid
flowchart TD
    A[用户执行 `npm install -g @clio/cli`] --> B[用户执行 `clio install`]
    B --> C[创建 ~/.clio/ 目录结构]
    C --> D["初始化 SQLite 数据库<br>执行 initSchema()"]
    D --> E{config.json 存在?}
    E -->|否| F[写入默认配置]
    E -->|是| G[跳过]
    F --> H[读取 ~/.claude/settings.json]
    G --> H
    H --> I["添加 MCP Server 配置<br>command: node dist/server.js"]
    I --> J["添加 5 个 Hook<br>指向 dist/hooks/*.js"]
    J --> K[保存 settings.json]
    K --> L["验证: IPC socket 可连接?<br>SQLite 可读写?"]
    L -->|失败| M[报错输出]
    L -->|成功| N[输出 ✓ Clio installed]
```

### 3.2 捕获流程（PostToolUse）

```mermaid
flowchart TD
    A[PostToolUse Hook 触发] --> B{工具在白名单?}
    B -->|Read/Glob/ls/git status| C[跳过, 不处理]
    B -->|其他工具| D["读取 toolName + toolOutput<br>截断至 2048 chars"]
    D --> E[脱敏: 正则替换 API Key / Token / 路径]
    E --> F[内容长度 < 10?]
    F -->|是| G[丢弃]
    F -->|否| H[SHA-256 哈希, 5 分钟窗口去重]
    H -->|重复| I[丢弃]
    H -->|新内容| J["写入 working_memories 表<br>session_id + source='tool_use'"]
```

### 3.3 偏好检测流程（UserPromptSubmit）

```mermaid
flowchart TD
    A[UserPromptSubmit Hook 触发] --> B[读取用户输入文本]
    B --> C{匹配 correction 模式?}
    C -->|是| D["写入 working_memories<br>pattern_type='correction'<br>confidence=0.7"]
    C -->|否| E{匹配 preference 模式?}
    E -->|是| F["写入 working_memories<br>pattern_type='preference'<br>confidence=0.5"]
    E -->|否| G{匹配 decision 模式?}
    G -->|是| H["写入 working_memories<br>pattern_type='decision'<br>confidence=0.5"]
    G -->|否| I[仅检索记忆, 不写入]
    D --> J[实时检索: BM25 + 向量 + RRF]
    F --> J
    H --> J
    I --> J
    J --> K["Top-3 记忆注入<br>UserPromptSubmit additional_context"]
```

### 3.4 会话结束压缩流程（Stop）

```mermaid
flowchart TD
    A[Stop Hook 触发] --> B[收集本次所有 working_memories]
    B --> C["组装 LLM Prompt<br>从对话中提取 1-5 条关键信息"]
    C --> D[调用 Anthropic API]
    D -->|失败| E["跳过本次压缩<br>工作记忆保留到下次重试"]
    D -->|成功| F[解析 JSON 结果]
    F --> G[逐条处理:]
    G --> H{脱敏 → 去重 → 去噪}
    H -->|重复或无效| I[丢弃]
    H -->|新有效记忆| J[写入 semantic_memories]
    J --> K[更新 FTS5 索引]
    K --> L[生成向量嵌入 → 写入 memories_vec]
    L --> M["触发 InstinctEngine.detect()"]
    M --> N["触发 DecayEngine.run()"]
    N --> O["触发 ProfileEngine.sync()"]
    O --> P[清理本会话的 working_memories]
```

### 3.5 召回流程（SessionStart + UserPromptSubmit）

```mermaid
flowchart TD
    subgraph SessionStart
        A[SessionStart Hook] --> B[""调用 getInitialContext()""]
        B --> C["查询 semantic_memories<br>confidence>=0.7<br>排序: access*0.3+confidence*0.7"]
        C --> D[取 Top-5 + profile 全部条目]
        D --> E["组装 ~500 tokens<br>注入 system prompt"]
    end

    subgraph UserPromptSubmit
        F[用户输入] --> G[""调用 recallRelevant(text)""]
        G --> H[input → embedding → 向量检索 Top-10]
        G --> I[BM25 FTS5 检索 Top-10]
        H --> J[RRF 融合排序]
        I --> J
        J --> K[取 Top-3]
        K --> L[更新 access_count + last_accessed]
        L --> M[注入 additional_context]
    end
```

### 3.6 Instinct 进化流程

```mermaid
flowchart TD
    A["Stop: 新语义记忆写入"] --> B[""InstinctEngine.detect()""]
    B --> C["遍历每条新记忆"]
    C --> D{"topic 为空?"}
    D -->|是| E["跳过"]
    D -->|否| F{""instincts 表已有<br>相同 topic+value?""}
    F -->|否| G["创建 instinct<br>confidence=0.3, hit_count=1"]
    F -->|是| H["hit_count+1"]
    H --> I[""confidence = min(0.7, 0.3+hit*0.15)""]
    I --> J{""confidence >= 0.7<br>AND status = pending?""}
    J -->|否| K["更新 instinct"]
    J -->|是| L[""promoteToSemantic()""]
    L --> M["创建 pattern 类型语义记忆"]
    M --> N["instinct.status = promoted"]

    O[""0.3: 初始值 (首次出现)""] -.- P["0.45: hit=1 提升"]
    P -.- Q["0.6: hit=2"]
    Q -.- R["0.7: hit=3 达到 promotion 条件"]
```

### 3.7 衰减流程

```mermaid
flowchart TD
    A["DecayEngine.run() 触发<br>（每次 Stop + 手动 prune）"] --> B[语义记忆衰减]
    B --> C[遍历未归档记忆]
    C --> D{距最后访问 > 30 天?}
    D -->|否| E[跳过]
    D -->|是| F["confidence -= (N/30)*0.1<br>N = 距访问天数"]
    F --> G[归档判定]
    G --> H{"confidence < 0.1<br>OR<br>(confidence<0.3 AND 90天未访问)?"}
    H -->|是| I[is_archived = 1]
    H -->|否| J[保留]
    C --> K{还有下一条?}
    K -->|是| C
    K -->|否| L[过期 instinct]
    L --> M["status = 'expired'<br>last_hit > 30 天前"]
    M --> N[清理工作记忆]
    N --> O["DELETE working_memories<br>created_at < 7 天前"]
```

---

## 4. 进程模型

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Hook as Hook 脚本 (shim)
    participant IPC as Unix Socket
    participant Clio as Clio 常驻进程

    Note over Clio: 启动时: initSchema, load embedding model, start IPC server

    CC->>Hook: SessionStart
    Hook->>IPC: connect + send('recall_initial_context')
    IPC->>Clio: handleIpcRequest()
    Clio->>Clio: RecallEngine.getInitialContext()
    Clio-->>IPC: { data: "...profile + top-5 memories..." }
    IPC-->>Hook: JSON response
    Hook-->>CC: stdout → additional_context (~500 tokens)

    CC->>Hook: UserPromptSubmit
    Hook->>IPC: send('detect_preferences', { text })
    Hook->>IPC: send('recall_relevant', { text })
    IPC->>Clio: handle (parallel)
    Clio-->>IPC: preferences + memories
    IPC-->>Hook: response
    Hook-->>CC: stdout → additional_context (< 300 tokens)

    CC->>Hook: PostToolUse (×N per session)
    Hook->>IPC: send('capture_observation', { toolName, toolOutput })
    IPC->>Clio: CaptureEngine.observe()
    Clio-->>IPC: ack
    IPC-->>Hook: done (~1ms)

    CC->>Hook: Stop
    Hook->>IPC: send('summarize_session', { sessionId })
    IPC->>Clio: CaptureEngine.summarizeSession()
    Clio->>Clio: collect working_memories
    Clio->>Clio: LLM: extract facts
    Clio->>Clio: store + index + embed
    Clio->>Clio: InstinctEngine.detect()
    Clio->>Clio: DecayEngine.run()
    Clio->>Clio: ProfileEngine.sync()
    Clio-->>IPC: done
    IPC-->>Hook: response
```

---

## 5. 目录依赖关系

```
src/
├── index.ts              # CLI 入口 (bin)
│   └── 依赖: config.ts, storage/database.ts
├── server.ts             # 常驻进程入口
│   └── 依赖: 全部 engines + storage + ipc + config
├── config.ts             # 无依赖
├── ipc/
│   ├── protocol.ts       # 无依赖（纯类型定义）
│   └── server.ts         # 依赖: config.ts
├── storage/
│   ├── database.ts       # 依赖: better-sqlite3
│   └── embedding.ts      # 依赖: @xenova/transformers, config.ts
├── engines/
│   ├── capture.ts        # 依赖: database.ts, instinct/decay/profile engines
│   ├── recall.ts         # 依赖: database.ts, embedding.ts
│   ├── instinct.ts       # 依赖: database.ts
│   ├── decay.ts          # 依赖: database.ts, config.ts
│   └── profile.ts        # 依赖: database.ts
└── hooks/
    ├── ipc-client.ts     # 依赖: net (Node built-in)
    ├── session-start.ts  # 依赖: ipc-client.ts
    ├── prompt-submit.ts  # 依赖: ipc-client.ts
    ├── post-tool-use.ts  # 依赖: ipc-client.ts
    ├── pre-compact.ts    # 依赖: ipc-client.ts
    └── stop.ts           # 依赖: ipc-client.ts
```
