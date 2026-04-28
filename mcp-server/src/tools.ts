// mcp-server/src/tools.ts
// Pure tool implementations. Kept independent of the MCP transport so they're
// easy to unit-test.

import type { OmccDb } from "./db.js";
import {
  parseWorkflow,
  validateDAG,
  getExecutionOrder,
  createRun,
  getRun,
  completeNode,
  listWorkflows,
} from "./workflow-engine.js";
import {
  omcc_eval_create as evalCreate,
  omcc_eval_score as evalScore,
  omcc_eval_report as evalReport,
  omcc_eval_history as evalHistory,
} from "./skill-eval.js";

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

const ROUTING_RULES: { match: RegExp; model: string; reason: string }[] = [
  { match: /\b(architect|design|review|critique|spec|plan)\b/i, model: "claude-opus-4.7", reason: "design/architecture/review â†’ high-reasoning model" },
  { match: /\b(refactor|simplify|cleanup|rename)\b/i, model: "claude-sonnet-4.6", reason: "structural change â†’ balanced model" },
  { match: /\b(implement|write code|build|edit|create file)\b/i, model: "gpt-5.3-codex", reason: "code generation â†’ code-tuned model" },
  { match: /\b(test|vitest|jest|pytest|unit test)\b/i, model: "claude-sonnet-4.6", reason: "test authoring â†’ balanced model" },
  { match: /\b(quick|small|trivial|simple|one-liner|format)\b/i, model: "claude-haiku-4.5", reason: "small task â†’ fast/cheap model" },
  { match: /\b(explore|search|find|grep|inspect|read)\b/i, model: "claude-haiku-4.5", reason: "exploration â†’ fast/cheap model" },
];

export function omcc_route_model(_db: OmccDb, args: { task: string }): ToolResult {
  if (!args?.task) return err("task required");
  for (const r of ROUTING_RULES) {
    if (r.match.test(args.task)) {
      return ok({ model: r.model, reason: r.reason });
    }
  }
  return ok({ model: "claude-sonnet-4.6", reason: "default â€” balanced general-purpose model" });
}


// --- skill evaluation ---

export function omcc_eval_create(db: OmccDb, args: { skill_name: string; test_cases: string; graders: string }): ToolResult {
  const r = evalCreate(db, args);
  return r.ok ? ok(r.data) : err(r.error ?? "eval_create failed");
}

export function omcc_eval_score(
  db: OmccDb,
  args: { eval_id: string; arm: string; test_case_id: string; grader_results: string },
): ToolResult {
  const r = evalScore(db, args);
  return r.ok ? ok(r.data) : err(r.error ?? "eval_score failed");
}

export function omcc_eval_report(db: OmccDb, args: { eval_id: string }): ToolResult {
  const r = evalReport(db, args);
  return r.ok ? ok(r.data) : err(r.error ?? "eval_report failed");
}

export function omcc_eval_history(db: OmccDb, args: { skill_name?: string }): ToolResult {
  const r = evalHistory(db, args);
  return r.ok ? ok(r.data) : err(r.error ?? "eval_history failed");
}


// --- workflow engine ---

const DEFAULT_WORKFLOW_DIR = ".github/workflows-omcc";

export function omcc_workflow_list(_db: OmccDb, args: { dir?: string }): ToolResult {
  const dir = args?.dir ?? DEFAULT_WORKFLOW_DIR;
  try { const workflows = listWorkflows(dir); return ok(workflows); }
  catch (e: unknown) { return err(`Failed to list workflows: ${e instanceof Error ? e.message : String(e)}`); }
}

export function omcc_workflow_run(db: OmccDb, args: { name: string; yaml_content?: string; dir?: string; dry_run?: boolean }): ToolResult {
  if (!args?.name) return err("name required");
  const dir = args.dir ?? DEFAULT_WORKFLOW_DIR;
  let yamlContent = args.yaml_content;
  if (!yamlContent) {
    const { readFileSync, readdirSync, existsSync } = require("node:fs") as typeof import("node:fs");
    const { join, extname } = require("node:path") as typeof import("node:path");
    if (!existsSync(dir)) return err(`Workflow directory not found: ${dir}`);
    const files = readdirSync(dir).filter((f: string) => extname(f) === ".yaml" || extname(f) === ".yml");
    for (const file of files) { try { const content = readFileSync(join(dir, file), "utf-8"); const wf = parseWorkflow(content); if (wf.name === args.name) { yamlContent = content; break; } } catch { /* skip */ } }
    if (!yamlContent) return err(`Workflow not found: '${args.name}'`);
  }
  let workflow: ReturnType<typeof parseWorkflow>;
  try { workflow = parseWorkflow(yamlContent); } catch (e: unknown) { return err(`Parse error: ${e instanceof Error ? e.message : String(e)}`); }
  const errors = validateDAG(workflow);
  if (errors.length > 0) return err(`Validation errors: ${errors.join("; ")}`);
  const waves = getExecutionOrder(workflow);
  const plan = waves.map((wave, i) => ({ wave: i + 1, parallel: wave.length > 1, nodes: wave.map((id) => { const node = workflow.nodes.find((n) => n.id === id)!; return { id: node.id, type: node.loop ? "loop" : node.skill ? "skill" : node.agent ? "agent" : node.bash ? "bash" : "interactive", skill: node.skill ?? node.loop?.skill, agent: node.agent, bash: node.bash, prompt: node.prompt ?? node.loop?.prompt, loop: node.loop ? { until: node.loop.until, max_iterations: node.loop.max_iterations } : undefined }; }) }));
  if (args.dry_run) return ok({ dry_run: true, workflow_name: workflow.name, plan });
  const run = createRun(db, workflow);
  return ok({ run_id: run.id, workflow_name: workflow.name, status: run.status, plan });
}

export function omcc_workflow_status(db: OmccDb, args: { run_id: string }): ToolResult {
  if (!args?.run_id) return err("run_id required");
  const run = getRun(db, args.run_id);
  if (!run) return err(`Run not found: '${args.run_id}'`);
  const completed = Object.entries(run.results).filter(([, r]) => r.status === "completed").map(([id]) => id);
  const failed = Object.entries(run.results).filter(([, r]) => r.status === "failed").map(([id]) => id);
  const pending = Object.entries(run.results).filter(([, r]) => r.status === "pending").map(([id]) => id);
  return ok({ run_id: run.id, workflow_name: run.workflow_name, status: run.status, current_node: run.current_node, started_at: run.started_at, completed_at: run.completed_at, nodes: { completed, failed, pending }, results: run.results });
}

export function omcc_workflow_complete_node(db: OmccDb, args: { run_id: string; node_id: string; status: "completed" | "failed"; result?: string }): ToolResult {
  if (!args?.run_id) return err("run_id required");
  if (!args?.node_id) return err("node_id required");
  if (args.status !== "completed" && args.status !== "failed") return err("status must be 'completed' or 'failed'");
  const run = completeNode(db, args.run_id, args.node_id, args.status, args.result);
  if (!run) return err(`Run or node not found: run='${args.run_id}', node='${args.node_id}'`);
  return ok({ run_id: run.id, workflow_status: run.status, node_id: args.node_id, node_status: args.status });
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
  omcc_eval_create,
  omcc_eval_score,
  omcc_eval_report,
  omcc_eval_history,
} as const;

export type ToolName = keyof typeof TOOLS;
