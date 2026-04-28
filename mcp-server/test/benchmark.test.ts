import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type OmccDb } from "../src/db.js";
import { omcc_benchmark_record, omcc_benchmark_compare, omcc_benchmark_report, omcc_benchmark_history } from "../src/benchmark.js";

let db: OmccDb;
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "omcc-bench-")); db = openDb(join(tmp, "db.sqlite")); });
function cleanup() { db.close(); rmSync(tmp, { recursive: true, force: true }); }

describe("omcc_benchmark_record", () => {
  it("records a run", () => {
    const r = omcc_benchmark_record(db, { task_description: "Review auth", task_category: "reviewer", model_used: "claude-sonnet-4.6", quality_score: 0.85, tokens_used: 1200, duration_seconds: 4.5, cost_estimate: 0.003, success: 1 });
    expect(r.ok).toBe(true);
    expect((r.data as any).id).toMatch(/^bench-/);
    cleanup();
  });
  it("requires task_description", () => { expect(omcc_benchmark_record(db, { task_description: "", model_used: "x" } as any).ok).toBe(false); cleanup(); });
  it("requires model_used", () => { expect(omcc_benchmark_record(db, { task_description: "t", model_used: "" } as any).ok).toBe(false); cleanup(); });
});

describe("omcc_benchmark_compare", () => {
  it("returns single model stats", () => {
    omcc_benchmark_record(db, { task_description: "review", task_category: "reviewer", model_used: "claude-sonnet-4.6", quality_score: 0.9, tokens_used: 1000, duration_seconds: 3.0, cost_estimate: 0.01 });
    const r = omcc_benchmark_compare(db, { task_category: "reviewer" });
    const d = r.data as any;
    expect(d.models).toHaveLength(1);
    expect(d.models[0].avg_quality).toBe(0.9);
    expect(d.recommended).toBe("claude-sonnet-4.6");
    cleanup();
  });
  it("sorts by value ratio", () => {
    omcc_benchmark_record(db, { task_description: "t1", task_category: "coding", model_used: "model-a", quality_score: 0.95, cost_estimate: 0.001 });
    omcc_benchmark_record(db, { task_description: "t2", task_category: "coding", model_used: "model-b", quality_score: 0.90, cost_estimate: 0.1 });
    const d = omcc_benchmark_compare(db, { task_category: "coding" }).data as any;
    expect(d.models[0].model_used).toBe("model-a");
    expect(d.recommended).toBe("model-a");
    cleanup();
  });
  it("requires task_category", () => { expect(omcc_benchmark_compare(db, {} as any).ok).toBe(false); cleanup(); });
});

describe("omcc_benchmark_report", () => {
  it("generates report", () => {
    omcc_benchmark_record(db, { task_description: "r", task_category: "reviewer", model_used: "s", quality_score: 0.8, cost_estimate: 0.01 });
    omcc_benchmark_record(db, { task_description: "i", task_category: "coder", model_used: "g", quality_score: 0.9, cost_estimate: 0.02 });
    const d = omcc_benchmark_report(db).data as any;
    expect(d.total_runs).toBe(2);
    expect(d.categories).toHaveProperty("reviewer");
    expect(d.categories).toHaveProperty("coder");
    cleanup();
  });
});

describe("omcc_benchmark_history", () => {
  it("returns recent runs", () => {
    omcc_benchmark_record(db, { task_description: "t1", task_category: "r", model_used: "a" });
    omcc_benchmark_record(db, { task_description: "t2", task_category: "c", model_used: "b" });
    expect((omcc_benchmark_history(db, {}).data as any[]).length).toBe(2);
    cleanup();
  });
  it("filters by model", () => {
    omcc_benchmark_record(db, { task_description: "t1", model_used: "a", task_category: "x" });
    omcc_benchmark_record(db, { task_description: "t2", model_used: "b", task_category: "x" });
    const d = omcc_benchmark_history(db, { model: "a" }).data as any[];
    expect(d).toHaveLength(1);
    expect(d[0].model_used).toBe("a");
    cleanup();
  });
  it("filters by category", () => {
    omcc_benchmark_record(db, { task_description: "t1", model_used: "m", task_category: "reviewer" });
    omcc_benchmark_record(db, { task_description: "t2", model_used: "m", task_category: "coder" });
    expect((omcc_benchmark_history(db, { category: "coder" }).data as any[]).length).toBe(1);
    cleanup();
  });
  it("respects limit", () => {
    for (let i = 0; i < 5; i++) omcc_benchmark_record(db, { task_description: "t" + i, model_used: "m" });
    expect((omcc_benchmark_history(db, { limit: 2 }).data as any[]).length).toBe(2);
    cleanup();
  });
});

describe("edge cases", () => {
  it("zero cost", () => {
    omcc_benchmark_record(db, { task_description: "f", task_category: "free", model_used: "fm", quality_score: 0.9, cost_estimate: 0.0 });
    expect((omcc_benchmark_compare(db, { task_category: "free" }).data as any).models[0].value_ratio).toBe(0);
    cleanup();
  });
  it("success rate", () => {
    omcc_benchmark_record(db, { task_description: "ok1", task_category: "t", model_used: "x", success: 1 });
    omcc_benchmark_record(db, { task_description: "ok2", task_category: "t", model_used: "x", success: 1 });
    omcc_benchmark_record(db, { task_description: "f1", task_category: "t", model_used: "x", success: 0 });
    expect((omcc_benchmark_compare(db, { task_category: "t" }).data as any).models[0].success_rate).toBeCloseTo(2/3, 5);
    cleanup();
  });
});
