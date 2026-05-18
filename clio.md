# 产品需求文档：Claude Code 智能记忆与技能进化插件

> 文档版本：2.0
> 更新日期：2026-05-15
> 产品代号：**Clio**

---

## 1. 产品概述

### 1.1 一句话定位
**让 Claude Code 变成一个有"长期记忆"且越用越聪明的开发伙伴，记忆与技能跨项目自动沉淀、持续进化。**

### 1.2 解决的核心痛点
| 痛点 | 现状 | Clio 解决后 |
|------|------|----------------|
| **对话健忘** | 每次新会话 Claude 不记得项目偏好、之前的决策 | 自动加载历史相关记忆，无需重复解释 |
| **经验浪费** | 解决过的问题、写过的模板，下次又要重新想 | 自动沉淀为可复用的 Skill，一键调用 |
| **跨项目割裂** | 每个项目的习惯、偏好不互通 | 全局用户画像跨项目生效，同时尊重项目个性 |
| **无法自我进化** | Claude 不会从你的反馈中学习个人风格 | 通过用户画像持续学习你的技术栈、代码风格、常见错误 |

### 1.3 核心价值主张
> **安装一次，越用越懂你。记忆与技能，跟随你跨项目、跨会话，永不丢失。**

---

## 2. 目标用户

### 2.1 主要用户画像

| 维度 | 描述 |
|------|------|
| **身份** | 独立开发者、全栈工程师、技术团队 Leader |
| **使用频率** | 每天使用 Claude Code 4 小时以上 |
| **项目数量** | 同时维护 3+ 个项目，技术栈各异 |
| **痛点** | 反复解释项目结构、技术偏好；重复写类似代码模板；跨项目习惯无法复用 |
| **付费意愿** | 愿意为提升效率的工具付费（如果收费） |

### 2.2 次要用户
- **技术团队**：希望统一团队编码规范和常用 Skill，新人快速上手
- **开源贡献者**：长期参与多个开源项目，希望每个项目能记住各自规范

---

## 3. 核心功能

### 3.1 记忆系统

#### 3.1.1 记忆分层模型（参考 agentmemory 的 4 层结构，结合 Clio 的语义类型）

记忆分为四个层级，从原始观察到成熟知识逐层提炼：

```
工作记忆 (Working)
  └─ 当前会话的原始上下文（会话结束即清理）
     ↓ 会话结束时 LLM 压缩
情景记忆 (Episodic)
  └─ 压缩后的单次会话摘要（保留 30 天，按访问频率衰减）
     ↓ 跨会话模式检测
语义记忆 (Semantic)
  └─ 持久化的事实、偏好、决策（永久保留，可手动删除）
     ↓ 重复 ≥3 次的解决方案
程序化记忆 (Procedural)
  └─ 可复用的 Skill 模板（主动调用或自动推荐）
```

每个记忆条目附带如下元数据：

- **语义类型**：`fact`（事实）/ `preference`（偏好）/ `decision`（决策）/ `pattern`（模式）
- **置信度**（float 0-1）：从 cross-session 一致性自动计算，用户反馈可加权
- **来源会话 ID**：可追溯回原始对话
- **访问计数 + 最后访问时间**：用于遗忘曲线衰减
- **标签**（自动提取的关键词，用于检索加权）

#### 3.1.2 自动记忆捕获

- **触发方式**：每次 Tool Use 后通过 `PostToolUse` Hook 增量捕获；会话结束时 LLM 压缩提炼
- **存储内容**：技术选型、代码结构偏好、用户纠正过的错误、重复出现的模式
- **敏感信息过滤**：自动检测并脱敏 API Key、密钥、文件路径中的用户名、IP 地址等（参考 agentmemory 的隐私过滤器）
- **捕获范围控制**：用户可配置 `clio.capture.sensitivity`（`high`/`medium`/`low`），`high` 仅捕获用户明确 `/remember` 的内容
- **矛盾检测**（参考 agentmemory）：当新记忆与已有记忆冲突时，标记为"待确认"，通过 `/memory resolve` 手动或自动（高置信度覆盖低置信度）解决

#### 3.1.3 记忆衰减与自动维护（从 V2 提升至 V1）

- **Ebbinghaus 遗忘曲线**：记忆的"重要性评分"随时间指数衰减，每次被成功召回则提升
- **自动归档**：重要性低于阈值的语义记忆 → 降级为情景记忆级别 → 最终自动清理
- **定期压缩总结**：每月一次，LLM 对大量低价值记忆执行摘要压缩，生成一条总结性记忆后删除原始条目
- **用户可配置**：衰减速度、归档阈值、压缩频率均可调

#### 3.1.4 智能召回

- **会话启动注入**（参考 pro-workflow / obsidian-mind 的分层加载思路）：
  - 第一层（~500 tokens）：项目画像 + 近期高频决策 2-3 条
  - 第二层（按需）：用户提问时，实时混合检索补充
  - 全程静默：注入系统提示，不打断用户对话流
- **检索方式**：BM25 关键词 + 向量嵌入 + Reciprocal Rank Fusion 混合排序（参考 agentmemory）
- **Token 预算管理**：用户可配置 `clio.recall.budget`（默认 2000 tokens），Clio 严格在此预算内选择最相关的记忆注入（参考 ECC 的 `ECC_SESSION_START_MAX_CHARS`）
- **Compaction 感知**（参考 pro-workflow）：检测到 Claude Code 执行上下文压缩（`PreCompact` 事件）时，主动将当前会话关键状态写入暂存文件，压缩后恢复（参考 ECC 的 `pre-compact.js`）
- **注入位置**：`SessionStart` + `UserPromptSubmit`（后者按需实时检索）

#### 3.1.5 记忆管理命令

| 命令 | 功能 |
|------|------|
| `/memory list` | 列出当前项目/全局记忆（分页，可按类型/置信度/时间排序） |
| `/memory show <id>` | 查看单条记忆详情（含置信度、来源、相关会话） |
| `/memory forget <id>` | 删除某条记忆 |
| `/memory recall "query"` | 手动搜索记忆 |
| `/memory resolve` | 列出并解决矛盾记忆 |
| `/memory prune` | 手动触发衰减清理（dry-run 模式预览会删除哪些） |
| `/memory stats` | 统计记忆命中率、各层级数量等 |

#### 3.1.6 MCP 工具（超越斜杠命令，参考 agentmemory）

所有记忆操作同时暴露为 MCP 工具，让 Claude Code 可编程地读写记忆：

| MCP 工具 | 用途 |
|----------|------|
| `memorize` | 写入一条记忆（类型 + 内容 + 标签） |
| `recall` | 按语义搜索相关记忆 |
| `get_contradictions` | 获取当前矛盾记忆列表 |
| `forget` | 删除指定记忆 |

---

### 3.2 Skill 系统

#### 3.2.1 自动沉淀 Skill

- **检测条件**（置信度驱动，参考 ECC 的 instinct 系统）：
  - 同一解决方案在对话中出现 ≥2 次 → 创建 "instinct"（低置信度草案，标记为 `pending`）
  - 同一解决方案在对话中出现 ≥3 次 → 提升为 Skill 候选，请求用户确认
  - 用户明确使用 `/learn` → 直接进入确认流程
  - 成功跑通测试套件 → 自动捕获测试模式
- **置信度进化**：每次成功复用增加置信度，3 次失败复用自动标记为"需复审"
- **用户确认**：生成草稿后请求用户编辑/确认，不强制存储。用户可设置 `clio.skill.auto_confirm` 跳过确认

#### 3.2.2 Instinct 系统（新增，参考 ECC）

instinct 是 Skill 的前身——低置信度、未经用户确认的模式片段：

- 自动创建：无需用户干预，`pending` 状态
- 展示方式：在 `/instinct list` 中可见，不影响正常对话
- TTL：30 天未提升为 Skill 自动过期（参考 ECC 的 `/prune`）
- `/evolve` 命令：手动将一组相关的 instinct 聚类合并为一个 Skill（参考 ECC 的 `/evolve`）
- 置信度显示：每个 instinct 标注 `confidence: 0.XX`，让用户了解检测的可靠程度

#### 3.2.3 Skill 渐进式加载（参考 agentic-stack）

- **轻量级 Manifest**：会话启动时仅加载 Skill 名称、描述、触发关键词
- **按需激活**：当用户输入匹配某 Skill 的触发关键词时，才加载完整的 Skill 内容
- **自动推荐**：匹配度 > 80% 时主动提示"是否使用 Skill xxx？"
- **手动调用**：`/use <skill-name>` 加载 Skill

#### 3.2.4 Skill 自我进化（新增，参考 agentic-stack）

- **失败追踪**：每个 Skill 记录调用次数 + 成功率
- **自动降级**：连续 3 次失败且在 14 天内无成功调用 → 标记为 "stale" 并通知用户复审
- **自更新提示**：Skill 模板可包含 `## Self-Update` 部分，AI 在调用时可据此优化 Skill 内容，生成更新草案交由用户确认

#### 3.2.5 Skill 管理命令

| 命令 | 功能 |
|------|------|
| `/skill list` | 列出所有可用 Skill（含置信度、成功率、最后使用时间） |
| `/skill show <name>` | 查看 Skill 详情与使用统计 |
| `/skill edit <name>` | 编辑 Skill |
| `/skill delete <name>` | 删除 Skill |
| `/learn` | 强制将当前对话沉淀为 Skill 草稿 |
| `/learn-rule` | 快速记录一条简单规则（更轻量的 `/learn`，不创建完整 Skill） |
| `/evolve` | 将多个 instinct 聚类合并为一个 Skill |
| `/instinct list` | 列出所有 pending instinct |
| `/instinct prune` | 清理过期 instinct |

---

### 3.3 用户画像系统（核心差异化——目前社区空白）

#### 3.3.1 自动学习的维度

- **技术栈偏好**：语言、框架、数据库、测试工具（从代码和对话中学习，带置信度）
- **编码风格**：缩进、引号、行宽、类型注解偏好
- **决策历史**：重要的技术选型及其理由
- **常见错误模式**：用户经常犯的错误，AI 可主动提醒

#### 3.3.2 画像的进化

- **更新时机**：每个 Tool Use 后增量观察 + 会话结束后综合分析
- **置信度体系**（参考 ECC 的 instinct 系统）：每次用户接受建议 → 置信度 +；用户纠正 → 对应条目置信度 - 或创建新修正条目
- **冲突处理**：项目级配置可临时覆盖全局画像，项目结束后可选择合并或丢弃
- **人工修正**：用户可通过 `/profile edit` 直接修改画像

#### 3.3.3 画像管理命令

| 命令 | 功能 |
|------|------|
| `/profile show` | 展示当前画像摘要（含每条偏好的置信度、学习时间） |
| `/profile edit` | 手动编辑画像 |
| `/profile reset` | 重置画像（谨慎） |
| `/profile merge` | 将当前项目画像合并到全局 |

---

### 3.4 跨项目与跨工具能力

#### 3.4.1 作用域分层

- **全局**：适用于所有项目的长期记忆、Skill、画像（存储在 `~/.clio/`）
- **项目**：仅当前项目生效（存储在 `<项目>/.clio/`）
- **会话**：临时记忆，会话结束后自动清理

#### 3.4.2 可移植 Bundle（新增，参考 agentic-stack 的 transfer wizard）

- 用户可通过 `/bundle export` 将项目的记忆 + Skill 打包为一个 `.clio-bundle` 文件
- `/bundle import <path>` 在另一项目中恢复
- 适用于：从旧项目迁移、团队成员共享、CI/CD 环境统一

#### 3.4.3 跨工具兼容（V2，但架构设计时预留）

- 设计 MCP Server 层时考虑对接多个 AI 编程工具
- 架构预留适配器接口，未来支持 Cursor CLI、Codex CLI、Gemini CLI 等
- 记忆存储格式保持工具无关，仅在召回/写入层做适配

#### 3.4.4 自动选择策略

- 启动时自动识别当前 Git 仓库路径作为项目根目录
- 加载顺序：项目级配置 > 全局配置
- 记忆召回：同时检索全局 + 项目，项目级记忆权重更高

---

## 4. 用户故事

### 故事 1：跨会话记忆
> 小明昨天在项目 A 中告诉 Claude "我们使用 asyncpg 而不是 psycopg2"。今天开启新会话，问"帮我写一个数据库连接池"。Claude 自动使用 asyncpg 实现，不再需要小明重复解释。

### 故事 2：自动沉淀 Skill
> 过去一周，小明三次让 Claude 生成 FastAPI 的 CRUD 接口。第三次完成后，Clio 提示："检测到重复模式，是否将'FastAPI CRUD 生成'保存为 Skill？" 小明确认后，以后只需说"用 CRUD Skill 为 User 模型生成接口"，即可一键生成。

### 故事 3：用户画像跨项目生效
> 小明习惯使用 ruff 格式化、pytest 测试、单引号字符串。他在项目 A 中沉淀了这个画像。开始项目 B 时，Claude 自动采用相同的代码风格生成代码，无需重新配置。

### 故事 4：团队共享 Skill
> 团队 Leader 将内部 API 调用规范保存为 Skill，并导出为 Bundle。团队成员克隆项目后，通过 `/bundle import` 加载统一 Skill，所有人使用一致的规范。

### 故事 5：从错误中学习（新增）
> 小明对 Claude 说"不要用 dataclass，用 Pydantic BaseModel"。Claude 记住了这个偏好。下次生成模型类时，自动使用 Pydantic。后来小明在一个特殊场景需要 dataclass，手动纠正了一次。Clio 将这条偏好的置信度降低，并创建了一条特例规则："除非指定 @dataclass，否则默认使用 Pydantic"。

---

## 5. MVP 范围

| 模块 | 包含功能 | 不包含（V2） |
|------|----------|--------------|
| **记忆系统** | ✅ 4 层记忆模型（工作/情景/语义/程序化）<br>✅ 语义类型 + 置信度 + 标签元数据<br>✅ 跨会话召回（混合检索 BM25 + 向量）<br>✅ Token 预算管理<br>✅ 敏感信息过滤<br>✅ Ebbinghaus 衰减与自动维护<br>✅ 矛盾检测与解决<br>✅ Compaction 感知<br>✅ 手动管理命令 + MCP 工具 | ❌ 记忆图谱关联<br>❌ 记忆可视化 |
| **Skill 系统** | ✅ 手动创建 Skill（`/learn`）<br>✅ 轻量级 `/learn-rule`<br>✅ Instinct 系统（pending mechanism + TTL）<br>✅ 自动沉淀（≥3 次检测）<br>✅ `/evolve` instinct → Skill<br>✅ 渐进式加载（manifest + on-demand）<br>✅ Skill 管理命令<br>✅ 失败追踪与 stale 标记 | ❌ Skill 自动推荐 |
| **用户画像** | ✅ 学习技术栈偏好<br>✅ 学习编码风格（缩进、引号等）<br>✅ 置信度体系<br>✅ 展示和手动编辑画像 | ❌ 从错误中主动提醒<br>❌ 跨项目冲突自动解决 |
| **跨项目** | ✅ 全局/项目两层作用域<br>✅ 项目级配置覆盖全局<br>✅ Bundle 导出/导入 | ❌ 跨工具兼容（Cursor/Codex）<br>❌ 团队共享 Git 同步 |
| **安装体验** | ✅ 一行命令安装<br>✅ 自动配置 hooks + MCP<br>✅ 健康检查 | ❌ 图形化配置界面 |

---

## 6. 用户体验 & 交互设计

### 6.1 安装流程
```bash
# 用户执行
npm install -g clio
clio install

# 输出
✓ Clio 安装成功
✓ Claude Code Hooks 已配置
✓ MCP Server 已启动
✓ 记忆索引已初始化
💡 试试：启动 claude，输入 /memory list
```

### 6.2 使用流程（无感为主）
- **静默运行**：大多数情况下用户无感知，记忆自动捕获和召回
- **主动控制**：通过斜杠命令管理记忆、instinct 和 Skill
- **沉淀确认**：自动检测到重复模式时，仅提示一次，不打断工作流（用户可全局关闭确认）
- **渐进曝光**（新增）：新用户首次使用，前 3 次会话不展示任何管理命令提示，第 4 次开始轻轻提示"/memory list 查看你的记忆"

### 6.3 首次使用引导
新用户首次安装后，启动 Claude Code 时主动提示：
> 👋 欢迎使用 Clio。我会记住你的偏好和技术决策，跨会话复用。试试说："记住我喜欢用单引号"，之后我会自动使用单引号。输入 /help 查看更多功能。

---

## 7. 非功能需求

| 维度 | 要求 |
|------|------|
| **性能** | 记忆检索延迟 < 100ms；会话启动额外耗时 < 500ms（遵循 token 预算） |
| **资源占用** | 内存占用 < 200MB；磁盘 < 500MB（1 万条记忆） |
| **隐私** | 所有数据本地存储；自动脱敏敏感信息（API key、路径）；不联网 |
| **可靠性** | 记忆系统崩溃不影响 Claude Code 主功能；支持数据导出备份；Compaction 安全 |
| **可扩展** | 可替换 embedding 模型；MCP 工具接口标准化；架构预留多工具适配器接口 |
| **兼容性** | 支持 macOS / Linux；Claude Code 最新版本 |

---

## 8. 技术约束

- **实现方式**：全 TypeScript，单进程架构（MCP Server + Unix Socket IPC for Hooks）
- **MCP SDK**：`@modelcontextprotocol/sdk`（Anthropic 官方参考实现）
- **存储**：SQLite + FTS5 + sqlite-vec（通过 `better-sqlite3`）
- **Embedding 模型**：`all-MiniLM-L6-v2`（384 维，`@xenova/transformers` WASM 端侧推理）
- **LLM 调用**：Anthropic TypeScript SDK，复用 Claude Code 环境配置
- **分发方式**：`npm install -g @clio/cli`
- **Claude Code 集成**：利用 `~/.claude/settings.json` 的 Hooks + MCP Servers 配置
- **Hook 事件覆盖**：`SessionStart`、`UserPromptSubmit`、`PostToolUse`、`PreCompact`、`Stop`

---

## 9. 社区参考与致谢

Clio 的设计参考了以下社区项目的优秀理念：

| 项目 | 参考内容 |
|------|---------|
| **agentmemory** | 4 层记忆模型、Ebbinghaus 衰减、混合检索（BM25+Vector+RRF）、矛盾检测、敏感信息过滤、MCP 工具暴露 |
| **everything-claude-code** | Instinct 系统 + 置信度评分、`/evolve` 命令、Import/Export、Compaction 感知、TTL 自动过期 |
| **pro-workflow** | `/learn-rule` 轻量级规则、Token 预算管理、知识平面（wiki）、Compaction 状态保存 |
| **agentic-stack** | 渐进式加载、Skill 自我进化（失败追踪 + stale 标记）、数据飞轮、Bundle 可移植包、跨工具适配器架构 |
| **obsidian-mind** | 分层 Token 加载策略、消息分类、生命周期 Hook 覆盖 |
| **my-claude-code-setup** | CLAUDE 系列文件的双层记忆架构（git 共享 + 本地私有） |

---

## 10. 未来规划

| 版本 | 计划功能 |
|------|----------|
| **V1.0** | 本 PRD MVP 范围全部内容 |
| **V1.5** | Skill 自动推荐（上下文触发）；画像冲突自动解决；Instinct → Skill 全自动流程 |
| **V2.0** | 跨工具兼容（Cursor CLI、Codex CLI、Gemini CLI）；团队共享 Bundle；记忆图谱可视化 Dashboard |
| **V2.5** | Skill Marketplace（社区共享）；数据飞轮（自动生成测试用例）；Web UI 管理 |
| **V3.0** | 云端可选同步；跨用户匿名模式学习（隐私保护）；多 Agent 协调记忆 |

---

## 11. 成功指标

| 指标 | 目标值（发布后 3 个月） |
|------|------------------------|
| 日活用户（DAU） | 500+ |
| 平均每个用户沉淀 Skill 数 | ≥3 |
| 记忆召回采纳率（用户不手动覆盖） | ≥80% |
| 用户留存率（第 30 天） | ≥40% |
| GitHub Stars | ≥800 |

---

## 12. 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| Claude Code 官方更新破坏 Hooks 兼容性 | 中 | 设计适配层，快速跟进修复 |
| 本地 embedding 模型性能不足 | 低 | 允许用户切换更快的模型（如使用 OpenAI API 作为可选） |
| 用户觉得"自动沉淀"烦人 | 中 | 默认仅创建低置信度 instinct（静默），仅当提升为 Skill 时才提示用户确认 |
| 记忆库无限膨胀 | 低 | Ebbinghaus 衰减 + 自动定期压缩总结，两种机制同时作用 |

---

## 13. 附录：典型使用场景对话示例

**场景：新项目启动**
```
User: 开始一个新项目，用 FastAPI + SQLAlchemy + asyncpg
Clio: [已记住技术栈偏好，置信度 0.7]
      我注意到你之前在项目 X 中偏好使用 repository 模式，要继续吗？
User: 好的，沿用 repository 模式。
Clio: [已记录决策，置信度提升至 0.85]

[会话结束]

--- 第二天，新会话 ---
User: 帮我创建一个 user model
Clio: [自动加载：项目偏好 + 技术栈 + repository 模式决策]
      根据你的偏好，我会使用 SQLAlchemy 2.0 风格 + asyncpg。是否生成对应的 repository 类？
User: 是的。
Clio: [生成代码，自动符合之前约定的模式]
```

**场景：错误纠正与学习**
```
User: 这里不要用同步写法，用 async/await
Clio: [记录纠正：偏好 async/await 而非同步写法，置信度初始 0.6]
      已记住，以后遇到 IO 操作会优先使用 async/await。
User: 好的。

[一天后，另一会话]
User: 帮我写一个文件读取函数
Clio: [召回：async/await 偏好，置信度 0.7（因成功复用+1）]
      用 async/await 实现还是同步？
User: async。
Clio: [置信度 +0.1，提升至 0.8]
```
