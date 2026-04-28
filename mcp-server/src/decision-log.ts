// mcp-server/src/decision-log.ts
// Decision log tools: record, list, and check architectural decisions.

import type { OmccDb } from "./db.js";
import type { ToolResult } from "./tools.js";

function ok(data?: unknown): ToolResult {
  return { ok: true, data };
}
function err(error: string): ToolResult {
  return { ok: false, error };
}

const VALID_CATEGORIES = new Set(["architecture", "technology", "scope", "process"]);
const VALID_STATUSES = new Set(["active", "superseded", "reversed"]);

export function omcc_decision_add(
  db: OmccDb,
  args: { id?: string; decision: string; rationale: string; category?: string }
): ToolResult {
  if (!args?.decision) return err("decision required");
  if (!args?.rationale) return err("rationale required");
  if (args.category && !VALID_CATEGORIES.has(args.category)) {
    return err(`category must be one of: ${[...VALID_CATEGORIES].join(", ")}`);
  }

  const id = args.id ?? `dec-${Date.now()}`;
  db.raw
    .prepare(
      "INSERT INTO decisions (id, decision, rationale, category) VALUES (?, ?, ?, ?)"
    )
    .run(id, args.decision, args.rationale, args.category ?? null);
  return ok({ id });
}

export function omcc_decision_list(
  db: OmccDb,
  args: { category?: string; status?: string }
): ToolResult {
  const status = args?.status ?? "active";
  if (!VALID_STATUSES.has(status)) {
    return err(`status must be one of: ${[...VALID_STATUSES].join(", ")}`);
  }

  let query: string;
  const params: (string | null)[] = [status];

  if (args?.category) {
    if (!VALID_CATEGORIES.has(args.category)) {
      return err(`category must be one of: ${[...VALID_CATEGORIES].join(", ")}`);
    }
    query =
      "SELECT id, decision, rationale, date, category, status FROM decisions WHERE status = ? AND category = ? ORDER BY date DESC";
    params.push(args.category);
  } else {
    query =
      "SELECT id, decision, rationale, date, category, status FROM decisions WHERE status = ? ORDER BY date DESC";
  }

  const rows = db.raw.prepare(query).all(...params);
  return ok(rows);
}

export function omcc_decision_check(
  db: OmccDb,
  args: { proposal: string }
): ToolResult {
  if (!args?.proposal) return err("proposal required");

  const rows = db.raw
    .prepare(
      "SELECT id, decision, rationale, category FROM decisions WHERE status = 'active'"
    )
    .all() as { id: string; decision: string; rationale: string; category: string | null }[];

  const proposalWords = extractKeywords(args.proposal);
  if (proposalWords.length === 0) {
    return ok({ contradictions: [], aligned: true });
  }

  const contradictions: {
    id: string;
    decision: string;
    matchedKeywords: string[];
  }[] = [];

  for (const row of rows) {
    const decisionWords = extractKeywords(row.decision + " " + row.rationale);
    const matched = proposalWords.filter((w) => decisionWords.includes(w));
    if (matched.length >= 2) {
      contradictions.push({
        id: row.id,
        decision: row.decision,
        matchedKeywords: matched,
      });
    }
  }

  return ok({
    contradictions,
    aligned: contradictions.length === 0,
    checkedAgainst: rows.length,
  });
}

export function omcc_decision_update_status(
  db: OmccDb,
  args: { id: string; status: string }
): ToolResult {
  if (!args?.id) return err("id required");
  if (!args?.status) return err("status required");
  if (!VALID_STATUSES.has(args.status)) {
    return err(`status must be one of: ${[...VALID_STATUSES].join(", ")}`);
  }
  const r = db.raw
    .prepare("UPDATE decisions SET status = ? WHERE id = ?")
    .run(args.status, args.id);
  return ok({ updated: Number(r.changes) });
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can",
    "had", "her", "was", "one", "our", "out", "has", "his", "how",
    "its", "may", "new", "now", "old", "see", "way", "who", "did",
    "get", "let", "say", "she", "too", "use", "with", "that", "this",
    "will", "each", "make", "like", "from", "have", "been", "than",
    "them", "then", "they", "some", "into", "over", "such", "more",
    "when", "what", "which", "their", "about", "would", "these",
    "other", "could", "after", "should", "also", "just", "only",
  ]);

  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !stopwords.has(w))
    ),
  ];
}
