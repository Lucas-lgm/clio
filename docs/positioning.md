# Clio 定位

**Claude Code 的跨会话记忆层。**

附赠环境迁移。

---

## 核心问题

Claude Code 每次会话从零开始。技术栈偏好、架构决策、修复方案 —— 每个新 session 都要重新交代。

clio 只解决这一个核心问题：**跨会话持久记忆**。

## 做什么

| 方向 | 能力 |
|------|------|
| **Memory（主业）** | 自动捕获工具输出 → 混合检索（BM25 + 向量）→ 跨会话召回 |
| **Migration（附赠）** | `export` / `import` 打包 Claude 环境，任意机器恢复 |

## 不做什么

| 不做 | 原因 |
|------|------|
| Skill 平台 | skill 全部使用 Claude Code 生态（`~/.claude/skills/` + plugins） |
| 默认 / 内置 skill | 不捆绑。用户按需安装社区或自写 skill |
| 内容生成 | 只观察、记忆、召回。不写代码、不回答问题、不生成设计文档 |
| 云端服务 | 纯 SQLite 本地存储。无 telemetry、无外部 API |

## 和 Claude Code 生态的关系

```
Claude Code
  ├── skills/       ← markdown skill（用户自装）
  ├── plugins/      ← 第三方插件（如 superpowers）
  ├── settings.json ← MCP + hooks 配置
  └── CLAUDE.md     ← 手动维护的指令

clio（注入 hooks + MCP）
  ├── 操作时自动捕获偏好和决策
  ├── 每次查询注入相关记忆
  └── 环境导入导出
```

clio 不替代任何 Claude Code 功能。它通过 hooks 自动补齐"不记得"的短板。

## 为什么值得做

Claude Code 现有的记忆机制：

| 机制 | 局限 |
|------|------|
| CLAUDE.md | 纯手动维护，不会过期，不会自动补充 |
| Skills | 需要主动安装，不解决跨会话遗忘 |
| MCP | 能力接口，不是开箱即用的记忆 |

clio 做的三件事是 Claude Code 做不到的：

1. **自动捕获** —— "用 asyncpg"，clio 自动观察到并记住
2. **置信度衰减** —— 半年没访问的记忆自动降权，减少噪声
3. **模式晋升** —— 三次重复 = 自动升级为高置信度记忆
