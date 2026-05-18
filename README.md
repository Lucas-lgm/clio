# Clio

**Memory that follows you across sessions. Skills that evolve on their own.**

Clio is a memory and skill evolution system for Claude Code. Install once, and Claude starts remembering your preferences, technical decisions, and recurring patterns — automatically, across projects and sessions.

> ⚠️ **Alpha** — Actively developed. Things will change, but it works today.

---

## Features

### 🧠 Persistent Memory
Claude remembers your tech stack preferences, past decisions, and corrections — no need to re-explain every session.

### 🔍 Hybrid Search
BM25 keyword search + vector embeddings + RRF fusion. Relevant memories surface when you need them, even with partial or fuzzy queries.

### 📈 Instinct System
Repeated patterns automatically evolve: low-confidence "instincts" get promoted to semantic memory when a pattern is confirmed across multiple sessions.

### 🧩 MCP Tools
Full memory management via Claude Code slash commands: `/remember`, `/memory recall`, `/memory forget`, `/profile show`, `/instinct list`.

### 🔒 Privacy First
All data stored locally in SQLite. API keys, tokens, and paths are auto-redacted before storage. No external services, no telemetry.

---

## Quick Start

```bash
# Install globally
npm install -g @clio/cli

# Configure Claude Code hooks and MCP server
clio install

# Start a new Claude Code session
# Memory is automatic from here.
```

### Requirements

- Node.js 20+
- Claude Code (latest)

---

## How It Works

Clio runs as a single Node.js daemon alongside Claude Code, communicating through Unix sockets.

```
Claude Code  ◀──▶  Clio Daemon
                      ├── Capture Engine   — observes tool output, detects preferences
                      ├── Recall Engine    — hybrid BM25 + vector search
                      ├── Instinct Engine  — cross-session pattern detection
                      ├── Decay Engine     — Ebbinghaus-inspired forgetting curve
                      └── Profile Engine   — auto-extracted user preferences
```

**Capture** happens at two levels:
- **Per tool call**: Output is redacted, deduplicated, and stored as working memory
- **Per session end**: LLM compresses working memories into semantic memories with vector embeddings

**Recall** happens at two points:
- **Session start**: Top-5 high-confidence memories + profile injected into system prompt
- **On each query**: Real-time hybrid search, results injected as additional context

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | ER diagrams, class diagrams, flowcharts |
| [Scenarios](docs/scenarios.md) | Complete business logic for every trigger point |

---

## Development

```bash
git clone https://github.com/Lucas-lgm/clio
cd clio
npm install
npm run build
npm test
```

### Project Structure

```
src/
├── server.ts              # Daemon entry (MCP Server + IPC)
├── logger.ts              # Structured logger (file + stderr)
├── config.ts              # Config management
├── engines/
│   ├── capture.ts         # Capture, redact, classify, LLM compression
│   ├── recall.ts          # BM25 + vector hybrid search, RRF fusion
│   ├── instinct.ts        # Cross-session pattern detection
│   ├── decay.ts           # Confidence decay and archive
│   └── profile.ts         # User profile extraction
├── storage/
│   ├── database.ts        # SQLite schema (FTS5 + vec0)
│   └── embedding.ts       # all-MiniLM-L6-v2 via @xenova/transformers
├── ipc/
│   ├── protocol.ts        # IPC type definitions
│   └── server.ts          # Unix socket server
└── hooks/                 # Claude Code hook scripts (thin shims)
tests/                     # Vitest test suite
```

---

## Contributing

Contributions are welcome. Open an issue or pull request.

---

## License

MIT
