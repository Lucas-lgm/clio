# Clio MVP 技术方案

> 版本：v0.1  
> 日期：2026-05-15

---

## 1. 系统架构总览

```
┌────────────────────────────────────────────────────┐
│                   Claude Code                       │
│                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Hook     │  │ Hook         │  │ Hook          │ │
│  │ Session  │  │ UserPrompt   │  │ PostToolUse   │ │
│  │ Start    │  │ Submit       │  │ /Stop/Compact │ │
│  └────┬─────┘  └──────┬───────┘  └──────┬────────┘ │
│       │               │                 │           │
│       │         ┌─────▼─────┐           │           │
│       │         │   MCP     │           │           │
│       └─────────►  Client   │◄──────────┘           │
│                 └─────┬─────┘                       │
└───────────────────────┼─────────────────────────────┘
                        │
          stdio MCP protocol
                        │
┌───────────────────────▼─────────────────────────────┐
│              Clio 进程（Node.js）                      │
│                                                     │
│  同一个进程服务两种角色:                                │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │  MCP Server          │  │  Hook Handler (IPC)  │  │
│  │  (Claude Code 管理)   │  │  (Unix socket)       │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  │
│             │                        │               │
│  ┌──────────▼────────────────────────▼───────────┐  │
│  │              Core Engine                       │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │ Capture  │ │ Recall   │ │ Instinct     │   │  │
│  │  │ Engine   │ │ Engine   │ │ Engine       │   │  │
│  │  └──────────┘ └──────────┘ └──────────────┘   │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │ Decay    │ │ Profile  │ │ Embedding    │   │  │
│  │  │ Engine   │ │ Engine   │ │ Service      │   │  │
│  │  └──────────┘ └──────────┘ └──────────────┘   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │           Storage Layer                        │  │
│  │  ┌──────────────┐  ┌──────────┐  ┌─────────┐  │  │
│  │  │ better-      │  │  FTS5    │  │ sqlite- │  │  │
│  │  │ sqlite3      │  │ (builtin)│  │ vec     │  │  │
│  │  └──────────────┘  └──────────┘  └─────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 1.1 设计原则

| 原则 | 含义 |
|------|------|
| **单进程架构** | MCP Server + Hook Handler 在同一个 Node.js 进程中，通过 Unix socket 处理 Hook 请求，共享内存和 DB 连接 |
| **一次 LLM 调用 / session** | 只在 Stop Hook 时调用 LLM 压缩，日常处理纯规则 |
| **SQLite 单文件存储** | 不依赖外部数据库，安装即用 |
| **无状态 Hook** | 每个 Hook 调用独立，通过 Unix socket 发往常驻进程处理 |

### 1.2 技术选型

| 层 | 技术 | 理由 |
|----|------|------|
| 运行时 | Node.js 20+ | 用户熟悉 Node 生态，hook 启动快 (~1ms) |
| MCP SDK | `@modelcontextprotocol/sdk` | Anthropic 官方参考实现，最成熟 |
| Hook 脚本 | Node.js | 通过 Unix socket 与常驻进程通信，极低延迟 |
| 存储 | `better-sqlite3` + FTS5 + `sqlite-vec` | 同步 API，单文件，内建全文+向量检索 |
| Embedding | `@xenova/transformers` | 纯 JS 端侧推理 all-MiniLM-L6-v2，wasm 加速 |
| CLI 安装 | Node.js | 与核心包统一，`npm install -g clio` 一行安装 |
| LLM 调用 | Anthropic SDK | 复用 Claude Code 的 API key 和环境配置 |

---

## 2. 进程模型

### 2.0 核心差异：单进程架构

与 Python 方案不同，TypeScript 方案的核心优势是可以让 Hook 脚本通过 Unix socket 与常驻进程通信：

```
Clio 进程（常驻，由 MCP 配置启动）
  ├── MCP Server (stdio transport) ← Claude Code MCP Client
  ├── Unix Socket Server (ipc)     ← Hook 脚本
  ├── Core Engines (capture/recall/instinct/decay)
  ├── SQLite (better-sqlite3, 同步, 无需连接池)
  └── Embedding Model (加载在内存, 共享)

Hook 脚本（短暂进程，每次 Hook 事件创建一个）
  ├── 连接 Unix socket
  ├── 发送请求 (JSON)
  ├── 接收响应 (JSON)
  └── 退出 (~1ms 总耗时)
```

为什么这样设计：
- **Embedding 模型只加载一次**（~80MB 内存），Hook 不需要重复加载
- **SQLite 连接只有常驻进程持有**，避免 better-sqlite3 的 WAL 锁竞争
- **Hook 脚本纯透传**，逻辑在常驻进程里，改逻辑不需要改 Hook
- **Unix socket 比 HTTP 更轻量**，比 subprocess 更快

#### 2.1.1 总览

Hook 脚本是薄 IPC 透传层，通过 Unix socket 与常驻 Clio 进程通信：

| Hook 事件 | 脚本 | 职责 |
|-----------|------|------|
| `SessionStart` | `session-start.ts` | 请求 Recall Engine 获取初始上下文，注入 system prompt |
| `UserPromptSubmit` | `prompt-submit.ts` | 请求模式匹配 + 实时检索，注入相关记忆 |
| `PostToolUse` | `post-tool-use.ts` | 发送工具名+输出到 Capture Engine |
| `PreCompact` | `pre-compact.ts` | 通知常驻进程保存当前会话快照 |
| `Stop` | `stop.ts` | 通知常驻进程执行压缩 + 检测 + 衰减 |

Hook 脚本模板：

```typescript
// post-tool-use.ts（简化示意）
import { connectToClio } from './ipc';

async function main() {
  const toolName = process.env.CLAUDE_TOOL_NAME;
  const toolOutput = process.env.CLAUDE_TOOL_OUTPUT?.slice(0, 2048);
  if (SKIP_TOOLS.includes(toolName)) return;

  const client = connectToClio();
  await client.send('capture_observation', { toolName, toolOutput });
  client.close();
}

main().catch(() => process.exit(0));
```

#### 2.1.2 SessionStart Hook

```
触发时机: 每次新会话启动时

行为:
  1. 调用 RecallEngine.get_initial_context()
  2. 获取返回值格式: { profile_snippet, top_memories: [...], instinct_count }
  3. 输出到 stdout（Claude Code 会将 Hook stdout 作为 additional_context）
     → 注入系统提示（~500 tokens）
  
注入内容格式（静默，用户不可见）:
  <!-- clio: user profile -->
  - prefers: asyncpg, pytest, single quotes, ruff
  - known stack: FastAPI, SQLAlchemy 2.0, Redis
  - recent decisions: [使用 asyncpg 而非 psycopg2，因性能]
  
约束:
  - 注入 token 数 ≤ config.recall.budget.session_start（默认 500）
  - 无记忆时不注入任何内容（退化安全）
```

#### 2.1.3 PostToolUse Hook

```
触发时机: 每次工具调用完成后

行为:
  1. 读取环境变量 CLAUDE_TOOL_NAME + CLAUDE_TOOL_OUTPUT（截断至 2048 chars）
  2. 跳过白名单中的工具: Read, Glob, ls, git status, git log 等
  3. 对非跳过工具: 调用 CaptureEngine.observe(name, output)
     → 写入 SQLite working_memories 表
  
注意: PostToolUse 频率极高，必须轻量。
  - 不做 LLM 调用
  - 不做网络请求
  - 纯 SQLite INSERT
```

#### 2.1.4 UserPromptSubmit Hook

```
触发时机: 用户每次发送消息前

行为:
  1. 读取环境变量获取用户输入文本
  2. 调用 CaptureEngine.detect_preferences(text)
  3. 内部流程: 正则匹配 → 匹配到则写入 SQLite working_memories
  4. 同时调用 RecallEngine.recall_relevant(text)
     → 输出相关记忆到 stdout，注入 UserPromptSubmit 的 additional_context
  
规则匹配模式（正则，实现于 CaptureEngine 内）:
  偏好: /(?:我喜欢用|prefer|always use|习惯用|用.+不要用|best practice)/i
  纠正: /(?:不对|不是|错了|should be|应该用|不用.+用)/i
  决策: /(?:选择.+因为|决定用|use.+because|migrate|upgrade|downgrade)/i
  
  每条匹配附带:
  - matched_text: 匹配到的原始文本片段
  - pattern_type: preference | correction | decision
  - confidence: 0.5 (初始值，第一次出现)
```

#### 2.1.5 Stop Hook

```
触发时机: 会话结束时

行为:
  1. 调用 CaptureEngine.summarize_session(session_id)
  2. 内部流程:
     a. 从 working_memories 收集本次所有工作记忆
     b. 调用一次 LLM: "从以下对话记录中提取 1-5 条事实、偏好或决策"
     c. 对每条结果做:
        - 脱敏（正则过滤 API key / 路径）
        - 去重（SHA-256 hash 对比已有语义记忆）
        - 去噪（长度 < 20 chars 丢弃，无具体内容丢弃）
     d. 写入 semantic_memories 表
     e. 触发 InstinctEngine.detect()（见 2.6）
     f. 触发 DecayEngine.run()（见 2.7）
  3. 清理工作记忆
```

#### 2.1.6 PreCompact Hook

```
触发时机: Claude Code 即将执行上下文压缩前

行为:
  1. 读取当前 Hook 上下文中的会话 ID
  2. 将当前会话关键状态写入 SQLite working_memories（标记 compact_checkpoint）
  
目的: 压缩后 Hook 上下文丢失，通过此机制保留状态
```

---

### 2.2 MCP Server

#### 2.2.1 进程模型

- 通过 Claude Code 的 MCP 配置自动启动（`stdio` 传输）
- 与 Claude Code 同生命周期
- 启动时加载 embedding 模型到内存（~80MB）

#### 2.2.2 MCP 工具暴露

| 工具名 | 用途 | 调用方 |
|--------|------|--------|
| `capture_observation` | 记录一次工具调用观察 | PostToolUse Hook |
| `detect_preferences` | 检测用户输入中的偏好/纠正 | UserPromptSubmit Hook |
| `recall_initial_context` | 获取会话启动上下文 | SessionStart Hook |
| `recall_relevant` | 按用户输入检索相关记忆 | UserPromptSubmit Hook |
| `summarize_session` | 会话结束压缩 | Stop Hook |
| `save_session_snapshot` | 保存当前会话快照 | PreCompact Hook |
| `memorize` | 手动写入记忆 | MCP Client (Claude) |
| `recall` | 手动搜索记忆 | MCP Client (Claude) |
| `forget` | 删除记忆 | MCP Client (Claude) |
| `get_profile` | 获取画像摘要 | MCP Client (Claude) |
| `list_instincts` | 列出 instinct | MCP Client (Claude) |

---

### 2.3 存储层

#### 2.3.1 SQLite 表结构

```sql
-- 语义记忆（持久化，跨会话）
CREATE TABLE semantic_memories (
    id          TEXT PRIMARY KEY,          -- uuid
    content     TEXT NOT NULL,             -- 记忆内容
    memory_type TEXT NOT NULL,             -- fact | preference | decision | pattern
    topic       TEXT,                      -- 主题标签（如 "database-driver"）
    value       TEXT,                      -- 值（如 "asyncpg"）
    confidence  REAL DEFAULT 0.5,          -- 0.0 - 1.0
    source_session TEXT,                   -- 来源会话 ID
    access_count INTEGER DEFAULT 0,        -- 被召回次数
    last_accessed TEXT,                    -- ISO8601 最后访问时间
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now')),
    conflict_id TEXT,                      -- 如果存在矛盾，指向另一条记忆 ID
    is_archived INTEGER DEFAULT 0          -- 是否已归档（衰减清理）
);

-- 原始工作记忆（会话结束清理）
CREATE TABLE working_memories (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    source      TEXT NOT NULL,             -- tool_use | user_prompt
    content     TEXT NOT NULL,
    pattern_type TEXT,                     -- preference | correction | decision | null
    created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_working_session ON working_memories(session_id);

-- Instinct（低置信度模式检测结果）
CREATE TABLE instincts (
    id          TEXT PRIMARY KEY,
    topic       TEXT NOT NULL,
    value       TEXT NOT NULL,
    confidence  REAL DEFAULT 0.3,          -- 初始 0.3
    hit_count   INTEGER DEFAULT 1,         -- 检测到多少次
    last_hit    TEXT DEFAULT (datetime('now')),
    created_at  TEXT DEFAULT (datetime('now')),
    status      TEXT DEFAULT 'pending'     -- pending | promoted | expired
);

-- 会话记录
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    project_path TEXT,
    summary     TEXT,                      -- LLM 压缩结果
    started_at  TEXT,
    ended_at    TEXT,
    tool_count  INTEGER DEFAULT 0,
    token_estimate INTEGER DEFAULT 0
);

-- 用户画像
CREATE TABLE profile (
    key         TEXT PRIMARY KEY,          -- 如 "code_style.quotes"
    value       TEXT NOT NULL,             -- 如 "single"
    confidence  REAL DEFAULT 0.5,
    source      TEXT,                      -- 来源描述
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- FTS5 全文索引（用于快速检索记忆内容）
CREATE VIRTUAL TABLE memories_fts USING fts5(
    content, topic, value,
    content='semantic_memories',
    content_rowid='rowid'
);

-- 向量索引（sqlite-vec）
-- CREATE VIRTUAL TABLE memories_vec USING vec0(
--     id TEXT PRIMARY KEY,
--     embedding float[384]
-- );
-- 注: sqlite-vec 的具体语法可能因版本不同，此处为逻辑表示
```

#### 2.3.2 数据库位置

```
全局: ~/.clio/data/clio.db
项目: <project>/.clio/data/clio.db（存在时覆盖全局）
```

#### 2.3.3 向量检索策略（MVP）

MVP 不求高性能向量检索，使用 sqlite-vec 在 SQLite 内建向量索引：

```typescript
// 1. 文本 → embedding（all-MiniLM-L6-v2）
// 2. 存储: sqlite-vec 表
// 3. 检索: cosine similarity
// 4. 融合排序: 向量结果 Top-5 + BM25(FTS5) Top-5 → RRF 重排
```

---

### 2.4 Capture Engine（捕获引擎）

#### 2.4.1 处理流程

```
接收原始输入
    │
    ▼
┌──────────────┐
│ 1. 格式检查   │── 空/过短/无意义 → 丢弃
└──────┬───────┘
       ▼
┌──────────────┐
│ 2. 脱敏过滤   │── API Key / Token / 路径 → 替换为 [REDACTED]
└──────┬───────┘
       ▼
┌──────────────┐
│ 3. 去重检查   │── SHA-256 hash，5 分钟内同 hash → 丢弃
└──────┬───────┘
       ▼
┌──────────────┐
│ 4. 类型分类   │── preference / correction / decision / null
└──────┬───────┘
       ▼
   写入工作记忆表
```

#### 2.4.2 脱敏规则（正则实现，无 LLM）

```typescript
const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/api[_-]?key["']?\s*[:=]\s*["']?[\w-]{16,}/i, 'API_KEY_REDACTED'],
  [/AKIA[0-9A-Z]{16}/, 'AWS_KEY_REDACTED'],
  [/sk-[a-zA-Z0-9]{32,}/, 'OPENAI_KEY_REDACTED'],
  [/\/Users\/[^/\s]+\//, '/Users/[USER]/'],
  [/token["']?\s*[:=]\s*["']?[\w-]{16,}/i, 'TOKEN_REDACTED'],
  [/ghp_[A-Za-z0-9_]{36}/, 'GITHUB_TOKEN_REDACTED'],
];
```

#### 2.4.3 分类器（规则实现，无 LLM）

```typescript
// 优先匹配 correction（权重最高）
const CORRECTION_PATTERNS = [
  /(不对|不是这样|错了|不应该|不要用|stop|wrong|incorrect)/i,
  /(should be|should use|ought to be|better to use)/i,
  /(不用\w+用|不要\w+要)/i,
];

const PREFERENCE_PATTERNS = [
  /(我喜欢用|prefer|always use|习惯用|i like|i use)/i,
  /(best practice|recommend|建议使用|推荐)/i,
  /(用\w+就好|用\w+就行)/i,
];

const DECISION_PATTERNS = [
  /(选择\w+因为|决定用|choose|decided|migrate|upgrade|downgrade)/i,
  /(use\s+\w+\s+because|migrating\s+(from|to)|switched\s+(from|to))/i,
  /(原因|理由|because|due to|目的是)/i,
];
```

---

### 2.5 Recall Engine（召回引擎）

#### 2.5.1 会话启动召回

```
recall_initial_context() 调用:
  1. 从 semantic_memories 中选取:
     - confidence >= 0.7
     - 按 (access_count × 0.3 + confidence × 0.7) 排序
     - 取 Top-5
  2. 从 profile 中选取所有条目
  3. 组装为 string，总 token ≤ 500
  4. 返回给 SessionStart Hook
```

#### 2.5.2 对话中实时召回

```
用户输入 → UserPromptSubmit → recall_relevant(input):
  1. 将 input 做 embedding → 向量检索 Top-10
  2. 从 FTS5 做 BM25 检索 Top-10
  3. RRF 融合排序，取 Top-3
  4. 更新 access_count 和 last_accessed
  5. 结果注入 UserPromptSubmit 的 additional_context
```

#### 2.5.3 RRF 融合排序

```typescript
function rrf(
  resultsVector: { id: string }[],
  resultsBm25: { id: string }[],
  k = 60,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const [rank, item] of resultsVector.entries()) {
    scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank));
  }
  for (const [rank, item] of resultsBm25.entries()) {
    scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
```

---

### 2.6 Instinct Engine（模式检测）

#### 2.6.1 触发时机

Stop Hook 的 `summarize_session()` 压缩出新的语义记忆后触发。

#### 2.6.2 检测逻辑

```typescript
/**
 * 跨会话模式检测: 当同一 topic+value 在不同会话中反复出现
 * (在 Stop Hook 时由 LLM 提取到语义记忆中) 时累加 confidence。
 */
async function detectInstincts(
  sessionId: string,
  db: Database,
): Promise<void> {
  const newMemories = db
    .prepare('SELECT * FROM semantic_memories WHERE source_session = ?')
    .all(sessionId);

  for (const mem of newMemories) {
    if (!mem.topic) continue; // 无主题标签的不参与模式检测

    const existing = db
      .prepare('SELECT * FROM instincts WHERE topic = ? AND value = ?')
      .get(mem.topic, mem.value);

    if (existing) {
      // 该模式再次出现 → hit_count +1, confidence 提升
      existing.hit_count += 1;
      existing.confidence = Math.min(0.7, 0.3 + existing.hit_count * 0.15);
      existing.last_hit = new Date().toISOString();

      db
        .prepare(
          'UPDATE instincts SET hit_count = ?, confidence = ?, last_hit = ? WHERE id = ?',
        )
        .run(existing.hit_count, existing.confidence, existing.last_hit, existing.id);

      // confidence >= 0.7 且尚未 promoted → 提升为语义记忆
      if (existing.confidence >= 0.7 && existing.status === 'pending') {
        await promoteToSemantic(existing, db);
        db
          .prepare("UPDATE instincts SET status = 'promoted' WHERE id = ?")
          .run(existing.id);
      }
    } else {
      // 首次出现该模式 → 创建 instinct（初始 confidence 0.3）
      db
        .prepare(
          'INSERT INTO instincts (id, topic, value, confidence, hit_count) VALUES (?, ?, ?, 0.3, 1)',
        )
        .run(crypto.randomUUID(), mem.topic, mem.value);
    }
  }
}
```

#### 2.6.3 Instinct → 语义记忆提升条件

```
instinct.hit_count >= 3 AND instinct.confidence >= 0.7
→ 自动创建一条 semantic_memory，instinct.status = 'promoted'
→ 用户无通知
```

---

### 2.7 Decay Engine（衰减引擎）

#### 2.7.1 触发

- 每次 `summarize_session()` 调用时附带执行
- 用户手动 `/memory prune` 时

#### 2.7.2 逻辑

```typescript
function decay(db: Database): void {
  const now = new Date();

  // 1. 语义记忆衰减
  const memories = db
    .prepare('SELECT * FROM semantic_memories WHERE is_archived = 0')
    .all();

  const updateStmt = db.prepare(
    'UPDATE semantic_memories SET confidence = ?, updated_at = ? WHERE id = ?',
  );

  for (const mem of memories) {
    const lastAccess = new Date(mem.last_accessed);
    const daysSinceAccess = Math.floor(
      (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceAccess > 30) {
      const decayAmount = Math.floor(daysSinceAccess / 30) * 0.1;
      mem.confidence = Math.max(0, mem.confidence - decayAmount);
      updateStmt.run(mem.confidence, now.toISOString(), mem.id);
    }
  }

  // 2. 归档低置信度记忆
  db.prepare(`
    UPDATE semantic_memories
    SET is_archived = 1
    WHERE confidence < 0.1
       OR (confidence < 0.3 AND last_accessed < datetime('now', '-90 days'))
  `).run();

  // 3. 过期 instinct（30 天 TTL）
  db.prepare(`
    UPDATE instincts
    SET status = 'expired'
    WHERE status = 'pending'
      AND last_hit < datetime('now', '-30 days')
  `).run();

  // 4. 清理过期工作记忆（保留最近 7 天）
  db.prepare(`
    DELETE FROM working_memories
    WHERE created_at < datetime('now', '-7 days')
  `).run();
}
```

---

### 2.8 用户画像

#### 2.8.1 学习方式

画像从 semantic_memories 中自动提炼。每条 memory_type='preference' 且 confidence >= 0.7 的记忆，同步写入 profile 表：

```typescript
function syncProfile(db: Database): void {
  const prefs = db
    .prepare(
      `SELECT topic, value, confidence
       FROM semantic_memories
       WHERE memory_type IN ('preference', 'decision')
         AND confidence >= 0.7`,
    )
    .all();

  for (const p of prefs) {
    const profileKey = `tech_stack.${p.topic}`;
    const existing = db
      .prepare('SELECT * FROM profile WHERE key = ?')
      .get(profileKey) as ProfileRow | undefined;

    if (existing) {
      if (existing.value === p.value) {
        existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      } else {
        existing.confidence = Math.max(0.1, existing.confidence - 0.2);
      }
      db
        .prepare('UPDATE profile SET confidence = ?, updated_at = ? WHERE key = ?')
        .run(existing.confidence, new Date().toISOString(), profileKey);
    } else {
      db
        .prepare(
          'INSERT INTO profile (key, value, confidence) VALUES (?, ?, ?)',
        )
        .run(profileKey, p.value, p.confidence);
    }
  }
}
```
```

---

## 3. 安装与配置

### 3.1 安装流程

```bash
# 用户执行
npm install -g @clio/cli
clio install

# clio install 命令执行:
#   a. 创建 ~/.clio/ 目录结构和 SQLite DB
#   b. 下载 embedding 模型到 ~/.clio/models/
#   c. 修改 ~/.claude/settings.json:
#      - 添加 MCP Server 配置 (node dist/server.js)
#      - 添加 Hook 配置 (指向 dist/hooks/*.js)
#   d. 启动 Clio 进程验证:
#      - Unix socket 可连接
#      - SQLite 可读写
#      - Embedding 模型已加载
```

### 3.2 配置

```jsonc
// ~/.claude/settings.json (clio install 自动生成)
{
  "mcpServers": {
    "clio": {
      "command": "node",
      "args": ["/path/to/clio/dist/server.js"],
      "env": {
        "CLIO_HOME": "/Users/xxx/.clio"
      }
    }
  },
  "hooks": {
    "SessionStart": "node /path/to/clio/dist/hooks/session-start.js",
    "UserPromptSubmit": "node /path/to/clio/dist/hooks/prompt-submit.js",
    "PostToolUse": "node /path/to/clio/dist/hooks/post-tool-use.js",
    "PreCompact": "node /path/to/clio/dist/hooks/pre-compact.js",
    "Stop": "node /path/to/clio/dist/hooks/stop.js"
  }
}
```

### 3.3 配置项

```jsonc
// ~/.clio/config.json (安装时生成)
{
  "version": "1.0.0",
  "recall": {
    "budget_session_start": 500,     // 会话启动注入 token 上限
    "budget_per_query": 300,         // 每次实时检索注入 token 上限
    "top_k_startup": 5,             // 启动时加载记忆条数
    "top_k_realtime": 3             // 实时检索条数
  },
  "capture": {
    "sensitivity": "medium",        // high | medium | low
    "max_tool_output_chars": 2048,  // 截断长度
    "dedup_window_seconds": 300     // 去重窗口（5分钟）
  },
  "decay": {
    "confidence_decay_per_30d": 0.1,
    "archive_threshold": 0.1,       // 归档阈值
    "instinct_ttl_days": 30
  },
  "storage": {
    "global_dir": "~/.clio",
    "max_semantic_memories": 500    // 超过后触发强制清理
  }
}
```

---

## 4. LLM 调用策略

### 4.1 调用点（仅此一处）

```
Stop Hook
  → CaptureEngine.summarizeSession(sessionId)
    → LLM 调用 (1次 @ Anthropic SDK)
      → prompt: "从以下对话记录中提取 1-5 条关键信息。只包含:
                 1. 用户明确的技术偏好
                 2. 重要的技术决策（含理由）
                 3. 纠正过 Claude 的内容
                 请以 JSON 格式输出，每条包含 content, type, topic, value"
```

### 4.2 输入

当前会话的所有工作记忆 + 最近 N 条用户消息。

### 4.3 模型选择

默认使用 Claude Code 当前使用的模型（通过环境变量 `ANTHROPIC_API_KEY` 调用 Anthropic API）。
用户可配置为其他模型（`clio.config.llm`）。

### 4.4 Token 消耗估算

```
平均每次 Stop 调用: ~2000 tokens (输入) + ~300 tokens (输出) = ~2300 tokens
按每天 20 个会话计算: ~46,000 tokens/天
≈ 1,380,000 tokens/月
≈ $2-3/月 (Sonnet 4.6)
```

---

## 5. 退化安全

| 场景 | 行为 |
|------|------|
| MCP Server 启动失败 | Hook 中 try-catch 捕获异常，静默失败。Claude Code 正常使用 |
| SQLite 写入失败 | Hook 吞异常，不影响主流程 |
| Embedding 模型加载失败 | Stop Hook 跳过向量索引更新，FTS5 检索降级为纯 BM25 |
| LLM 调用超时/失败 | Stop Hook 跳过压缩，当前会话工作记忆保留到下次 Stop 时重试 |
| 记忆库为空 | 不注入任何上下文，退化到原生 Claude Code |
| 磁盘空间不足 | Capture Engine 跳过写入，不报错 |

---

## 6. 目录结构（最终）

```
~/.clio/
  ├── config.json
  ├── data/
  │   ├── clio.db
  │   └── clio.db-wal / clio.db-shm      # SQLite WAL
  └── models/
      └── all-MiniLM-L6-v2/               # 本地 embedding 模型 (ONNX)

npm install -g @clio/cli:
  node_modules/@clio/cli/
  ├── package.json
  ├── tsconfig.json
  ├── src/
  │   ├── index.ts                        # CLI 入口 (clio install / status / version)
  │   ├── server.ts                       # 常驻进程入口（MCP Server + Unix Socket）
  │   ├── config.ts                       # 配置管理
  │   ├── ipc/
  │   │   └── client.ts                   # Hook → 常驻进程的 Unix socket 客户端
  │   ├── engines/
  │   │   ├── capture.ts                  # Capture Engine（捕获 + 分类 + 脱敏）
  │   │   ├── recall.ts                   # Recall Engine（检索 + RRF 排序）
  │   │   ├── instinct.ts                 # Instinct Engine（模式检测 + 置信度）
  │   │   ├── decay.ts                    # Decay Engine（衰减 + 归档）
  │   │   └── profile.ts                  # 用户画像（自动提炼）
  │   ├── storage/
  │   │   ├── database.ts                 # SQLite 操作封装（建表 + CRUD）
  │   │   └── embedding.ts               # 向量嵌入封装（@xenova/transformers）
  │   └── hooks/                          # Hook 脚本源代码
  │       ├── ipc.ts                      # 共享 IPC 连接逻辑
  │       ├── session-start.ts
  │       ├── prompt-submit.ts
  │       ├── post-tool-use.ts
  │       ├── pre-compact.ts
  │       └── stop.ts
  └── dist/                               # 编译输出（tsc）
      ├── server.js
      └── hooks/*.js
```

---

## 7. 开发里程碑

| 阶段 | 内容 | 预估 |
|------|------|------|
| **M1: 基础设施** | CLI 工具（install/status）、单进程骨架（MCP Server + Unix socket IPC）、SQLite schema、配置管理 | 3天 |
| **M2: 捕获** | PostToolUse + UserPromptSubmit + Stop Hook 脚本、Capture Engine（脱敏/去重/分类）、工作记忆写入 | 3天 |
| **M3: 召回** | SessionStart Hook 注入、Recall Engine、FTS5 检索 + 向量检索、RRF 融合 | 3天 |
| **M4: Instinct + 衰减** | Instinct 检测、置信度管理、自动 promotion、Decay Engine 定时任务 | 3天 |
| **M5: 管理命令** | MCP 工具（`memorize`/`recall`/`forget`/`get_profile`/`list_instincts`） | 2天 |
| **M6: 验证** | 完整 E2E 测试、退化安全验证、性能基准、文档 | 2天 |

---

## 8. 开放问题（MVP 后）

1. **跨项目支持**：全局 vs 项目级 SQLite 的数据合并策略
2. **多工具兼容**：MCP Server 接口如何适配 Cursor/Codex CLI 的 Hook 机制
3. **Skill 系统**：`/learn` 和 `/evolve` 的详细实现（本 spec 未覆盖，留待 V2）
4. **性能基准**：500 条记忆时的检索延迟、1000 条时的衰减
5. **sqlite-vec 正式可用性**：当前 sqlite-vec 是实验性项目，MVP 可用 BM25 降级
