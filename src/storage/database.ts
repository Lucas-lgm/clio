import Database from 'better-sqlite3';
import { join } from 'path';
import { load as loadVec0 } from 'sqlite-vec';
import { getClioHome } from '../config.js';
import { logger } from '../logger.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = join(getClioHome(), 'data', 'clio.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  loadVec0(db);
  initSchema(db);
  logger.info(`database ready: ${dbPath}`);
  return db;
}

export function closeDb(): void {
  if (db) { db.close(); db = null; logger.info('database closed'); }
}

export function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS semantic_memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      memory_type TEXT NOT NULL CHECK(memory_type IN ('fact','preference','decision','pattern')),
      topic TEXT,
      value TEXT,
      confidence REAL DEFAULT 0.5,
      source_session TEXT,
      access_count INTEGER DEFAULT 0,
      last_accessed TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      conflict_id TEXT,
      is_archived INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS working_memories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('tool_use','user_prompt')),
      content TEXT NOT NULL,
      pattern_type TEXT CHECK(pattern_type IN ('preference','correction','decision',NULL)),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_working_session ON working_memories(session_id);

    CREATE TABLE IF NOT EXISTS instincts (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.3,
      hit_count INTEGER DEFAULT 1,
      last_hit TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','promoted','expired'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT,
      summary TEXT,
      started_at TEXT,
      ended_at TEXT,
      tool_count INTEGER DEFAULT 0,
      token_estimate INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, topic, value,
      content='semantic_memories',
      content_rowid='rowid'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[384]
    );
  `);
}
