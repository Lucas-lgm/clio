# Clio

**Claude Code 的跨会话记忆层。**

每次 session 从零开始太蠢了。clio 让 Claude 记住你的偏好、决策和模式 —— 自动捕获、混合检索、跨会话召回。

> ⚙️ 附赠环境迁移：一条命令打包你的 Claude 环境（记忆 + 设置 + skill），任意机器恢复。

---

## Why

Claude Code 每次会话不记得过去。你说"用 asyncpg 别用 psycopg2"，下个 session 它又问你用哪个。半年前的决定没人去删，CLAUDE.md 永远过时。

Clio 不替代 Claude Code 的任何功能。它只填补一个空白：**跨会话记忆**。

## What We Don't Do

| 不做 | 原因 |
|------|------|
| Skill 平台 | skill 全部使用 Claude Code 生态的 `~/.claude/skills/` |
| 默认 / 内置 skill | 不捆绑任何 skill |
| 内容生成 | 只观察、记忆、召回，不写代码不回答问题 |
| 云端服务 | 纯本地，无 telemetry 无外部服务 |

---

## How It Works

```
Claude Code  ◀──▶  Clio Daemon
                      ├── Capture Engine   — 观察工具输出，自动提取偏好和决策
                      ├── Recall Engine    — BM25 + 向量混合搜索 + RRF 融合
                      ├── Instinct Engine  — 跨会话模式晋升
                      ├── Decay Engine     — 置信度衰减，不常用的自动归档
                      └── Profile Engine   — 用户画像提取
```

### Capture
- **操作时**：工具输出 → 脱敏 → 去重 → 写入工作记忆
- **会话结束**：LLM 压缩工作记忆 → 语义记忆 + 向量索引

### Recall
- **会话启动**：Top-5 高置信度记忆 + 画像注入 system prompt
- **每次查询**：实时混合搜索，相关记忆注入 additional_context

---

## Quick Start

```bash
npm install -g @clio/cli
clio install
# 开新 session。记忆自动生效。
```

### Requirements
- Node.js 20+
- Claude Code (latest)

---

## Documentation

| Document | Description |
|----------|-------------|
| [Positioning](docs/positioning.md) | 项目边界和生态关系 |
| [Architecture](docs/architecture.md) | ER 图、类图、流程图 |
| [Scenarios](docs/scenarios.md) | 完整触发点逻辑 |

---

## Development

```bash
git clone https://github.com/Lucas-lgm/clio
cd clio
npm install
npm run build
npm test
```

---

## License

MIT
