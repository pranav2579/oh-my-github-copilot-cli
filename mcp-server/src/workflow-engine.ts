// mcp-server/src/workflow-engine.ts
// YAML workflow engine: parses declarative DAGs, validates them, and tracks
// execution via SQLite.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import type { OmccDb } from "./db.js";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as typeof import("js-yaml");

// --- Types ---

export interface LoopConfig {
  skill?: string;
  prompt?: string;
  until?: string;
  max_iterations?: number;
  fresh_context?: boolean;
}

export interface WorkflowNode {
  id: string;
  depends_on?: string[];
  skill?: string;
  agent?: string;
  bash?: string;
  prompt?: string;
  interactive?: boolean;
  loop?: LoopConfig;
}

export interface Workflow {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
}

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface NodeResult {
  status: NodeStatus;
  result?: string;
  started_at?: string;
  completed_at?: string;
}

export interface WorkflowRun {
  id: string;
  workflow_name: string;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  current_node?: string;
  started_at: string;
  completed_at?: string;
  results: Record<string, NodeResult>;
}

// --- Database ---

export function ensureWorkflowTable(db: OmccDb): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      current_node TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      node_results TEXT DEFAULT '{}'
    );
  `);
}

// --- YAML parsing ---

export function parseWorkflow(yamlContent: string): Workflow {
  const doc = yaml.load(yamlContent) as Record<string, unknown>;
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid workflow: empty or non-object YAML document");
  }
  const name = doc.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Invalid workflow: 'name' is required and must be a non-empty string");
  }
  const description = typeof doc.description === "string" ? doc.description : undefined;
  const rawNodes = doc.nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    throw new Error("Invalid workflow: 'nodes' must be a non-empty array");
  }
  const nodes: WorkflowNode[] = rawNodes.map((raw: unknown, idx: number) => {
    if (!raw || typeof raw !== "object") throw new Error(`Invalid workflow: node at index ${idx} is not an object`);
    const n = raw as Record<string, unknown>;
    if (typeof n.id !== "string" || n.id.trim().length === 0) throw new Error(`Invalid workflow: node at index ${idx} must have a non-empty 'id'`);
    const node: WorkflowNode = { id: n.id };
    if (n.depends_on !== undefined) {
      if (!Array.isArray(n.depends_on) || !n.depends_on.every((d: unknown) => typeof d === "string")) throw new Error(`Invalid workflow: node '${n.id}' depends_on must be an array of strings`);
      node.depends_on = n.depends_on as string[];
    }
    if (typeof n.skill === "string") node.skill = n.skill;
    if (typeof n.agent === "string") node.agent = n.agent;
    if (typeof n.bash === "string") node.bash = n.bash;
    if (typeof n.prompt === "string") node.prompt = n.prompt;
    if (typeof n.interactive === "boolean") node.interactive = n.interactive;
    if (n.loop !== undefined) {
      if (typeof n.loop !== "object" || n.loop === null) throw new Error(`Invalid workflow: node '${n.id}' loop must be an object`);
      const l = n.loop as Record<string, unknown>;
      node.loop = {};
      if (typeof l.skill === "string") node.loop.skill = l.skill;
      if (typeof l.prompt === "string") node.loop.prompt = l.prompt;
      if (typeof l.until === "string") node.loop.until = l.until;
      if (typeof l.max_iterations === "number") node.loop.max_iterations = l.max_iterations;
      if (typeof l.fresh_context === "boolean") node.loop.fresh_context = l.fresh_context;
    }
    return node;
  });
  return { name, description, nodes };
}

// --- DAG validation ---

export function validateDAG(workflow: Workflow): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(workflow.nodes.map((n) => n.id));
  const seen = new Set<string>();
  for (const node of workflow.nodes) {
    if (seen.has(node.id)) errors.push(`Duplicate node id: '${node.id}'`);
    seen.add(node.id);
  }
  for (const node of workflow.nodes) {
    for (const dep of node.depends_on ?? []) {
      if (!nodeIds.has(dep)) errors.push(`Node '${node.id}' depends on unknown node '${dep}'`);
    }
  }
  for (const node of workflow.nodes) {
    if (node.depends_on?.includes(node.id)) errors.push(`Node '${node.id}' depends on itself`);
  }
  for (const node of workflow.nodes) {
    const hasAction = node.skill || node.agent || node.bash || node.loop || node.interactive;
    if (!hasAction) errors.push(`Node '${node.id}' has no action (skill, agent, bash, loop, or interactive)`);
  }
  if (errors.length === 0) {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();
    for (const node of workflow.nodes) { inDegree.set(node.id, 0); adjList.set(node.id, []); }
    for (const node of workflow.nodes) {
      for (const dep of node.depends_on ?? []) {
        adjList.get(dep)!.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      }
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      visited++;
      for (const neighbor of adjList.get(current) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }
    if (visited !== workflow.nodes.length) errors.push("Workflow contains a dependency cycle");
  }
  return errors;
}

// --- Topological sort into parallel waves ---

export function getExecutionOrder(workflow: Workflow): string[][] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  for (const node of workflow.nodes) { inDegree.set(node.id, 0); adjList.set(node.id, []); }
  for (const node of workflow.nodes) {
    for (const dep of node.depends_on ?? []) {
      adjList.get(dep)!.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }
  const waves: string[][] = [];
  let remaining = new Set(workflow.nodes.map((n) => n.id));
  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) { if ((inDegree.get(id) ?? 0) === 0) wave.push(id); }
    if (wave.length === 0) break;
    wave.sort();
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
      for (const neighbor of adjList.get(id) ?? []) { inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) - 1); }
    }
  }
  return waves;
}

// --- Run management ---

function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `wfr-${ts}-${rand}`;
}

export function createRun(db: OmccDb, workflow: Workflow): WorkflowRun {
  ensureWorkflowTable(db);
  const run: WorkflowRun = { id: generateRunId(), workflow_name: workflow.name, status: "running", started_at: new Date().toISOString(), results: {} };
  for (const node of workflow.nodes) { run.results[node.id] = { status: "pending" }; }
  db.raw.prepare("INSERT INTO workflow_runs (id, workflow_name, status, started_at, node_results) VALUES (?, ?, ?, ?, ?)").run(run.id, run.workflow_name, run.status, run.started_at, JSON.stringify(run.results));
  return run;
}

export function getRun(db: OmccDb, runId: string): WorkflowRun | null {
  ensureWorkflowTable(db);
  const row = db.raw.prepare("SELECT id, workflow_name, status, current_node, started_at, completed_at, node_results FROM workflow_runs WHERE id = ?").get(runId) as Record<string, string> | undefined;
  if (!row) return null;
  return { id: row.id, workflow_name: row.workflow_name, status: row.status as WorkflowRun["status"], current_node: row.current_node ?? undefined, started_at: row.started_at, completed_at: row.completed_at ?? undefined, results: JSON.parse(row.node_results || "{}") };
}

export function completeNode(db: OmccDb, runId: string, nodeId: string, status: "completed" | "failed", result?: string): WorkflowRun | null {
  ensureWorkflowTable(db);
  const run = getRun(db, runId);
  if (!run) return null;
  if (!(nodeId in run.results)) return null;
  run.results[nodeId] = { status, result, completed_at: new Date().toISOString() };
  const allDone = Object.values(run.results).every((r) => r.status === "completed" || r.status === "failed" || r.status === "skipped");
  const anyFailed = Object.values(run.results).some((r) => r.status === "failed");
  if (allDone) { run.status = anyFailed ? "failed" : "completed"; run.completed_at = new Date().toISOString(); }
  db.raw.prepare("UPDATE workflow_runs SET status = ?, current_node = ?, completed_at = ?, node_results = ? WHERE id = ?").run(run.status, nodeId, run.completed_at ?? null, JSON.stringify(run.results), run.id);
  return run;
}

// --- Workflow listing ---

export interface WorkflowSummary { name: string; description?: string; filename: string; node_count: number; }

export function listWorkflows(workflowDir: string): WorkflowSummary[] {
  if (!existsSync(workflowDir)) return [];
  const files = readdirSync(workflowDir).filter((f) => extname(f) === ".yaml" || extname(f) === ".yml");
  const summaries: WorkflowSummary[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(workflowDir, file), "utf-8");
      const wf = parseWorkflow(content);
      summaries.push({ name: wf.name, description: wf.description, filename: file, node_count: wf.nodes.length });
    } catch { /* skip invalid */ }
  }
  return summaries;
}
