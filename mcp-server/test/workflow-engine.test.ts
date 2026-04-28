import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  parseWorkflow,
  validateDAG,
  getExecutionOrder,
  createRun,
  getRun,
  completeNode,
  listWorkflows,
  ensureWorkflowTable,
} from "../src/workflow-engine.js";
import {
  omcc_workflow_list,
  omcc_workflow_run,
  omcc_workflow_status,
  omcc_workflow_complete_node,
} from "../src/tools.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-wf-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

// --- YAML parsing ---

describe("parseWorkflow", () => {
  it("parses a valid workflow", () => {
    const yaml = `
name: Test Workflow
description: A test workflow
nodes:
  - id: step1
    skill: autopilot
    prompt: "Do something"
  - id: step2
    depends_on: [step1]
    agent: code-reviewer
    prompt: "Review"
`;
    const wf = parseWorkflow(yaml);
    expect(wf.name).toBe("Test Workflow");
    expect(wf.description).toBe("A test workflow");
    expect(wf.nodes).toHaveLength(2);
    expect(wf.nodes[0].id).toBe("step1");
    expect(wf.nodes[0].skill).toBe("autopilot");
    expect(wf.nodes[1].depends_on).toEqual(["step1"]);
  });

  it("parses a workflow with loop nodes", () => {
    const yaml = `
name: Loop Test
nodes:
  - id: looper
    loop:
      skill: autopilot
      prompt: "Keep going"
      until: ALL_TASKS_COMPLETE
      max_iterations: 5
      fresh_context: true
`;
    const wf = parseWorkflow(yaml);
    expect(wf.nodes[0].loop).toBeDefined();
    expect(wf.nodes[0].loop!.skill).toBe("autopilot");
    expect(wf.nodes[0].loop!.until).toBe("ALL_TASKS_COMPLETE");
    expect(wf.nodes[0].loop!.max_iterations).toBe(5);
    expect(wf.nodes[0].loop!.fresh_context).toBe(true);
  });

  it("rejects empty YAML", () => {
    expect(() => parseWorkflow("")).toThrow("empty or non-object");
  });

  it("rejects missing name", () => {
    expect(() => parseWorkflow("nodes: []")).toThrow("'name' is required");
  });

  it("rejects empty nodes", () => {
    expect(() => parseWorkflow("name: X\nnodes: []")).toThrow("non-empty array");
  });

  it("rejects node without id", () => {
    expect(() => parseWorkflow("name: X\nnodes:\n  - skill: foo")).toThrow("non-empty 'id'");
  });
});

// --- DAG validation ---

describe("validateDAG", () => {
  it("returns no errors for a valid DAG", () => {
    const wf = parseWorkflow(`
name: Valid
nodes:
  - id: a
    bash: "echo a"
  - id: b
    depends_on: [a]
    bash: "echo b"
  - id: c
    depends_on: [a]
    bash: "echo c"
  - id: d
    depends_on: [b, c]
    bash: "echo d"
`);
    expect(validateDAG(wf)).toEqual([]);
  });

  it("detects missing dependency", () => {
    const wf = parseWorkflow(`
name: Missing
nodes:
  - id: a
    depends_on: [nonexistent]
    bash: "echo a"
`);
    const errors = validateDAG(wf);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("unknown node 'nonexistent'");
  });

  it("detects self-dependency", () => {
    const wf = parseWorkflow(`
name: Self
nodes:
  - id: a
    depends_on: [a]
    bash: "echo a"
`);
    const errors = validateDAG(wf);
    expect(errors.some((e) => e.includes("depends on itself"))).toBe(true);
  });

  it("detects cycles", () => {
    const wf = parseWorkflow(`
name: Cycle
nodes:
  - id: a
    depends_on: [b]
    bash: "echo a"
  - id: b
    depends_on: [a]
    bash: "echo b"
`);
    const errors = validateDAG(wf);
    expect(errors.some((e) => e.includes("cycle"))).toBe(true);
  });

  it("detects duplicate node IDs", () => {
    const wf = parseWorkflow(`
name: Dupe
nodes:
  - id: a
    bash: "echo 1"
  - id: a
    bash: "echo 2"
`);
    const errors = validateDAG(wf);
    expect(errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  it("detects nodes without actions", () => {
    const wf = parseWorkflow(`
name: NoAction
nodes:
  - id: empty
`);
    const errors = validateDAG(wf);
    expect(errors.some((e) => e.includes("no action"))).toBe(true);
  });
});

// --- Topological sort ---

describe("getExecutionOrder", () => {
  it("returns correct wave ordering for a linear DAG", () => {
    const wf = parseWorkflow(`
name: Linear
nodes:
  - id: a
    bash: "echo a"
  - id: b
    depends_on: [a]
    bash: "echo b"
  - id: c
    depends_on: [b]
    bash: "echo c"
`);
    const waves = getExecutionOrder(wf);
    expect(waves).toEqual([["a"], ["b"], ["c"]]);
  });

  it("groups independent nodes into the same wave", () => {
    const wf = parseWorkflow(`
name: Parallel
nodes:
  - id: a
    bash: "echo a"
  - id: b
    bash: "echo b"
  - id: c
    bash: "echo c"
  - id: d
    depends_on: [a, b, c]
    bash: "echo d"
`);
    const waves = getExecutionOrder(wf);
    expect(waves).toHaveLength(2);
    expect(waves[0]).toEqual(["a", "b", "c"]);
    expect(waves[1]).toEqual(["d"]);
  });

  it("handles diamond dependencies", () => {
    const wf = parseWorkflow(`
name: Diamond
nodes:
  - id: start
    bash: "echo start"
  - id: left
    depends_on: [start]
    bash: "echo left"
  - id: right
    depends_on: [start]
    bash: "echo right"
  - id: end
    depends_on: [left, right]
    bash: "echo end"
`);
    const waves = getExecutionOrder(wf);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toEqual(["start"]);
    expect(waves[1]).toEqual(["left", "right"]);
    expect(waves[2]).toEqual(["end"]);
  });
});

// --- Run management ---

describe("createRun", () => {
  it("creates a run with pending nodes", () => {
    const wf = parseWorkflow(`
name: Test
nodes:
  - id: a
    bash: "echo a"
  - id: b
    depends_on: [a]
    bash: "echo b"
`);
    const run = createRun(db, wf);
    expect(run.id).toMatch(/^wfr-/);
    expect(run.workflow_name).toBe("Test");
    expect(run.status).toBe("running");
    expect(run.results.a.status).toBe("pending");
    expect(run.results.b.status).toBe("pending");
  });

  it("persists run in database", () => {
    const wf = parseWorkflow(`
name: Persist
nodes:
  - id: x
    bash: "echo x"
`);
    const run = createRun(db, wf);
    const fetched = getRun(db, run.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.workflow_name).toBe("Persist");
    expect(fetched!.results.x.status).toBe("pending");
  });
});

describe("completeNode", () => {
  it("marks a node as completed", () => {
    const wf = parseWorkflow(`
name: Complete
nodes:
  - id: a
    bash: "echo a"
  - id: b
    depends_on: [a]
    bash: "echo b"
`);
    const run = createRun(db, wf);
    const updated = completeNode(db, run.id, "a", "completed", "done");
    expect(updated).not.toBeNull();
    expect(updated!.results.a.status).toBe("completed");
    expect(updated!.results.a.result).toBe("done");
    expect(updated!.status).toBe("running");
  });

  it("marks run as completed when all nodes done", () => {
    const wf = parseWorkflow(`
name: AllDone
nodes:
  - id: only
    bash: "echo only"
`);
    const run = createRun(db, wf);
    const updated = completeNode(db, run.id, "only", "completed");
    expect(updated!.status).toBe("completed");
    expect(updated!.completed_at).toBeDefined();
  });

  it("marks run as failed if any node failed", () => {
    const wf = parseWorkflow(`
name: Fail
nodes:
  - id: x
    bash: "echo x"
`);
    const run = createRun(db, wf);
    const updated = completeNode(db, run.id, "x", "failed", "bad exit code");
    expect(updated!.status).toBe("failed");
  });

  it("returns null for unknown run", () => {
    expect(completeNode(db, "nonexistent", "a", "completed")).toBeNull();
  });

  it("returns null for unknown node", () => {
    const wf = parseWorkflow(`
name: X
nodes:
  - id: a
    bash: "echo a"
`);
    const run = createRun(db, wf);
    expect(completeNode(db, run.id, "nope", "completed")).toBeNull();
  });
});

// --- Workflow listing ---

describe("listWorkflows", () => {
  it("lists yaml files from a directory", () => {
    const wfDir = join(tmp, "workflows");
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, "test.yaml"), 'name: Test WF\ndescription: A test\nnodes:\n  - id: a\n    bash: "echo"');
    writeFileSync(join(wfDir, "other.yml"), 'name: Other\nnodes:\n  - id: b\n    bash: "echo"');
    writeFileSync(join(wfDir, "readme.md"), "# not a workflow");
    const result = listWorkflows(wfDir);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name).sort()).toEqual(["Other", "Test WF"]);
  });

  it("returns empty for nonexistent directory", () => {
    expect(listWorkflows(join(tmp, "nope"))).toEqual([]);
  });

  it("skips invalid yaml files", () => {
    const wfDir = join(tmp, "workflows2");
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, "bad.yaml"), "not: valid: yaml: [");
    writeFileSync(join(wfDir, "good.yaml"), 'name: Good\nnodes:\n  - id: a\n    bash: "echo"');
    const result = listWorkflows(wfDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Good");
  });
});

// --- MCP tool wrappers ---

describe("omcc_workflow_run (dry_run)", () => {
  it("returns execution plan without creating a run", () => {
    const yamlContent = 'name: Dry\nnodes:\n  - id: a\n    bash: "echo a"\n  - id: b\n    depends_on: [a]\n    bash: "echo b"';
    const result = omcc_workflow_run(db, { name: "Dry", yaml_content: yamlContent, dry_run: true });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.dry_run).toBe(true);
    expect(data.plan).toHaveLength(2);
    expect(data.plan[0].nodes[0].id).toBe("a");
    expect(data.plan[1].nodes[0].id).toBe("b");
  });
});

describe("omcc_workflow_run (live)", () => {
  it("creates a run and returns plan", () => {
    const yamlContent = 'name: Live\nnodes:\n  - id: step1\n    skill: autopilot\n    prompt: "go"';
    const result = omcc_workflow_run(db, { name: "Live", yaml_content: yamlContent });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.run_id).toMatch(/^wfr-/);
    expect(data.status).toBe("running");
  });

  it("rejects invalid YAML", () => {
    const result = omcc_workflow_run(db, { name: "Bad", yaml_content: "not yaml [" });
    expect(result.ok).toBe(false);
  });

  it("rejects workflow with cycles", () => {
    const yamlContent = 'name: Cyclic\nnodes:\n  - id: a\n    depends_on: [b]\n    bash: "echo a"\n  - id: b\n    depends_on: [a]\n    bash: "echo b"';
    const result = omcc_workflow_run(db, { name: "Cyclic", yaml_content: yamlContent });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cycle");
  });
});

describe("omcc_workflow_status", () => {
  it("returns status of a run", () => {
    const yamlContent = 'name: Status\nnodes:\n  - id: a\n    bash: "echo a"\n  - id: b\n    depends_on: [a]\n    bash: "echo b"';
    const runResult = omcc_workflow_run(db, { name: "Status", yaml_content: yamlContent });
    const runId = (runResult.data as any).run_id;
    const status = omcc_workflow_status(db, { run_id: runId });
    expect(status.ok).toBe(true);
    const data = status.data as any;
    expect(data.nodes.pending).toEqual(["a", "b"]);
  });

  it("rejects missing run_id", () => {
    expect(omcc_workflow_status(db, {} as any).ok).toBe(false);
  });
});

describe("omcc_workflow_complete_node", () => {
  it("completes a node and updates run status", () => {
    const yamlContent = 'name: NodeComplete\nnodes:\n  - id: only\n    bash: "echo done"';
    const runResult = omcc_workflow_run(db, { name: "NodeComplete", yaml_content: yamlContent });
    const runId = (runResult.data as any).run_id;
    const complete = omcc_workflow_complete_node(db, { run_id: runId, node_id: "only", status: "completed", result: "all good" });
    expect(complete.ok).toBe(true);
    const data = complete.data as any;
    expect(data.workflow_status).toBe("completed");
  });

  it("rejects invalid status", () => {
    const result = omcc_workflow_complete_node(db, { run_id: "x", node_id: "y", status: "invalid" as any });
    expect(result.ok).toBe(false);
  });
});

describe("omcc_workflow_list tool", () => {
  it("lists workflows from a directory", () => {
    const wfDir = join(tmp, "wf-tool");
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, "test.yaml"), 'name: Tool Test\nnodes:\n  - id: a\n    bash: "echo"');
    const result = omcc_workflow_list(db, { dir: wfDir });
    expect(result.ok).toBe(true);
    const data = result.data as any[];
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Tool Test");
  });
});
