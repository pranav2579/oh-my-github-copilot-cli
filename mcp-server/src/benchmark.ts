// mcp-server/src/benchmark.ts
// Cross-agent benchmarking engine.

import type { OmccDb } from "./db.js";
import type { ToolResult } from "./tools.js";

function ok(data?: unknown): ToolResult { return { ok: true, data }; }
function err(error: string): ToolResult { return { ok: false, error }; }

export function ensureBenchmarkTable(db: OmccDb): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id TEXT PRIMARY KEY, task_description TEXT NOT NULL, task_category TEXT,
      model_used TEXT NOT NULL, quality_score REAL, tokens_used INTEGER,
      duration_seconds REAL, cost_estimate REAL, success INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function generateId(): string {
  return `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function omcc_benchmark_record(db: OmccDb, args: {
  task_description: string; task_category?: string; model_used: string;
  quality_score?: number; tokens_used?: number; duration_seconds?: number;
  cost_estimate?: number; success?: number;
}): ToolResult {
  if (!args?.task_description) return err("task_description required");
  if (!args?.model_used) return err("model_used required");
  ensureBenchmarkTable(db);
  const id = generateId();
  const success = args.success === 0 ? 0 : 1;
  db.raw.prepare(
    `INSERT INTO benchmark_runs (id, task_description, task_category, model_used, quality_score, tokens_used, duration_seconds, cost_estimate, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, args.task_description, args.task_category ?? null, args.model_used,
    args.quality_score ?? null, args.tokens_used ?? null,
    args.duration_seconds ?? null, args.cost_estimate ?? null, success);
  return ok({ id, recorded: true });
}

export function omcc_benchmark_compare(db: OmccDb, args: { task_category: string }): ToolResult {
  if (!args?.task_category) return err("task_category required");
  ensureBenchmarkTable(db);
  const rows = db.raw.prepare(
    `SELECT model_used, COUNT(*) as run_count, AVG(quality_score) as avg_quality,
      AVG(tokens_used) as avg_tokens, AVG(duration_seconds) as avg_duration,
      AVG(cost_estimate) as avg_cost, CAST(SUM(success) AS REAL) / COUNT(*) as success_rate
     FROM benchmark_runs WHERE task_category = ? GROUP BY model_used`
  ).all(args.task_category) as Array<{
    model_used: string; run_count: number; avg_quality: number | null;
    avg_tokens: number | null; avg_duration: number | null;
    avg_cost: number | null; success_rate: number;
  }>;
  const enriched = rows.map((r) => ({
    ...r,
    value_ratio: computeValueRatio(r.avg_quality, r.avg_cost),
  }));
  enriched.sort((a, b) => b.value_ratio - a.value_ratio);
  return ok({
    task_category: args.task_category,
    models: enriched,
    recommended: enriched.length > 0 ? enriched[0].model_used : null,
  });
}

export function omcc_benchmark_report(db: OmccDb): ToolResult {
  ensureBenchmarkTable(db);
  const categories = db.raw.prepare(
    `SELECT DISTINCT task_category FROM benchmark_runs WHERE task_category IS NOT NULL`
  ).all() as Array<{ task_category: string }>;
  const report: Record<string, { models: unknown[]; recommended: string | null }> = {};
  for (const { task_category } of categories) {
    const result = omcc_benchmark_compare(db, { task_category });
    if (result.ok && result.data) {
      const d = result.data as { models: unknown[]; recommended: string | null };
      report[task_category] = { models: d.models, recommended: d.recommended };
    }
  }
  const totalRuns = (db.raw.prepare(`SELECT COUNT(*) as cnt FROM benchmark_runs`).get() as { cnt: number }).cnt;
  return ok({ total_runs: totalRuns, categories: report });
}

export function omcc_benchmark_history(
  db: OmccDb,
  args: { model?: string; category?: string; limit?: number }
): ToolResult {
  ensureBenchmarkTable(db);
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (args?.model) { conditions.push("model_used = ?"); params.push(args.model); }
  if (args?.category) { conditions.push("task_category = ?"); params.push(args.category); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(100, args?.limit ?? 20));
  params.push(limit);
  const rows = db.raw.prepare(
    `SELECT id, task_description, task_category, model_used, quality_score,
            tokens_used, duration_seconds, cost_estimate, success, created_at
     FROM benchmark_runs ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params);
  return ok(rows);
}

function computeValueRatio(quality: number | null, cost: number | null): number {
  if (quality == null || cost == null || cost <= 0) return 0;
  return quality / cost;
}
