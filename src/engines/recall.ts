import type Database from 'better-sqlite3';
import type { ClioConfig } from '../config.js';
import type { EmbeddingService } from '../storage/embedding.js';
import type { SkillManifest } from './skill.js';
import { logger } from '../logger.js';

export class RecallEngine {
  constructor(
    private db: Database.Database,
    private config: ClioConfig,
    private embedding: EmbeddingService,
  ) {}

  getInitialContext(projectPath?: string, skills?: SkillManifest[]): string {
    const scope = projectPath ?? '';
    const memories = this.db.prepare(`
      SELECT content, memory_type, topic, value
      FROM semantic_memories
      WHERE confidence >= 0.7 AND is_archived = 0
        AND (project_path = ? OR project_path = '')
      ORDER BY (access_count * 0.3 + confidence * 0.7) DESC
      LIMIT ?
    `).all(scope, this.config.recall.top_k_startup) as any[];

    // Profile: project-level entries preferred, global fills gaps
    const profileRows = this.db.prepare(
      "SELECT key, value, confidence FROM profile WHERE confidence >= 0.5 AND (project_path = ? OR project_path = '') ORDER BY key, CASE WHEN project_path = ? THEN 0 ELSE 1 END, confidence DESC"
    ).all(scope, scope) as any[];
    const seen = new Set<string>();
    const profiles: any[] = [];
    for (const p of profileRows) {
      if (!seen.has(p.key)) {
        seen.add(p.key);
        profiles.push(p);
      }
    }

    if (memories.length === 0 && profiles.length === 0) return '';

    logger.info(`context: ${memories.length} memories, ${profiles.length} profile entries`);

    const lines: string[] = [];
    lines.push('<!-- clio: user profile -->');

    if (profiles.length > 0) {
      lines.push('## User Preferences (learned across sessions)');
      for (const p of profiles) {
        const label = p.key.replace(/^(tech_stack|code_style|pattern|role)\./, '');
        lines.push(`- ${label}: ${p.value}`);
      }
      lines.push('');
    }

    for (const mem of memories) {
      lines.push(`- ${mem.memory_type}: ${mem.content}`);
    }

    if (skills && skills.length > 0) {
      lines.push('');
      lines.push('## Available Skills (use via /use <name> or the use_skill tool)');
      for (const s of skills) {
        lines.push(`- ${s.name}: ${s.description}`);
      }
    }

    return lines.join('\n');
  }

  async recallRelevant(query: string, projectPath?: string): Promise<string> {
    if (!query || query.length < 3) return '';
    const scope = projectPath ?? '';

    const bm25Results = this.db.prepare(`
      SELECT sm.id, sm.content, sm.memory_type, sm.confidence, sm.topic, sm.value
      FROM memories_fts ft
      JOIN semantic_memories sm ON sm.rowid = ft.rowid
      WHERE memories_fts MATCH ?
        AND sm.is_archived = 0
        AND (sm.project_path = ? OR sm.project_path = '')
      ORDER BY rank
      LIMIT 10
    `).all(this.escapeFts5(query), scope) as any[];

    let vectorResults: any[] = [];
    try {
      if (this.embedding.isLoaded()) {
        const queryVec = await this.embedding.embed(query);
        vectorResults = this.db.prepare(`
          SELECT sm.id, sm.content, sm.memory_type, sm.confidence, sm.topic, sm.value, distance
          FROM memories_vec v
          JOIN semantic_memories sm ON sm.id = v.id
          WHERE v.embedding MATCH ?
            AND sm.is_archived = 0
            AND (sm.project_path = ? OR sm.project_path = '')
          ORDER BY distance
          LIMIT 10
        `).all(Buffer.from(queryVec.buffer), scope) as any[];
      }
    } catch {
      logger.warn('recall: vector search failed, falling back to BM25 only');
    }

    const fused = this.rrf(bm25Results, vectorResults);
    const topK = fused.slice(0, this.config.recall.top_k_realtime);

    if (topK.length > 0) {
      logger.info(`recall: ${bm25Results.length} bm25, ${vectorResults.length} vector, ${topK.length} returned`);
    }

    for (const item of topK) {
      this.db.prepare(
        'UPDATE semantic_memories SET access_count = access_count + 1, last_accessed = datetime(\'now\') WHERE id = ?'
      ).run(item.id);
    }

    if (topK.length === 0) return '';

    return topK.map((m: any) => `${m.memory_type}: ${m.content}`).join('\n');
  }

  private rrf(bm25: any[], vector: any[], k = 60): any[] {
    const scores = new Map<string, { item: any; score: number }>();
    for (const [rank, item] of bm25.entries()) {
      scores.set(item.id, { item, score: 1 / (k + rank) });
    }
    for (const [rank, item] of vector.entries()) {
      const existing = scores.get(item.id);
      scores.set(item.id, { item, score: (existing?.score ?? 0) + 1 / (k + rank) });
    }
    return [...scores.values()].sort((a, b) => b.score - a.score).map(s => s.item);
  }

  private escapeFts5(text: string): string {
    return text.split(/\s+/).filter(Boolean).map(w => `"${w.replace(/"/g, '""')}"`).join(' ');
  }
}
