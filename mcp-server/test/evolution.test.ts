import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  omcc_evolve_propose,
  omcc_evolve_evaluate,
  omcc_evolve_promote,
  omcc_evolve_rollback,
  omcc_evolve_history,
} from "../src/evolution.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-evo-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

function cleanup() {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}

function propose(overrides: Partial<Parameters<typeof omcc_evolve_propose>[1]> = {}) {
  return omcc_evolve_propose(db, {
    target_file: ".github/skills/debug/SKILL.md",
    mutation_type: "refine",
    description: "improve debug skill clarity",
    proposed_content: "# Debug v2\nBetter instructions.",
    ...overrides,
  });
}

describe("omcc_evolve_propose", () => {
  it("creates a candidate with status proposed", () => {
    const r = propose();
    expect(r.ok).toBe(true);
    const d = r.data as any;
    expect(d.candidate_id).toMatch(/^evo-/);
    expect(d.target_file).toBe(".github/skills/debug/SKILL.md");

    const history = omcc_evolve_history(db, {}).data as any[];
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("proposed");
    cleanup();
  });

  it("validates mutation_type", () => {
    const r = propose({ mutation_type: "nuke" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("invalid mutation_type");
    cleanup();
  });

  it("requires all fields", () => {
    expect(omcc_evolve_propose(db, {} as any).ok).toBe(false);
    expect(omcc_evolve_propose(db, { target_file: "f" } as any).ok).toBe(false);
    expect(omcc_evolve_propose(db, { target_file: "f", mutation_type: "refine" } as any).ok).toBe(false);
    expect(
      omcc_evolve_propose(db, {
        target_file: "f",
        mutation_type: "refine",
        description: "d",
      } as any).ok,
    ).toBe(false);
    cleanup();
  });

  it("allows duplicate proposals for the same file", () => {
    const r1 = propose();
    const r2 = propose({ description: "second attempt" });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect((r1.data as any).candidate_id).not.toBe((r2.data as any).candidate_id);

    const history = omcc_evolve_history(db, {}).data as any[];
    expect(history).toHaveLength(2);
    cleanup();
  });

  it("accepts all valid mutation types", () => {
    for (const mt of ["refine", "expand", "simplify", "restructure"]) {
      const r = propose({ mutation_type: mt });
      expect(r.ok).toBe(true);
    }
    cleanup();
  });
});

describe("omcc_evolve_evaluate", () => {
  it("updates eval_score and sets status to testing", () => {
    const id = (propose().data as any).candidate_id;
    const r = omcc_evolve_evaluate(db, { candidate_id: id, eval_score: 0.85 });
    expect(r.ok).toBe(true);
    expect((r.data as any).eval_score).toBe(0.85);
    expect((r.data as any).status).toBe("testing");

    const history = omcc_evolve_history(db, {}).data as any[];
    expect(history[0].eval_score).toBe(0.85);
    expect(history[0].status).toBe("testing");
    cleanup();
  });

  it("rejects invalid eval_score", () => {
    const id = (propose().data as any).candidate_id;
    expect(omcc_evolve_evaluate(db, { candidate_id: id, eval_score: -0.1 }).ok).toBe(false);
    expect(omcc_evolve_evaluate(db, { candidate_id: id, eval_score: 1.5 }).ok).toBe(false);
    expect(omcc_evolve_evaluate(db, { candidate_id: id, eval_score: "high" as any }).ok).toBe(false);
    cleanup();
  });

  it("rejects evaluation of non-proposed candidate", () => {
    const id = (propose().data as any).candidate_id;
    omcc_evolve_evaluate(db, { candidate_id: id, eval_score: 0.5 });
    // Now status is 'testing', second evaluate should fail
    const r = omcc_evolve_evaluate(db, { candidate_id: id, eval_score: 0.6 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("testing");
    cleanup();
  });

  it("rejects unknown candidate_id", () => {
    const r = omcc_evolve_evaluate(db, { candidate_id: "evo-nope", eval_score: 0.5 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not found");
    cleanup();
  });
});

describe("omcc_evolve_promote", () => {
  it("promotes candidate and returns proposed_content", () => {
    const id = (propose().data as any).candidate_id;
    omcc_evolve_evaluate(db, { candidate_id: id, eval_score: 0.72 });
    const r = omcc_evolve_promote(db, { candidate_id: id });
    expect(r.ok).toBe(true);
    const d = r.data as any;
    expect(d.status).toBe("promoted");
    expect(d.proposed_content).toBe("# Debug v2\nBetter instructions.");
    expect(d.target_file).toBe(".github/skills/debug/SKILL.md");
    cleanup();
  });

  it("rejects promotion when eval_score is 0", () => {
    const id = (propose().data as any).candidate_id;
    omcc_evolve_evaluate(db, { candidate_id: id, eval_score: 0.0 });
    const r = omcc_evolve_promote(db, { candidate_id: id });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("eval_score must be > 0.0");
    cleanup();
  });

  it("rejects promotion of non-testing candidate", () => {
    const id = (propose().data as any).candidate_id;
    // Still 'proposed', not evaluated yet
    const r = omcc_evolve_promote(db, { candidate_id: id });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("proposed");
    cleanup();
  });

  it("rejects unknown candidate_id", () => {
    const r = omcc_evolve_promote(db, { candidate_id: "evo-nope" });
    expect(r.ok).toBe(false);
    cleanup();
  });
});

describe("omcc_evolve_rollback", () => {
  it("archives a proposed candidate", () => {
    const id = (propose().data as any).candidate_id;
    const r = omcc_evolve_rollback(db, { candidate_id: id });
    expect(r.ok).toBe(true);
    expect((r.data as any).status).toBe("rejected");

    const history = omcc_evolve_history(db, {}).data as any[];
    expect(history[0].status).toBe("rejected");
    cleanup();
  });

  it("archives a testing candidate", () => {
    const id = (propose().data as any).candidate_id;
    omcc_evolve_evaluate(db, { candidate_id: id, eval_score: 0.3 });
    const r = omcc_evolve_rollback(db, { candidate_id: id });
    expect(r.ok).toBe(true);
    expect((r.data as any).status).toBe("rejected");
    cleanup();
  });

  it("rejects rollback of already resolved candidate", () => {
    const id = (propose().data as any).candidate_id;
    omcc_evolve_evaluate(db, { candidate_id: id, eval_score: 0.8 });
    omcc_evolve_promote(db, { candidate_id: id });
    const r = omcc_evolve_rollback(db, { candidate_id: id });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("promoted");
    cleanup();
  });

  it("rejects unknown candidate_id", () => {
    const r = omcc_evolve_rollback(db, { candidate_id: "evo-nope" });
    expect(r.ok).toBe(false);
    cleanup();
  });
});

describe("omcc_evolve_history", () => {
  it("lists all candidates sorted by date descending", () => {
    propose({ description: "first" });
    propose({ description: "second" });
    const history = omcc_evolve_history(db, {}).data as any[];
    expect(history).toHaveLength(2);
    const descriptions = history.map((h: any) => h.description);
    expect(descriptions).toContain("first");
    expect(descriptions).toContain("second");
    cleanup();
  });

  it("filters by target_file", () => {
    propose({ target_file: "a.md" });
    propose({ target_file: "b.md" });
    const history = omcc_evolve_history(db, { target_file: "a.md" }).data as any[];
    expect(history).toHaveLength(1);
    expect(history[0].target_file).toBe("a.md");
    cleanup();
  });

  it("filters by status", () => {
    const id = (propose().data as any).candidate_id;
    omcc_evolve_rollback(db, { candidate_id: id });
    propose(); // second one stays 'proposed'

    const rejected = omcc_evolve_history(db, { status: "rejected" }).data as any[];
    expect(rejected).toHaveLength(1);
    const proposed = omcc_evolve_history(db, { status: "proposed" }).data as any[];
    expect(proposed).toHaveLength(1);
    cleanup();
  });

  it("returns empty array when no candidates", () => {
    const history = omcc_evolve_history(db, {}).data as any[];
    expect(history).toHaveLength(0);
    cleanup();
  });
});
