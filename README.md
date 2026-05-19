# Clio

**Cross-session memory layer for Claude Code.**

Starting each session from scratch is wasteful. Clio lets Claude remember your preferences, decisions, and patterns — automatic capture, hybrid retrieval, cross-session recall.

> ⚙️ Bonus: environment migration — one command to bundle your Claude environment (memories + settings + skills), restore on any machine.

---

## Why

Claude Code doesn't remember past sessions. You say "use asyncpg, not psycopg2" — next session it asks again. Decisions from six months ago pile up, never cleaned. CLAUDE.md is always outdated.

Clio doesn't replace anything in Claude Code. It fills one gap: **cross-session memory**.

## What We Don't Do

| Not this | Why |
|----------|-----|
| Skill platform | Skills use the Claude Code ecosystem (`~/.claude/skills/`) |
| Default / built-in skills | No bundled skills |
| Content generation | Observe, remember, recall — no code writing, no Q&A |
| Cloud service | Fully local, no telemetry, no external services |

---

## How It Works

```
Claude Code  ◀──▶  Clio Daemon
                      ├── Capture Engine   — observes tool output, auto-extracts preferences & decisions
                      ├── Recall Engine    — BM25 + vector hybrid search + RRF fusion
                      ├── Instinct Engine  — cross-session pattern promotion
                      ├── Decay Engine     — confidence decay, auto-archive unused memories
                      └── Profile Engine   — user profile extraction
```

### Capture
- **At runtime**: tool output → redact → dedup → write to working memory
- **At session end**: LLM compresses working memory → semantic memory + vector index

### Recall
- **Session start**: top-5 high-confidence memories + profile injected into system prompt
- **Per query**: real-time hybrid search, relevant memories injected into additional_context

---

## Quick Start

```bash
npm install -g @clio/cli
clio install
# Start a new session. Memory works automatically.
```

### Requirements
- Node.js 20+
- Claude Code (latest)

---

## Documentation

| Document | Description |
|----------|-------------|
| [Positioning](docs/positioning.md) | Project boundaries and ecosystem relationships |
| [Architecture](docs/architecture.md) | ER diagrams, class diagrams, flow charts |
| [Scenarios](docs/scenarios.md) | Full trigger-point logic |

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
