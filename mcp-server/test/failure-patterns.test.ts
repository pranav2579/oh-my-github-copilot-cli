import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  omcc_failure_pattern_add,
  omcc_failure_pattern_list,
  omcc_failure_pattern_check,
} from "../src/failure-patterns.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-fp-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("omcc_failure_pattern_add", () => {
  it("adds a new failure pattern", () => {
    const r = omcc_failure_pattern_add(db, {
      pattern: "Editing files without reading them first",
      prevention: "Always view a file before editing",
    });
    expect(r.ok).toBe(true);
    const data = r.data as any;
    expect(data.id).toBeTruthy();
    expect(data.occurrences).toBe(1);
    expect(data.updated).toBe(false);
  });

  it("defaults scope to 'project'", () => {
    omcc_failure_pattern_add(db, {
      pattern: "test pattern",
      prevention: "test prevention",
    });
    const list = omcc_failure_pattern_list(db, { scope: "project" }).data as any[];
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("project");
  });

  it("auto-increments occurrences on duplicate pattern text", () => {
    omcc_failure_pattern_add(db, {
      pattern: "Same mistake",
      prevention: "Do it right v1",
    });
    const r2 = omcc_failure_pattern_add(db, {
      pattern: "Same mistake",
      prevention: "Do it right v2",
    });
    expect(r2.ok).toBe(true);
    const data = r2.data as any;
    expect(data.occurrences).toBe(2);
    expect(data.updated).toBe(true);

    // Verify only one row exists
    const list = omcc_failure_pattern_list(db, {}).data as any[];
    expect(list).toHaveLength(1);
    expect(list[0].occurrences).toBe(2);
    expect(list[0].prevention).toBe("Do it right v2");
  });

  it("treats same pattern text with different scope as separate entries", () => {
    omcc_failure_pattern_add(db, {
      pattern: "Same mistake",
      prevention: "prevention 1",
      scope: "project",
    });
    omcc_failure_pattern_add(db, {
      pattern: "Same mistake",
      prevention: "prevention 2",
      scope: "global",
    });
    const list = omcc_failure_pattern_list(db, {}).data as any[];
    expect(list).toHaveLength(2);
  });

  it("rejects missing pattern", () => {
    const r = omcc_failure_pattern_add(db, { pattern: "", prevention: "x" } as any);
    expect(r.ok).toBe(false);
  });

  it("rejects missing prevention", () => {
    const r = omcc_failure_pattern_add(db, { pattern: "x", prevention: "" } as any);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid scope", () => {
    const r = omcc_failure_pattern_add(db, {
      pattern: "x",
      prevention: "y",
      scope: "invalid" as any,
    });
    expect(r.ok).toBe(false);
  });
});

describe("omcc_failure_pattern_list", () => {
  it("returns empty array when no patterns exist", () => {
    const r = omcc_failure_pattern_list(db, {});
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });

  it("filters by scope", () => {
    omcc_failure_pattern_add(db, { pattern: "p1", prevention: "x", scope: "project" });
    omcc_failure_pattern_add(db, { pattern: "p2", prevention: "y", scope: "global" });

    const project = omcc_failure_pattern_list(db, { scope: "project" }).data as any[];
    expect(project).toHaveLength(1);
    expect(project[0].pattern).toBe("p1");

    const global = omcc_failure_pattern_list(db, { scope: "global" }).data as any[];
    expect(global).toHaveLength(1);
    expect(global[0].pattern).toBe("p2");

    const all = omcc_failure_pattern_list(db, { scope: "all" }).data as any[];
    expect(all).toHaveLength(2);
  });

  it("sorts by occurrences descending", () => {
    omcc_failure_pattern_add(db, { pattern: "rare", prevention: "x" });
    omcc_failure_pattern_add(db, { pattern: "common", prevention: "y" });
    omcc_failure_pattern_add(db, { pattern: "common", prevention: "y" });
    omcc_failure_pattern_add(db, { pattern: "common", prevention: "y" });

    const list = omcc_failure_pattern_list(db, {}).data as any[];
    expect(list[0].pattern).toBe("common");
    expect(list[0].occurrences).toBe(3);
    expect(list[1].pattern).toBe("rare");
    expect(list[1].occurrences).toBe(1);
  });

  it("respects limit parameter", () => {
    omcc_failure_pattern_add(db, { pattern: "p1", prevention: "x" });
    omcc_failure_pattern_add(db, { pattern: "p2", prevention: "y" });
    omcc_failure_pattern_add(db, { pattern: "p3", prevention: "z" });

    const limited = omcc_failure_pattern_list(db, { limit: 2 }).data as any[];
    expect(limited).toHaveLength(2);
  });
});

describe("omcc_failure_pattern_check", () => {
  it("returns matching patterns based on keywords", () => {
    omcc_failure_pattern_add(db, {
      pattern: "Editing files without reading them first",
      prevention: "Always read before edit",
    });
    omcc_failure_pattern_add(db, {
      pattern: "Committing without running tests",
      prevention: "Run tests before commit",
    });

    const r = omcc_failure_pattern_check(db, { context: "I am about to edit a file" });
    expect(r.ok).toBe(true);
    const matches = r.data as any[];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m: any) => m.pattern.includes("Editing"))).toBe(true);
  });

  it("returns empty array when no patterns match", () => {
    omcc_failure_pattern_add(db, {
      pattern: "database migration issue",
      prevention: "check schema",
    });
    const r = omcc_failure_pattern_check(db, { context: "deploying frontend assets" });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });

  it("requires context", () => {
    const r = omcc_failure_pattern_check(db, {} as any);
    expect(r.ok).toBe(false);
  });

  it("handles short words by filtering them out", () => {
    omcc_failure_pattern_add(db, {
      pattern: "test pattern here",
      prevention: "fix it",
    });
    const r = omcc_failure_pattern_check(db, { context: "is a" });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });
});
