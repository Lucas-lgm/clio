# Clio 场景业务逻辑

> 版本：v0.1  
> 按用户感知顺序，覆盖每个触发点的完整业务逻辑

---

## 场景 1：用户安装

### 触发条件
用户执行 `clio install`

### 业务逻辑

```
1. 创建 ~/.clio/ 目录
   ├── config.json        ← 写入默认配置
   ├── data/
   │   └── clio.db        ← 初始化 SQLite（执行所有 CREATE TABLE）
   └── models/            ← 空目录，embedding 模型按需下载

2. 读取 ~/.claude/settings.json
   ├── 如果文件不存在 → 创建空 JSON { mcpServers: {}, hooks: {} }

3. 在 mcpServers 中添加 clio 条目:
   └── command: "node", args: ["<dist>/server.js"], env: { CLIO_HOME }

4. 在 hooks 中添加 5 个条目:
   ├── SessionStart      → node <dist>/hooks/session-start.js
   ├── UserPromptSubmit  → node <dist>/hooks/prompt-submit.js
   ├── PostToolUse       → node <dist>/hooks/post-tool-use.js
   ├── PreCompact        → node <dist>/hooks/pre-compact.js
   └── Stop              → node <dist>/hooks/stop.js

5. 验证:
   ├── 启动 Clio 进程 → IPC socket 可连接
   ├── SQLite 可读写
   └── 输出 "✓ Clio installed successfully"
```

### 边界情况

| 情况 | 行为 |
|------|------|
| 已安装过（.clio/ 存在） | 保留已有数据，只更新 settings.json |
| settings.json 已有其他 MCP 配置 | 追加 clio 条目，不覆盖已有配置 |
| ~/.claude/ 目录不存在 | 自动创建 |
| Node.js 版本 < 20 | 不处理，运行时报错（由 package.json engines 约束） |

---

## 场景 2：新会话启动（SessionStart）

### 触发条件
用户启动 Claude Code 新会话

### 业务逻辑

```
Hook 收到 SessionStart 事件
  │
  ├─ 通过 Unix socket 调用 recall_initial_context()
  │
  └─ Clio 常驻进程收到请求:
       │
       ├─ 1. 查询 semantic_memories（条件）:
       │     ├─ is_archived = 0
       │     ├─ confidence >= 0.7
       │     └─ 排序: (access_count × 0.3 + confidence × 0.7) DESC
       │        LIMIT config.recall.top_k_startup (默认 5)
       │
       ├─ 2. 查询全部 profile 条目
       │
       ├─ 3. 组装注入文本:
       │     ├─ "<!-- clio: user profile -->"
       │     ├─ "preferences: ..."（来自 profile）
       │     └─ 每条记忆一条: "fact: ..." / "preference: ..."
       │
       ├─ 4. 计算 token 数，超出 budget_session_start (500) 则截断
       │
       └─ 5. 返回组装文本 → Hook 写入 stdout → Claude 系统提示
```

### 注入内容样例

```
<!-- clio: user profile -->
- preferences: tech_stack.database-driver=asyncpg
- preference: 使用 asyncpg 进行数据库操作
- decision: 选择 FastAPI 而非 Django，因为性能要求
- fact: 项目使用 Python 3.12 + uv 作为包管理器
```

### 边界情况

| 情况 | 行为 |
|------|------|
| 记忆库为空 | 返回空字符串 → 不注入任何内容 → Claude 行为无变化 |
| 记忆不到 5 条 | 有多少返回多少 |
| Token 超出预算 | 从低优先级（低 confidence）开始截断 |
| IPC socket 连接失败 | Hook 静默退出（try-catch 吞异常）→ 无注入内容 |
| Embedding 模型未加载 | 不影响，getInitialContext 不依赖 embedding |

---

## 场景 3：用户输入检测（UserPromptSubmit — 偏好/纠正）

### 触发条件
用户每次在 Claude Code 输入框中发送消息

### 业务逻辑

```
Hook 收到 UserPromptSubmit 事件
  │
  ├─ 并行（fire & forget + 等待 recall）:
  │
  ├─ [fire & forget] 调用 detect_preferences(text)
  │   │
  │   └─ Clio 收到请求:
  │        ├─ 依次匹配 3 组正则（按优先级）:
  │        │   [correction]   不对 | 不是 | 错了 | 不应该 | 不要用 | should be
  │        │   [preference]   我喜欢用 | prefer | always use | 习惯用
  │        │   [decision]     决定用 | 选择...因为 | migrate to
  │        │
  │        ├─ 匹配到 → 写入 working_memories:
  │        │   └─ pattern_type = 匹配类型
  │        │      confidence = correction(0.7) | preference(0.5) | decision(0.5)
  │        │
  │        └─ 无匹配 → 不写入
  │
  └─ [await] 调用 recall_relevant(text)
      │
      └─ Clio 收到请求:
           ├─ 1. BM25 检索（FTS5 MATCH）→ Top-10
           ├─ 2. 向量检索（sqlite-vec）→ Top-10（若模型已加载）
           ├─ 3. RRF 融合 → 取 Top-3
           ├─ 4. 更新 access_count + last_accessed
           └─ 5. 返回 Top-3 文本 → Hook 写入 stdout → 注入 additional_context
```

### 边界情况

| 情况 | 行为 |
|------|------|
| 输入为空或长度 < 3 | 跳过偏好检测 + 检索 |
| 无相关记忆 | 注入内容为空 |
| 向量检索不可用（embedding 未加载） | 仅用 BM25 检索 |
| BM25 和向量都不可用 | 返回空 |
| UserPromptSubmit 在 SessionStart 之前触发 | 退化安全：Hook 吞异常 |
| 用户输入同时匹配 correction 和 preference | 取优先级更高的 correction（correction > preference > decision） |

---

## 场景 4：工具调用捕获（PostToolUse）

### 触发条件
每次 Claude Code 执行工具调用后（每轮对话可能触发多次）

### 业务逻辑

```
Hook 收到 PostToolUse 事件
  │
  ├─ 读取环境变量:
  │   ├─ CLAUDE_TOOL_NAME    → toolName
  │   └─ CLAUDE_TOOL_OUTPUT  → toolOutput
  │
  ├─ 过滤白名单工具（以下直接跳过）:
  │   └─ Read, Glob, listFiles, Bash(简单查询), 
  │       TaskList, TaskGet, TaskCreate, TaskUpdate
  │
  └─ 调用 capture_observation(toolName, toolOutput)
      │
      └─ Clio 收到请求:
           ├─ 1. 截断: toolOutput.slice(0, max_tool_output_chars=2048)
           ├─ 2. 脱敏: 依次应用 6 条正则
           │     ├─ api_key / API KEY → API_KEY_REDACTED
           │     ├─ AKIA... → AWS_KEY_REDACTED
           │     ├─ sk-... → OPENAI_KEY_REDACTED
           │     ├─ ghp_... → GITHUB_TOKEN_REDACTED
           │     ├─ token=... → TOKEN_REDACTED
           │     └─ /Users/xxx/ → /Users/[USER]/
           ├─ 3. 长度检查: 脱敏后 < 10 chars → 丢弃
           ├─ 4. SHA-256 去重: 5 分钟内相同 hash → 丢弃
           ├─ 5. 写入 working_memories:
           │     └─ id, session_id, source='tool_use', 
           │        content=脱敏文本, pattern_type=NULL
           └─ 6. 返回 ack
```

### 一轮典型会话的调用次数

```
假设 10 轮对话，每轮 Claude 平均调用 2-3 次工具:
  ┌─ 写操作 (Edit/Write/Bash): ~15-20 次  → 生成 15-20 条工作记忆
  └─ 读操作 (Read/Glob/ls):    ~10-15 次  → 全部跳过

每会话: ~15-20 条工作记忆
```

### 边界情况

| 情况 | 行为 |
|------|------|
| toolOutput 为空 | 跳过（长度 < 10） |
| 工具名为 undefined | 跳过 |
| 连续 5 分钟内相同输出 | 跳过（SHA-256 dedup） |
| 内容包含敏感信息 | 脱敏后存储，不暴露原始值 |
| 脱敏后内容失去意义 | 仍保留（如 "my key is API_KEY_REDACTED"） |

---

## 场景 5：上下文压缩保护（PreCompact）

### 触发条件
Claude Code 即将执行上下文压缩（发生在长对话中）

### 业务逻辑

```
Hook 收到 PreCompact 事件
  │
  └─ 调用 save_session_snapshot({ sessionId })
      │
      └─ Clio 收到请求:
           ├─ 读取 CLAUDE_SESSION_ID
           ├─ 更新 sessions 表:
           │   └─ UPSERT sessions SET tool_count = current_count
           └─ 返回 ack

目的: PreCompact 后 Hook 上下文会丢失。
      sessions 表中保留的 tool_count 用于在 Stop 时估算工作记忆完整性。
```

### 边界情况

| 情况 | 行为 |
|------|------|
| sessionId 未知 | 以 'unknown' 插入 |
| PreCompact 在无工具调用后触发 | tool_count = 0 仍保存 |
| 同一个 session 多次压缩 | 每次覆盖更新 tool_count |

---

## 场景 6：会话结束压缩（Stop）

### 触发条件
用户结束会话（exit / 关闭终端 / 超时）

### 这是唯一调用 LLM 的地方

### 业务逻辑

```
Hook 收到 Stop 事件
  │
  └─ 调用 summarize_session({ sessionId })
      │
      └─ Clio 收到请求:
           │
           ├─ [A] 收集工作记忆
           │    ├─ 查询 working_memories WHERE session_id = ?
           │    ├─ 提取所有 content 字段
           │    └─ 若数据为空 → 跳过 LLM 调用，进入 [F] 清理
           │
           ├─ [B] LLM 压缩（唯一 LLM 调用点）
           │    ├─ 组装 prompt:
           │    │    "从以下对话记录中提取 1-5 条关键信息。只包含:
           │    │     1. 用户明确的技术偏好
           │    │     2. 重要的技术决策（含理由）
           │    │     3. 纠正过 Claude 的内容
           │    │     4. 反复出现的模式
           │    │     请以 JSON 数组格式输出，每条包含
           │    │     content, type(fact|preference|decision|pattern),
           │    │     topic, value"
           │    ├─ 模型: claude-sonnet-4-20250514
           │    ├─ max_tokens: 500
           │    ├─ 输入: ~2000 tokens（工作记忆 + 最近用户消息）
           │    │
           │    ├─ 成功 → 解析 JSON
           │    └─ 失败（超时/异常）→ 跳过压缩，保留工作记忆到下次重试
           │
           ├─ [C] 逐条处理 LLM 结果
           │    ├─ 去噪: content 长度 < 20 → 丢弃
           │    ├─ 去重: content 已存在于 semantic_memories → 丢弃
           │    ├─ 脱敏: 再次应用敏感信息正则
           │    ├─ 写入 semantic_memories:
           │    │   └─ id, content, memory_type, topic, value, 
           │    │      confidence=0.5, source_session=sessionId
           │    ├─ 索引 FTS5: INSERT INTO memories_fts
           │    └─ 索引向量: 调用 EmbeddingService.embed()
           │                → INSERT INTO memories_vec
           │
           ├─ [D] InstinctEngine.detect(sessionId)
           │    ├─ 查询本次新语义记忆
           │    ├─ 对每条有 topic 的记忆:
           │    │   ├─ instincts 表已有相同 topic+value → hit_count++, confidence 提升
           │    │   └─ instincts 表无 → 创建新 instinct (confidence=0.3)
           │    └─ 当 instinct.confidence >= 0.7 → promoteToSemantic()
           │
           ├─ [E] DecayEngine.run()
           │    ├─ 语义记忆衰减: 距最后访问每 30 天 -0.1 confidence
           │    ├─ 归档: confidence < 0.1 → is_archived=1
           │    ├─ 过期 instinct: 30 天未命中 → status=expired
           │    └─ 清理工作记忆: 7 天前 → DELETE
           │
           ├─ [F] ProfileEngine.sync()
           │    ├─ 查询: memory_type IN ('preference','decision') AND confidence >= 0.7
           │    └─ 逐条 upsert 到 profile 表
           │
           └─ [G] 清理
                └─ DELETE working_memories WHERE session_id = ?
```

### LLM 压缩的输入/输出示例

```
输入（~2000 tokens，实际为中文对话）:
  User: 帮我写一个 FastAPI 的数据库连接
  Claude: [生成代码使用 psycopg2]
  User: 不对，用 asyncpg，之前说过了
  Claude: [修正为 asyncpg 实现]

输出（JSON）:
  [
    { "content": "使用 asyncpg 而非 psycopg2 进行 PostgreSQL 连接",
      "type": "preference", "topic": "database-driver", "value": "asyncpg" },
    { "content": "项目使用 FastAPI 框架",
      "type": "fact", "topic": "framework", "value": "FastAPI" }
  ]
```

### Instinct promotion 触发条件

```
一条 instinct 的进化路径:

  首次出现 → confidence=0.3, hit_count=1  (pending)
  第 2 次出现 → confidence=0.45, hit_count=2  (pending)
  第 3 次出现 → confidence=0.6, hit_count=3  (pending)
  第 4 次出现 → confidence=0.75 ≥ 0.7 → promote!
                → 创建 pattern 类型 semantic_memory
                → instinct.status = 'promoted'

需要同一 topic+value 在不同会话中出现 4 次以上。
```

### 边界情况

| 情况 | 行为 |
|------|------|
| 会话中无任何工具调用 | 工作记忆为空 → 跳过 LLM → 直接进入 Decay → 清理 |
| LLM 返回无效 JSON | 解析失败 → try-catch 跳过压缩 → 保留工作记忆 |
| LLM 超时（>10s） | 同上 |
| ANTHROPIC_API_KEY 未设置 | LLM 调用失败 → 跳过压缩 |
| 新记忆与已有记忆完全重复 | SHA-256 去重 → 丢弃 |
| 新记忆过短（< 20 chars） | 去噪 → 丢弃 |
| embedding 模型未加载 | 跳过向量索引写入，不影响其他步骤 |
| 一条 instinct 已经 promoted | 后续命中不再重复 promote |
| multiple values for same topic | 各自独立检测 |

---

## 场景 7：用户管理记忆（MCP Tools）

### 触发条件
用户在 Claude Code 对话中通过斜杠命令调用（由 MCP 工具实现）

### memorize — 手动写入记忆

```
Claude: /remember 项目使用 PostgreSQL 数据库
       │
       └─ MCP Client → 调用 clio memorize
           输入: { content: "项目使用 PostgreSQL", memoryType: "fact", topic: "database", value: "PostgreSQL" }
           输出: "memory saved: <uuid>"

写入: INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence)
      VALUES (?, ?, 'fact', 'database', 'PostgreSQL', 0.7)
      # 手动写入默认 confidence=0.7（高于自动的 0.5）
```

### recall — 手动搜索记忆

```
Claude: /memory recall "数据库"
       │
       └─ MCP Client → 调用 clio recall
           输入: { query: "数据库" }
           输出: "preference: 使用 asyncpg 进行数据库连接
                  decision: 选择 PostgreSQL 而非 MySQL
                  fact: 项目使用 SQLAlchemy 2.0"

检索: 和 recall_relevant 逻辑相同（BM25 + 向量 + RRF）
```

### forget — 删除记忆

```
Claude: /memory forget <id>
       │
       └─ MCP Client → 调用 clio forget
           输入: { id: "xxx" }
           输出: "deleted"

删除: DELETE FROM semantic_memories WHERE id = ?
      DELETE FROM memories_fts WHERE rowid = ?
      DELETE FROM memories_vec WHERE id = ?
```

### get_profile — 查看画像

```
Claude: /profile show
       │
       └─ MCP Client → 调用 clio get_profile
           输出: [
             { "key": "tech_stack.database-driver", "value": "asyncpg", "confidence": 0.8 },
             { "key": "tech_stack.framework", "value": "FastAPI", "confidence": 0.75 },
             { "key": "code_style.quotes", "value": "single", "confidence": 0.7 }
           ]
```

### list_instincts — 查看本能

```
Claude: /instinct list
       │
       └─ MCP Client → 调用 clio list_instincts
           输出: [
             { "topic": "database-driver", "value": "asyncpg", 
               "confidence": 0.6, "hit_count": 3, "status": "pending" }
           ]

只返回 status = 'pending' 的 instinct（已 promoted 的不展示）
```

---

## 场景 8：系统维护（Decay）

### 触发条件
- 每次 Stop Hook 的 summarizeSession 自动附带
- 用户手动触发（预留接口）

### 衰减规则

```
1. 语义记忆衰减:
   每条未被访问的记忆，从 last_accessed 算起:
     └─ 每 30 天 confidence -= 0.1
     └─ 最低降到 0（不会负）
     └─ 被召回一次 → last_accessed 更新 → 倒计时重置

2. 归档条件（满足任一）:
     ├─ confidence < 0.1（完全失效）
     └─ confidence < 0.3 AND 90 天未访问

3. Instinct 过期:
     └─ status = 'pending' AND last_hit > 30 天前 → status = 'expired'

4. 工作记忆清理:
     └─ created_at < 7 天前 → DELETE
```

### 衰减示例

```
第 0 天: 创建记忆 "使用 asyncpg", confidence=0.7
第 30 天: 未被召回 → confidence=0.6
第 60 天: 未被召回 → confidence=0.5
第 90 天: 未被召回 → confidence=0.4 (未到归档阈值 0.3, 保留)
第 120 天: 未被召回 → confidence=0.3
           且距最后访问 120 天 > 90 天 → 归档 is_archived=1

但如果第 45 天被召回过:
第 45 天: last_accessed 更新为第 45 天, confidence 不变(0.6)
第 75 天: 距第 45 天 = 30 天 → confidence=0.5
          ... 倒计时从第 45 天重新算起
```

---

## 场景 9：退化场景

| 失败点 | 表现 | 影响范围 |
|--------|------|----------|
| **MCP Server 无法启动** | process.exit(1)，stderr 输出错误 | Claude Code 正常使用，记忆功能完全不可用 |
| **IPC socket 创建失败** | startIpcServer reject → server crash | 同上 |
| **SQLite 写入失败** | better-sqlite3 抛异常 → try-catch 吞掉 | 该条记忆丢失，后续正常 |
| **Embedding 模型下载失败** | load() reject → isLoaded() 返回 false | 退化到纯 BM25 检索，向量检索不可用 |
| **LLM 调用超时** | Anthropic SDK 抛异常 → summarizeSession 跳过 | 本次 session 不产生新语义记忆，保留工作记忆下次重试 |
| **记忆库为空** | getInitialContext 返回 '' | 不注入上下文，Claude 行为无变化 |
| **磁盘空间不足** | SQLite 写入失败 → try-catch 吞掉 | 逐步丢失新记忆，已有记忆可读 |
| **Hook 脚本报错** | 脚本 crash → Claude Code 内部吞异常 | 该次 Hook 事件失效，不影响后续 |
| **settings.json 被覆盖**（用户升级 Claude Code） | Clio 的 MCP + Hook 配置丢失 | 用户需要重新执行 clio install |

---

## 数据流总结

```
                   捕获（自动）                         管理（手动）
               ┌──────────────┐                 ┌──────────────────┐
               │ PostToolUse   │                 │ /remember        │
               │ UserPrompt    │                 │ /memory recall   │
               │ Submit        │                 │ /memory forget   │
               └──────┬───────┘                 └────────┬─────────┘
                      │                                  │
                      ▼                                  ▼
            ┌─────────────────┐              ┌──────────────────┐
            │ working_memories │              │ semantic_memories│
            │ (临时, 7天过期)   │──Stop LLM──→│ (持久, 置信度衰减) │
            └─────────────────┘  压缩         └────────┬─────────┘
                                                       │
                                         ┌─────────────┼─────────────┐
                                         ▼             ▼             ▼
                                  ┌──────────┐  ┌──────────┐  ┌──────────┐
                                  │ instincts │  │  profile  │  │ FTS5 +   │
                                  │ (模式检测) │  │  (画像)   │  │ Vector   │
                                  └──────────┘  └──────────┘  └──────────┘

                   召回（自动）                         召回（手动）
               ┌──────────────┐                 ┌──────────────────┐
               │ SessionStart  │                 │ /memory recall   │
               │ UserPrompt    │                 │ → 同上检索逻辑    │
               │ Submit        │                 │                  │
               └──────┬───────┘                 └──────────────────┘
                      │
                      ▼
            ┌──────────────────┐
            │ BM25 + Vector    │
            │ → RRF → Top-3/5  │
            │ → 注入 System    │
            │   Prompt         │
            └──────────────────┘
```
