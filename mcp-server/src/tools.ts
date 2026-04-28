// mcp-server/src/tools.ts
// Pure tool implementations. Kept independent of the MCP transport so they're
// easy to unit-test.

import type { OmccDb } from "./db.js";
import { computeFitnessScore, type FitnessInput } from "./fitness.js";

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

// --- state ---

export function omcc_state_get(db: OmccDb, args: { key: string }): ToolResult {
  if (!args?.key) return err("key required");
  const row = db.raw.prepare("SELECT value FROM state WHERE key = ?").get(args.key) as
    | { value: string }
    | undefined;
  return ok(row?.value ?? null);
}

export function omcc_state_set(db: OmccDb, args: { key: string; value: string }): ToolResult {
  if (!args?.key) return err("key required");
  if (typeof args.value !== "string") return err("value must be a string");
  db.raw
    .prepare(
      "INSERT INTO state (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
    .run(args.key, args.value);
  return ok({ key: args.key });
}

export function omcc_state_delete(db: OmccDb, args: { key: string }): ToolResult {
  if (!args?.key) return err("key required");
  const r = db.raw.prepare("DELETE FROM state WHERE key = ?").run(args.key);
  return ok({ deleted: Number(r.changes) });
}

// --- prd / stories ---

export function omcc_prd_set(db: OmccDb, args: { id: string; content: string; status?: string }): ToolResult {
  if (!args?.id || !args?.content) return err("id and content required");
  db.raw
    .prepare(
      "INSERT INTO prd (id, content, status) VALUES (?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET content = excluded.content, status = excluded.status"
    )
    .run(args.id, args.content, args.status ?? "draft");
  return ok({ id: args.id });
}

export function omcc_prd_get(db: OmccDb, args: { id: string }): ToolResult {
  if (!args?.id) return err("id required");
  const row = db.raw.prepare("SELECT id, content, status, created_at FROM prd WHERE id = ?").get(args.id);
  return ok(row ?? null);
}

export function omcc_story_add(
  db: OmccDb,
  args: { prd_id: string; id: string; title: string; status?: string }
): ToolResult {
  if (!args?.prd_id || !args?.id || !args?.title) return err("prd_id, id, title required");
  db.raw
    .prepare("INSERT INTO stories (prd_id, id, title, status) VALUES (?, ?, ?, ?)")
    .run(args.prd_id, args.id, args.title, args.status ?? "pending");
  return ok({ prd_id: args.prd_id, id: args.id });
}

export function omcc_story_update(
  db: OmccDb,
  args: { prd_id: string; id: string; status?: string; evidence?: string }
): ToolResult {
  if (!args?.prd_id || !args?.id) return err("prd_id, id required");
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (args.status !== undefined) {
    sets.push("status = ?");
    vals.push(args.status);
  }
  if (args.evidence !== undefined) {
    sets.push("evidence = ?");
    vals.push(args.evidence);
  }
  if (sets.length === 0) return err("nothing to update");
  vals.push(args.prd_id, args.id);
  const r = db.raw.prepare(`UPDATE stories SET ${sets.join(", ")} WHERE prd_id = ? AND id = ?`).run(...vals);
  return ok({ updated: Number(r.changes) });
}

export function omcc_story_list(db: OmccDb, args: { prd_id: string }): ToolResult {
  if (!args?.prd_id) return err("prd_id required");
  const rows = db.raw.prepare("SELECT id, title, status, evidence FROM stories WHERE prd_id = ?").all(args.prd_id);
  return ok(rows);
}

// --- workflow phase ---

export function omcc_phase_get(db: OmccDb, args: { scope?: string }): ToolResult {
  const scope = args?.scope ?? "default";
  const row = db.raw.prepare("SELECT phase, updated_at FROM workflow_phase WHERE scope = ?").get(scope);
  return ok(row ?? null);
}

export function omcc_phase_set(db: OmccDb, args: { scope?: string; phase: string }): ToolResult {
  if (!args?.phase) return err("phase required");
  const scope = args.scope ?? "default";
  db.raw
    .prepare(
      "INSERT INTO workflow_phase (scope, phase, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(scope) DO UPDATE SET phase = excluded.phase, updated_at = excluded.updated_at"
    )
    .run(scope, args.phase);
  return ok({ scope, phase: args.phase });
}

// --- memory ---

export function omcc_memory_remember(
  db: OmccDb,
  args: { key: string; value: string; tags?: string }
): ToolResult {
  if (!args?.key || !args?.value) return err("key and value required");
  db.raw
    .prepare(
      "INSERT INTO memory (key, value, tags, updated_at) VALUES (?, ?, ?, datetime('now')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, tags = excluded.tags, updated_at = excluded.updated_at"
    )
    .run(args.key, args.value, args.tags ?? null);
  return ok({ key: args.key });
}

export function omcc_memory_recall(db: OmccDb, args: { key: string }): ToolResult {
  if (!args?.key) return err("key required");
  const row = db.raw.prepare("SELECT value, tags FROM memory WHERE key = ?").get(args.key);
  return ok(row ?? null);
}

export function omcc_memory_search(db: OmccDb, args: { q: string; limit?: number }): ToolResult {
  if (!args?.q) return err("q required");
  const lim = Math.max(1, Math.min(100, args.limit ?? 20));
  const like = `%${args.q}%`;
  const rows = db.raw
    .prepare(
      "SELECT key, value, tags FROM memory WHERE value LIKE ? OR key LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT ?"
    )
    .all(like, like, like, lim);
  return ok(rows);
}

// --- model routing ---

export interface CategoryConfig {
  description: string;
  default_model: string;
  fallback: string;
}

export const MODEL_CATEGORIES: Record<string, CategoryConfig> = {
  orchestrator: {
    description: "Planning, delegation, complex reasoning, multi-step analysis",
    default_model: "claude-opus-4.6",
    fallback: "claude-sonnet-4.6",
  },
  "deep-worker": {
    description: "Autonomous research, long-running execution, deep exploration",
    default_model: "gpt-5.4",
    fallback: "claude-sonnet-4.6",
  },
  quick: {
    description: "Single-file changes, formatting, simple fixes, typos",
    default_model: "claude-haiku-4.5",
    fallback: "gpt-5-mini",
  },
  reviewer: {
    description: "Code review, security audit, architecture review",
    default_model: "claude-sonnet-4.6",
    fallback: "claude-opus-4.6",
  },
  creative: {
    description: "UI/UX design, game design, content creation, brainstorming",
    default_model: "gemini-2.5-pro",
    fallback: "claude-sonnet-4.6",
  },
};

const CATEGORY_KEYWORDS: { match: RegExp; category: string }[] = [
  { match: /\b(review|audit|security|code.?review|architecture review)\b/i, category: "reviewer" },
  { match: /\b(plan|delegate|orchestrat|multi.?step|complex reason|analyz|architect)\b/i, category: "orchestrator" },
  { match: /\b(research|autonomous|long.?running|deep.?explor|deep.?dive)\b/i, category: "deep-worker" },
  { match: /\b(ui.?design|ux.?design|game.?design|creative|brainstorm|content.?creat)\b/i, category: "creative" },
  { match: /\b(quick|small|trivial|simple|one.?liner|format|typo|fix)\b/i, category: "quick" },
];

const ROUTING_RULES: { match: RegExp; model: string; reason: string }[] = [
  { match: /\b(architect|design|review|critique|spec|plan)\b/i, model: "claude-opus-4.7", reason: "design/architecture/review → high-reasoning model" },
  { match: /\b(refactor|simplify|cleanup|rename)\b/i, model: "claude-sonnet-4.6", reason: "structural change → balanced model" },
  { match: /\b(implement|write code|build|edit|create file)\b/i, model: "gpt-5.3-codex", reason: "code generation → code-tuned model" },
  { match: /\b(test|vitest|jest|pytest|unit test)\b/i, model: "claude-sonnet-4.6", reason: "test authoring → balanced model" },
  { match: /\b(quick|small|trivial|simple|one-liner|format)\b/i, model: "claude-haiku-4.5", reason: "small task → fast/cheap model" },
  { match: /\b(explore|search|find|grep|inspect|read)\b/i, model: "claude-haiku-4.5", reason: "exploration → fast/cheap model" },
];

function inferCategory(task: string): string | null {
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.match.test(task)) return rule.category;
  }
  return null;
}

export function omcc_route_model(_db: OmccDb, args: { task?: string; category?: string }): ToolResult {
  // Category-based routing: direct lookup
  if (args?.category) {
    const cat = MODEL_CATEGORIES[args.category];
    if (!cat) {
      return ok({
        model: "claude-sonnet-4.6",
        category: null,
        reason: `unknown category "${args.category}", using default`,
      });
    }
    return ok({
      model: cat.default_model,
      category: args.category,
      reason: `category "${args.category}": ${cat.description}`,
    });
  }

  // Task-based routing: try category inference first, then fall back to keyword rules
  if (!args?.task) return err("task or category required");

  const inferred = inferCategory(args.task);
  if (inferred) {
    const cat = MODEL_CATEGORIES[inferred];
    return ok({
      model: cat.default_model,
      category: inferred,
      reason: `inferred category "${inferred}": ${cat.description}`,
    });
  }

  // Legacy keyword matching (backward compat)
  for (const r of ROUTING_RULES) {
    if (r.match.test(args.task)) {
      return ok({ model: r.model, category: null, reason: r.reason });
    }
  }
  return ok({ model: "claude-sonnet-4.6", category: null, reason: "default — balanced general-purpose model" });
}

export function omcc_route_categories(_db: OmccDb, _args: Record<string, never>): ToolResult {
  return ok(MODEL_CATEGORIES);
}

// --- fitness score ---

export function omcc_fitness_score(_db: OmccDb, args: FitnessInput): ToolResult {
  return ok(computeFitnessScore(args ?? {}));
}

// Tool registry for the MCP transport layer
export const TOOLS = {
  omcc_state_get,
  omcc_state_set,
  omcc_state_delete,
  omcc_prd_set,
  omcc_prd_get,
  omcc_story_add,
  omcc_story_update,
  omcc_story_list,
  omcc_phase_get,
  omcc_phase_set,
  omcc_memory_remember,
  omcc_memory_recall,
  omcc_memory_search,
  omcc_route_model,
  omcc_route_categories,
  omcc_fitness_score,
} as const;

export type ToolName = keyof typeof TOOLS;
