export interface CountResult {
  c: number;
}

export interface RowIdResult {
  rowid: number;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface SemanticMemoryRow {
  id: string;
  content: string;
  memory_type: string;
  topic: string | null;
  value: string | null;
  confidence: number;
  source_session: string;
  access_count: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
  conflict_id: string | null;
  is_archived: number;
  project_path: string;
}

export interface InstinctRow {
  id: string;
  topic: string;
  value: string;
  confidence: number;
  hit_count: number;
  last_hit: string;
  created_at: string;
  status: string;
}

export interface ProfileRow {
  key: string;
  value: string;
  confidence: number;
  source: string;
  project_path: string;
  created_at: string;
  updated_at: string;
}

export interface SessionPayload {
  sessionId: string;
  toolCount?: number;
  projectPath?: string;
}

export interface FactResult {
  content: string;
  type?: string;
  topic?: string | null;
  value?: string | null;
}
