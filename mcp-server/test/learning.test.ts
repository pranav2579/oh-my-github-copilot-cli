import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  extractPatterns,
  omcc_learn_extract,
  omcc_learn_record,
  omcc_learn_promote,
  omcc_learn_list,
} from "../src/learning.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-learn-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

function cleanup() {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}

describe("extractPatterns", () => {
  it("extracts sentences with signal words", () => {
    const summary =
      "We always use vitest for testing. Never use jest. This is a normal sentence without signals.";
    const patterns = extractPatterns(summary);
    expect(patterns).toHaveLength(2);
    expect(patterns[0].pattern).toContain("always use vitest");
    expect(patterns[0].category).toBe("convention");
    expect(patterns[1].pattern).toContain("Never use jest");
    expect(patterns[1].category).toBe("anti-pattern");
  });

  it("returns empty for text without signal words", () => {
    const summary = "We had a great session today. Everything went well.";
    const patterns = extractPatterns(summary);
    expect(patterns).toHaveLength(0);
  });

  it("classifies commands correctly", () => {
    const summary = "You must always run the build command before deploying.";
    const patterns = extractPatterns(summary);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].category).toBe("command");
  });

  it("classifies architecture correctly", () => {
    const summary = "You should always separate the service layer from controllers.";
    const patterns = extractPatterns(summary);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].category).toBe("architecture");
  });

  it("classifies workflow correctly", () => {
    const summary = "The pipeline must include a review step before merging.";
    const patterns = extractPatterns(summary);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].category).toBe("workflow");
  });
});

describe("omcc_learn_extract", () => {
  it("returns candidates from session summary", () => {
    const result = omcc_learn_extract(db, {
      session_summary: "We should always write tests first. Never skip linting.",
    });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.candidates.length).toBe(2);
    expect(data.candidates[0].confidence).toBe(0.3);
    expect(data.candidates[0].id).toBeTruthy();
    cleanup();
  });

  it("returns empty candidates with helpful message for no signals", () => {
    const result = omcc_learn_extract(db, {
      session_summary: "Today was uneventful.",
    });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.candidates).toHaveLength(0);
    expect(data.message).toContain("signal words");
    cleanup();
  });

  it("requires session_summary", () => {
    const result = omcc_learn_extract(db, {} as any);
    expect(result.ok).toBe(false);
    cleanup();
  });
});

describe("omcc_learn_record", () => {
  it("records a new pattern with default confidence 0.3", () => {
    const result = omcc_learn_record(db, {
      pattern: "Always use TypeScript strict mode",
      category: "convention",
    });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.confidence).toBe(0.3);
    expect(data.occurrences).toBe(1);
    expect(data.updated).toBe(false);
    cleanup();
  });

  it("records a new pattern with custom confidence", () => {
    const result = omcc_learn_record(db, {
      pattern: "Never commit secrets",
      category: "anti-pattern",
      confidence: 0.8,
    });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.confidence).toBe(0.8);
    cleanup();
  });

  it("increments occurrences and bumps confidence on duplicate", () => {
    omcc_learn_record(db, { pattern: "Use vitest", category: "convention" });
    const r2 = omcc_learn_record(db, { pattern: "Use vitest", category: "convention" });
    expect(r2.ok).toBe(true);
    const data = r2.data as any;
    expect(data.occurrences).toBe(2);
    expect(data.confidence).toBeCloseTo(0.4, 5);
    expect(data.updated).toBe(true);
    cleanup();
  });

  it("caps confidence at 1.0", () => {
    omcc_learn_record(db, { pattern: "cap test", category: "convention", confidence: 0.95 });
    const r2 = omcc_learn_record(db, { pattern: "cap test", category: "convention" });
    expect(r2.ok).toBe(true);
    const data = r2.data as any;
    expect(data.confidence).toBeLessThanOrEqual(1.0);
    cleanup();
  });

  it("rejects invalid category", () => {
    const result = omcc_learn_record(db, {
      pattern: "something",
      category: "invalid-cat",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("category must be one of");
    cleanup();
  });

  it("requires pattern", () => {
    const result = omcc_learn_record(db, { pattern: "", category: "convention" } as any);
    expect(result.ok).toBe(false);
    cleanup();
  });

  it("requires category", () => {
    const result = omcc_learn_record(db, { pattern: "something", category: "" } as any);
    expect(result.ok).toBe(false);
    cleanup();
  });
});

describe("omcc_learn_promote", () => {
  it("promotes a pattern with confidence >= 0.7", () => {
    omcc_learn_record(db, { pattern: "Promote me", category: "convention", confidence: 0.8 });
    const list = omcc_learn_list(db, {}).data as any[];
    const id = list[0].id;

    const result = omcc_learn_promote(db, { id, target: "L2" });
    expect(result.ok).toBe(true);
    expect((result.data as any).promoted_to).toBe("L2");
    cleanup();
  });

  it("rejects promotion when confidence < 0.7", () => {
    omcc_learn_record(db, { pattern: "Too low", category: "convention", confidence: 0.3 });
    const list = omcc_learn_list(db, {}).data as any[];
    const id = list[0].id;

    const result = omcc_learn_promote(db, { id, target: "L1" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("below promotion threshold");
    cleanup();
  });

  it("rejects promotion for non-existent pattern", () => {
    const result = omcc_learn_promote(db, { id: "nonexistent", target: "L1" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
    cleanup();
  });

  it("rejects invalid target", () => {
    const result = omcc_learn_promote(db, { id: "x", target: "L3" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("L1");
    cleanup();
  });

  it("requires id", () => {
    const result = omcc_learn_promote(db, { id: "", target: "L1" } as any);
    expect(result.ok).toBe(false);
    cleanup();
  });
});

describe("omcc_learn_list", () => {
  it("lists all patterns sorted by confidence desc", () => {
    omcc_learn_record(db, { pattern: "Low conf", category: "convention", confidence: 0.2 });
    omcc_learn_record(db, { pattern: "High conf", category: "anti-pattern", confidence: 0.9 });
    omcc_learn_record(db, { pattern: "Mid conf", category: "command", confidence: 0.5 });

    const result = omcc_learn_list(db, {});
    expect(result.ok).toBe(true);
    const data = result.data as any[];
    expect(data).toHaveLength(3);
    expect(data[0].confidence).toBe(0.9);
    expect(data[2].confidence).toBe(0.2);
    cleanup();
  });

  it("filters by category", () => {
    omcc_learn_record(db, { pattern: "Conv pattern", category: "convention" });
    omcc_learn_record(db, { pattern: "Anti pattern", category: "anti-pattern" });

    const result = omcc_learn_list(db, { category: "convention" });
    const data = result.data as any[];
    expect(data).toHaveLength(1);
    expect(data[0].category).toBe("convention");
    cleanup();
  });

  it("filters by min_confidence", () => {
    omcc_learn_record(db, { pattern: "Low", category: "convention", confidence: 0.2 });
    omcc_learn_record(db, { pattern: "High", category: "convention", confidence: 0.8 });

    const result = omcc_learn_list(db, { min_confidence: 0.5 });
    const data = result.data as any[];
    expect(data).toHaveLength(1);
    expect(data[0].confidence).toBe(0.8);
    cleanup();
  });

  it("returns empty array when no patterns match", () => {
    const result = omcc_learn_list(db, { category: "workflow" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    cleanup();
  });
});
