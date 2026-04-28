// mcp-server/src/failure-patterns.ts
// Failure pattern tracking tools. Records recurring mistakes so agents can
// learn from them across sessions.

import type { OmccDb } from "./db.js";
import type { ToolResult } from "./tools.js";

function ok(data?: unknown): ToolResult {
  return { ok: true, data };
}
function err(error: string): ToolResult {
  return { ok: false, error };
}

/**
 * Add a new failure pattern, or increment occurrences if the exact pattern
 * text already exists for the given scope.
 */
export function omcc_failure_pattern_add(
  db: OmccDb,
  args: { pattern: string; prevention: string; scope?: string }
): ToolResult {
  if (!args?.pattern) return err("pattern required");
  if (!args?.prevention) return err("prevention required");
  const scope = args.scope ?? "project";
  if (scope !== "project" && scope !== "global") {
    return err("scope must be 'project' or 'global'");
  }

  // Check for existing pattern with same text and scope
  const existing = db.raw
    .prepare("SELECT id, occurrences FROM failure_patterns WHERE pattern = ? AND scope = ?")
    .get(args.pattern, scope) as { id: string; occurrences: number } | undefined;

  if (existing) {
    db.raw
      .prepare(
        "UPDATE failure_patterns SET occurrences = occurrences + 1, last_seen = datetime('now'), prevention = ? WHERE id = ?"
      )
      .run(args.prevention, existing.id);
    return ok({ id: existing.id, occurrences: existing.occurrences + 1, updated: true });
  }

  const id = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.raw
    .prepare(
      "INSERT INTO failure_patterns (id, pattern, prevention, scope) VALUES (?, ?, ?, ?)"
    )
    .run(id, args.pattern, args.prevention, scope);
  return ok({ id, occurrences: 1, updated: false });
}

/** List failure patterns, optionally filtered by scope. */
export function omcc_failure_pattern_list(
  db: OmccDb,
  args: { scope?: string; limit?: number }
): ToolResult {
  const lim = Math.max(1, Math.min(100, args?.limit ?? 20));
  const scope = args?.scope ?? "all";

  let rows;
  if (scope === "all") {
    rows = db.raw
      .prepare(
        "SELECT id, pattern, prevention, occurrences, last_seen, scope, created_at FROM failure_patterns ORDER BY occurrences DESC LIMIT ?"
      )
      .all(lim);
  } else {
    rows = db.raw
      .prepare(
        "SELECT id, pattern, prevention, occurrences, last_seen, scope, created_at FROM failure_patterns WHERE scope = ? ORDER BY occurrences DESC LIMIT ?"
      )
      .all(scope, lim);
  }
  return ok(rows);
}

/**
 * Check if the given context matches any known failure patterns via
 * case-insensitive substring/keyword matching.
 */
export function omcc_failure_pattern_check(
  db: OmccDb,
  args: { context: string }
): ToolResult {
  if (!args?.context) return err("context required");

  // Extract meaningful keywords (3+ chars) from the context
  const keywords = args.context
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3);

  if (keywords.length === 0) return ok([]);

  // Build a query that matches any keyword against the pattern text
  const conditions = keywords.map(() => "LOWER(pattern) LIKE ?");
  const params = keywords.map((kw) => `%${kw}%`);

  const rows = db.raw
    .prepare(
      `SELECT id, pattern, prevention, occurrences, scope FROM failure_patterns WHERE ${conditions.join(" OR ")} ORDER BY occurrences DESC`
    )
    .all(...params);
  return ok(rows);
}
