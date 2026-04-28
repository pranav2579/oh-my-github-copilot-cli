// mcp-server/src/memory-layers.ts
// Implements the 4-layer memory system (L0-L3).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { OmccDb } from "./db.js";

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

function ok(data?: unknown): ToolResult {
  return { ok: true, data };
}
function err(error: string): ToolResult {
  return { ok: false, error };
}

function getL0(): ToolResult {
  const candidates = [
    join(process.cwd(), ".github", "copilot-instructions.md"),
    join(process.env.HOME ?? homedir(), ".copilot", "copilot-instructions.md"),
  ];
  for (const p of candidates) {
    try {
      const content = readFileSync(p, "utf-8");
      return ok({ level: 0, source: p, content });
    } catch {
      // try next
    }
  }
  return ok({
    level: 0,
    source: null,
    content: "L0: copilot-instructions.md not found. This layer is managed by Copilot CLI directly.",
  });
}

function getL1(db: OmccDb): ToolResult {
  const rows = db.raw
    .prepare(
      "SELECT id, content, confidence, category, source FROM memory_layers WHERE level = 1 AND confidence >= 0.7 ORDER BY confidence DESC"
    )
    .all();
  return ok({ level: 1, count: (rows as unknown[]).length, entries: rows });
}

function getL2(db: OmccDb): ToolResult {
  const rows = db.raw
    .prepare(
      "SELECT id, content, confidence, category, source FROM memory_layers WHERE level = 2 ORDER BY created_at DESC"
    )
    .all();
  return ok({ level: 2, count: (rows as unknown[]).length, entries: rows });
}

function getL3(db: OmccDb, q?: string): ToolResult {
  if (q) {
    const like = `%${q}%`;
    const rows = db.raw
      .prepare(
        "SELECT id, content, confidence, category, source FROM memory_layers WHERE level = 3 AND content LIKE ? ORDER BY created_at DESC LIMIT 50"
      )
      .all(like);
    return ok({ level: 3, count: (rows as unknown[]).length, entries: rows });
  }
  const rows = db.raw
    .prepare(
      "SELECT id, content, confidence, category, source FROM memory_layers WHERE level = 3 ORDER BY created_at DESC LIMIT 50"
    )
    .all();
  return ok({ level: 3, count: (rows as unknown[]).length, entries: rows });
}

export function omcc_memory_layer_get(
  db: OmccDb,
  args: { level: number; q?: string }
): ToolResult {
  if (args?.level === undefined || args.level === null) return err("level required (0-3)");
  const level = Number(args.level);
  if (![0, 1, 2, 3].includes(level)) return err("level must be 0, 1, 2, or 3");
  switch (level) {
    case 0: return getL0();
    case 1: return getL1(db);
    case 2: return getL2(db);
    case 3: return getL3(db, args.q);
    default: return err("invalid level");
  }
}

export function omcc_memory_promote(
  db: OmccDb,
  args: { id: string; from_level: number; to_level: number }
): ToolResult {
  if (!args?.id) return err("id required");
  const from = Number(args.from_level);
  const to = Number(args.to_level);
  if (!((from === 3 && to === 2) || (from === 2 && to === 1))) {
    return err("promotion must be L3->L2 (from_level=3, to_level=2) or L2->L1 (from_level=2, to_level=1)");
  }
  const row = db.raw
    .prepare("SELECT id, level, content, confidence, category, source FROM memory_layers WHERE id = ?")
    .get(args.id) as { id: string; level: number; content: string; confidence: number; category: string; source: string } | undefined;
  if (!row) return err(`memory entry '${args.id}' not found`);
  if (row.level !== from) return err(`entry is at level ${row.level}, expected ${from}`);
  if (to === 1 && row.confidence < 0.7) {
    return err(`confidence ${row.confidence} is below the 0.7 threshold required for L1 promotion`);
  }
  db.raw
    .prepare("UPDATE memory_layers SET level = ?, promoted_at = datetime('now') WHERE id = ?")
    .run(to, args.id);
  return ok({ id: args.id, from_level: from, to_level: to, promoted: true });
}

export function omcc_memory_demote(
  db: OmccDb,
  args: { id: string; from_level: number; to_level: number }
): ToolResult {
  if (!args?.id) return err("id required");
  const from = Number(args.from_level);
  const to = Number(args.to_level);
  if (!((from === 1 && to === 2) || (from === 2 && to === 3))) {
    return err("demotion must be L1->L2 (from_level=1, to_level=2) or L2->L3 (from_level=2, to_level=3)");
  }
  const row = db.raw
    .prepare("SELECT id, level FROM memory_layers WHERE id = ?")
    .get(args.id) as { id: string; level: number } | undefined;
  if (!row) return err(`memory entry '${args.id}' not found`);
  if (row.level !== from) return err(`entry is at level ${row.level}, expected ${from}`);
  db.raw
    .prepare("UPDATE memory_layers SET level = ?, promoted_at = NULL WHERE id = ?")
    .run(to, args.id);
  return ok({ id: args.id, from_level: from, to_level: to, demoted: true });
}

export function omcc_memory_layer_add(
  db: OmccDb,
  args: { id: string; content: string; level?: number; confidence?: number; category?: string; source?: string }
): ToolResult {
  if (!args?.id || !args?.content) return err("id and content required");
  const level = args.level ?? 3;
  if (![1, 2, 3].includes(level)) return err("level must be 1, 2, or 3");
  const confidence = args.confidence ?? 0.5;
  db.raw
    .prepare(
      "INSERT INTO memory_layers (id, level, content, confidence, category, source) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET content = excluded.content, level = excluded.level, confidence = excluded.confidence, category = excluded.category, source = excluded.source"
    )
    .run(args.id, level, args.content, confidence, args.category ?? null, args.source ?? null);
  return ok({ id: args.id, level });
}