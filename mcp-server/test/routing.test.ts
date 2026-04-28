import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  omcc_route_model,
  omcc_route_categories,
  MODEL_CATEGORIES,
} from "../src/tools.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-routing-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

function cleanup() {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}

describe("category lookup", () => {
  it.each([
    ["orchestrator", "claude-opus-4.6"],
    ["deep-worker", "gpt-5.4"],
    ["quick", "claude-haiku-4.5"],
    ["reviewer", "claude-sonnet-4.6"],
    ["creative", "gemini-2.5-pro"],
  ])("category '%s' returns %s", (category, expectedModel) => {
    const r = omcc_route_model(db, { category }).data as any;
    expect(r.model).toBe(expectedModel);
    expect(r.category).toBe(category);
    cleanup();
  });

  it("unknown category returns fallback with null category", () => {
    const r = omcc_route_model(db, { category: "nonexistent" }).data as any;
    expect(r.model).toBe("claude-sonnet-4.6");
    expect(r.category).toBeNull();
    expect(r.reason).toContain("unknown category");
    cleanup();
  });
});

describe("task-to-category inference", () => {
  it.each([
    ["review this PR for security issues", "reviewer", "claude-sonnet-4.6"],
    ["plan the migration strategy", "orchestrator", "claude-opus-4.6"],
    ["do some deep research on this topic", "deep-worker", "gpt-5.4"],
    ["brainstorm ideas for the new UI", "creative", "gemini-2.5-pro"],
    ["quick fix for the typo", "quick", "claude-haiku-4.5"],
  ])("'%s' infers category '%s' with model %s", (task, expectedCategory, expectedModel) => {
    const r = omcc_route_model(db, { task }).data as any;
    expect(r.model).toBe(expectedModel);
    expect(r.category).toBe(expectedCategory);
    cleanup();
  });
});

describe("backward compatibility", () => {
  it.each([
    ["refactor this function into smaller pieces", "claude-sonnet-4.6"],
    ["implement the login endpoint", "gpt-5.3-codex"],
    ["write a unit test for parseUser", "claude-sonnet-4.6"],
    ["explore the codebase to find auth code", "claude-haiku-4.5"],
    ["something completely unrelated", "claude-sonnet-4.6"],
  ])("task '%s' still returns %s via legacy rules", (task, expectedModel) => {
    const r = omcc_route_model(db, { task }).data as any;
    expect(r.model).toBe(expectedModel);
    cleanup();
  });

  it("returns error when neither task nor category provided", () => {
    const r = omcc_route_model(db, {} as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("task or category required");
    cleanup();
  });

  it("category takes precedence over task when both provided", () => {
    const r = omcc_route_model(db, { category: "quick", task: "plan a complex migration" }).data as any;
    expect(r.model).toBe("claude-haiku-4.5");
    expect(r.category).toBe("quick");
    cleanup();
  });
});

describe("omcc_route_categories", () => {
  it("returns all categories", () => {
    const r = omcc_route_categories(db, {} as any);
    expect(r.ok).toBe(true);
    const cats = r.data as Record<string, any>;
    expect(Object.keys(cats)).toEqual(
      expect.arrayContaining(["orchestrator", "deep-worker", "quick", "reviewer", "creative"])
    );
    expect(Object.keys(cats)).toHaveLength(5);
    cleanup();
  });

  it("each category has required fields", () => {
    const r = omcc_route_categories(db, {} as any);
    const cats = r.data as Record<string, any>;
    for (const [_name, cat] of Object.entries(cats)) {
      expect(cat).toHaveProperty("description");
      expect(cat).toHaveProperty("default_model");
      expect(cat).toHaveProperty("fallback");
      expect(typeof cat.description).toBe("string");
      expect(typeof cat.default_model).toBe("string");
      expect(typeof cat.fallback).toBe("string");
    }
    cleanup();
  });

  it("matches MODEL_CATEGORIES constant", () => {
    const r = omcc_route_categories(db, {} as any);
    expect(r.data).toEqual(MODEL_CATEGORIES);
    cleanup();
  });
});