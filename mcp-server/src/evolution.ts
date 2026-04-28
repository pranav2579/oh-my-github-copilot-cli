// mcp-server/src/evolution.ts
// Harness self-evolution engine: propose, evaluate, promote/rollback mutations
// to skills and agents.

import { randomUUID } from "node:crypto";
import type { OmccDb } from "./db.js";
import type { ToolResult } from "./tools.js";

function ok(data?: unknown): ToolResult {
  return { ok: true, data };
}
function err(error: string): ToolResult {
  return { ok: false, error };
}

const VALID_MUTATION_TYPES = ["refine", "expand", "simplify", "restructure"] as const;
type MutationType = (typeof VALID_MUTATION_TYPES)[number];

function isValidMutationType(t: string): t is MutationType {
  return (VALID_MUTATION_TYPES as readonly string[]).includes(t);
}

// --- propose ---

export function omcc_evolve_propose(
  db: OmccDb,
  args: {
    target_file: string;
    mutation_type: string;
    description: string;
    proposed_content: string;
  },
): ToolResult {
  if (!args?.target_file) return err("target_file required");
  if (!args?.mutation_type) return err("mutation_type required");
  if (!args?.description) return err("description required");
  if (!args?.proposed_content) return err("proposed_content required");
  if (!isValidMutationType(args.mutation_type)) {
    return err(`invalid mutation_type: ${args.mutation_type}. Must be one of: ${VALID_MUTATION_TYPES.join(", ")}`);
  }

  // Read the original content if a prior candidate for this file has one,
  // otherwise store the proposed_content as a new baseline.
  const existing = db.raw
    .prepare(
      "SELECT original_content FROM evolution_candidates WHERE target_file = ? AND original_content IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    )
    .get(args.target_file) as { original_content: string } | undefined;

  const id = `evo-${randomUUID().slice(0, 8)}`;
  db.raw
    .prepare(
      `INSERT INTO evolution_candidates
         (id, target_file, mutation_type, description, original_content, proposed_content, status)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed')`,
    )
    .run(
      id,
      args.target_file,
      args.mutation_type,
      args.description,
      existing?.original_content ?? null,
      args.proposed_content,
    );

  return ok({ candidate_id: id, target_file: args.target_file });
}

// --- evaluate ---

export function omcc_evolve_evaluate(
  db: OmccDb,
  args: { candidate_id: string; eval_score: number },
): ToolResult {
  if (!args?.candidate_id) return err("candidate_id required");
  if (typeof args.eval_score !== "number" || args.eval_score < 0 || args.eval_score > 1) {
    return err("eval_score must be a number between 0.0 and 1.0");
  }

  const row = db.raw
    .prepare("SELECT id, status FROM evolution_candidates WHERE id = ?")
    .get(args.candidate_id) as { id: string; status: string } | undefined;
  if (!row) return err(`candidate not found: ${args.candidate_id}`);
  if (row.status !== "proposed") return err(`candidate is ${row.status}, expected proposed`);

  db.raw
    .prepare("UPDATE evolution_candidates SET eval_score = ?, status = 'testing' WHERE id = ?")
    .run(args.eval_score, args.candidate_id);

  return ok({ candidate_id: args.candidate_id, eval_score: args.eval_score, status: "testing" });
}

// --- promote ---

export function omcc_evolve_promote(
  db: OmccDb,
  args: { candidate_id: string },
): ToolResult {
  if (!args?.candidate_id) return err("candidate_id required");

  const row = db.raw
    .prepare("SELECT id, target_file, proposed_content, eval_score, status FROM evolution_candidates WHERE id = ?")
    .get(args.candidate_id) as
    | { id: string; target_file: string; proposed_content: string; eval_score: number | null; status: string }
    | undefined;
  if (!row) return err(`candidate not found: ${args.candidate_id}`);
  if (row.status !== "testing") return err(`candidate is ${row.status}, expected testing`);
  if (row.eval_score === null || row.eval_score <= 0) {
    return err("cannot promote: eval_score must be > 0.0 (positive improvement required)");
  }

  db.raw
    .prepare("UPDATE evolution_candidates SET status = 'promoted', resolved_at = datetime('now') WHERE id = ?")
    .run(args.candidate_id);

  return ok({
    candidate_id: args.candidate_id,
    target_file: row.target_file,
    proposed_content: row.proposed_content,
    status: "promoted",
  });
}

// --- rollback ---

export function omcc_evolve_rollback(
  db: OmccDb,
  args: { candidate_id: string },
): ToolResult {
  if (!args?.candidate_id) return err("candidate_id required");

  const row = db.raw
    .prepare("SELECT id, status FROM evolution_candidates WHERE id = ?")
    .get(args.candidate_id) as { id: string; status: string } | undefined;
  if (!row) return err(`candidate not found: ${args.candidate_id}`);
  if (row.status === "promoted" || row.status === "rejected") {
    return err(`candidate already resolved: ${row.status}`);
  }

  db.raw
    .prepare("UPDATE evolution_candidates SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?")
    .run(args.candidate_id);

  return ok({ candidate_id: args.candidate_id, status: "rejected" });
}

// --- history ---

export function omcc_evolve_history(
  db: OmccDb,
  args: { target_file?: string; status?: string },
): ToolResult {
  let sql = "SELECT id, target_file, mutation_type, description, status, eval_score, created_at, resolved_at FROM evolution_candidates";
  const conditions: string[] = [];
  const params: string[] = [];

  if (args?.target_file) {
    conditions.push("target_file = ?");
    params.push(args.target_file);
  }
  if (args?.status) {
    conditions.push("status = ?");
    params.push(args.status);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.raw.prepare(sql).all(...params);
  return ok(rows);
}
