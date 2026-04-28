import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  omcc_decision_add,
  omcc_decision_list,
  omcc_decision_check,
  omcc_decision_update_status,
} from "../src/decision-log.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-decision-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

function cleanup() {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}

describe("decision_add", () => {
  it("creates a record with auto-generated id", () => {
    const r = omcc_decision_add(db, {
      decision: "Use PostgreSQL for persistence",
      rationale: "Team expertise and JSONB support",
    });
    expect(r.ok).toBe(true);
    expect((r.data as any).id).toMatch(/^dec-/);
    cleanup();
  });

  it("creates a record with custom id", () => {
    const r = omcc_decision_add(db, {
      id: "dec-001",
      decision: "Use React for UI",
      rationale: "Ecosystem maturity",
      category: "technology",
    });
    expect(r.ok).toBe(true);
    expect((r.data as any).id).toBe("dec-001");
    cleanup();
  });

  it("requires decision and rationale", () => {
    expect(omcc_decision_add(db, { decision: "", rationale: "r" } as any).ok).toBe(false);
    expect(omcc_decision_add(db, { decision: "d", rationale: "" } as any).ok).toBe(false);
    expect(omcc_decision_add(db, {} as any).ok).toBe(false);
    cleanup();
  });

  it("rejects invalid category", () => {
    const r = omcc_decision_add(db, {
      decision: "Use X",
      rationale: "Because",
      category: "invalid" as any,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("category");
    cleanup();
  });
});

describe("decision_list", () => {
  it("returns active decisions", () => {
    omcc_decision_add(db, { id: "d1", decision: "Use REST", rationale: "Simplicity", category: "architecture" });
    omcc_decision_add(db, { id: "d2", decision: "Use TypeScript", rationale: "Type safety", category: "technology" });
    const r = omcc_decision_list(db, {});
    expect(r.ok).toBe(true);
    expect(r.data).toHaveLength(2);
    cleanup();
  });

  it("filters by category", () => {
    omcc_decision_add(db, { id: "d1", decision: "Use REST", rationale: "Simplicity", category: "architecture" });
    omcc_decision_add(db, { id: "d2", decision: "Use TypeScript", rationale: "Type safety", category: "technology" });
    const r = omcc_decision_list(db, { category: "architecture" });
    expect(r.ok).toBe(true);
    expect((r.data as any[])).toHaveLength(1);
    expect((r.data as any[])[0].id).toBe("d1");
    cleanup();
  });

  it("defaults to active status", () => {
    omcc_decision_add(db, { id: "d1", decision: "Use REST", rationale: "Simplicity" });
    omcc_decision_update_status(db, { id: "d1", status: "superseded" });
    omcc_decision_add(db, { id: "d2", decision: "Use GraphQL", rationale: "Flexibility" });
    const r = omcc_decision_list(db, {});
    expect(r.ok).toBe(true);
    expect((r.data as any[])).toHaveLength(1);
    expect((r.data as any[])[0].id).toBe("d2");
    cleanup();
  });

  it("can list superseded decisions", () => {
    omcc_decision_add(db, { id: "d1", decision: "Use REST", rationale: "Simplicity" });
    omcc_decision_update_status(db, { id: "d1", status: "superseded" });
    const r = omcc_decision_list(db, { status: "superseded" });
    expect(r.ok).toBe(true);
    expect(r.data).toHaveLength(1);
    cleanup();
  });
});

describe("decision_check", () => {
  it("finds contradictions via keyword matching", () => {
    omcc_decision_add(db, {
      id: "d1",
      decision: "Use PostgreSQL for database persistence layer",
      rationale: "Team has deep PostgreSQL expertise and needs JSONB",
    });
    const r = omcc_decision_check(db, {
      proposal: "Switch the database persistence layer to MongoDB",
    });
    expect(r.ok).toBe(true);
    expect((r.data as any).contradictions).toHaveLength(1);
    expect((r.data as any).contradictions[0].id).toBe("d1");
    expect((r.data as any).aligned).toBe(false);
    cleanup();
  });

  it("reports aligned when no contradictions", () => {
    omcc_decision_add(db, { id: "d1", decision: "Use PostgreSQL for database", rationale: "Team expertise" });
    const r = omcc_decision_check(db, { proposal: "Add a new React component for the dashboard" });
    expect(r.ok).toBe(true);
    expect((r.data as any).aligned).toBe(true);
    cleanup();
  });

  it("ignores superseded decisions", () => {
    omcc_decision_add(db, {
      id: "d1",
      decision: "Use PostgreSQL for database persistence",
      rationale: "Team expertise with PostgreSQL databases",
    });
    omcc_decision_update_status(db, { id: "d1", status: "superseded" });
    const r = omcc_decision_check(db, { proposal: "Switch database persistence to MongoDB" });
    expect(r.ok).toBe(true);
    expect((r.data as any).aligned).toBe(true);
    cleanup();
  });

  it("requires proposal", () => {
    expect(omcc_decision_check(db, {} as any).ok).toBe(false);
    cleanup();
  });
});

describe("decision status transitions", () => {
  it("active to superseded", () => {
    omcc_decision_add(db, { id: "d1", decision: "Use REST", rationale: "Simple" });
    const r = omcc_decision_update_status(db, { id: "d1", status: "superseded" });
    expect(r.ok).toBe(true);
    expect((r.data as any).updated).toBe(1);
    expect(omcc_decision_list(db, { status: "superseded" }).data).toHaveLength(1);
    cleanup();
  });

  it("active to reversed", () => {
    omcc_decision_add(db, { id: "d1", decision: "Use REST", rationale: "Simple" });
    omcc_decision_update_status(db, { id: "d1", status: "reversed" });
    expect(omcc_decision_list(db, { status: "reversed" }).data).toHaveLength(1);
    cleanup();
  });

  it("rejects invalid status", () => {
    const r = omcc_decision_update_status(db, { id: "d1", status: "invalid" });
    expect(r.ok).toBe(false);
    cleanup();
  });

  it("reports 0 updated for non-existent id", () => {
    const r = omcc_decision_update_status(db, { id: "nope", status: "superseded" });
    expect(r.ok).toBe(true);
    expect((r.data as any).updated).toBe(0);
    cleanup();
  });
});

describe("direction-guard extension", () => {
  it("parseProjectBrief extracts goals and non-goals", async () => {
    const { parseProjectBrief } = await import(
      "../../.github/extensions/omcc-direction-guard/extension.mjs"
    );
    const result = parseProjectBrief("# P\n\n## Goals\n- Fast API\n- Real-time\n\n## Non-Goals\n- Mobile\n- Offline\n");
    expect(result.goals).toEqual(["Fast API", "Real-time"]);
    expect(result.nonGoals).toEqual(["Mobile", "Offline"]);
  });

  it("handles missing sections", async () => {
    const { parseProjectBrief } = await import(
      "../../.github/extensions/omcc-direction-guard/extension.mjs"
    );
    const result = parseProjectBrief("# Project\n\nJust text.");
    expect(result.goals).toHaveLength(0);
    expect(result.nonGoals).toHaveLength(0);
  });

  it("handles h3 headings", async () => {
    const { parseProjectBrief } = await import(
      "../../.github/extensions/omcc-direction-guard/extension.mjs"
    );
    const result = parseProjectBrief("# B\n### Goals\n- MVP\n### Non-Goals\n- i18n\n");
    expect(result.goals).toEqual(["MVP"]);
    expect(result.nonGoals).toEqual(["i18n"]);
  });
});
