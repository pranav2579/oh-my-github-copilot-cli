import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  omcc_memory_layer_get,
  omcc_memory_promote,
  omcc_memory_demote,
  omcc_memory_layer_add,
} from "../src/memory-layers.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-ml-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("memory_layers table creation", () => {
  it("creates the memory_layers table on db open", () => {
    const row = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_layers'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("memory_layers");
  });
});

describe("omcc_memory_layer_add", () => {
  it("adds an entry at default level 3", () => {
    const r = omcc_memory_layer_add(db, { id: "rule-1", content: "Always use strict mode" });
    expect(r.ok).toBe(true);
    expect((r.data as any).level).toBe(3);
  });

  it("adds an entry at a specific level", () => {
    const r = omcc_memory_layer_add(db, {
      id: "rule-2",
      content: "Use ESLint",
      level: 2,
      confidence: 0.8,
      category: "rule",
      source: "session",
    });
    expect(r.ok).toBe(true);
    expect((r.data as any).level).toBe(2);
  });

  it("rejects level 0", () => {
    const r = omcc_memory_layer_add(db, { id: "bad", content: "x", level: 0 });
    expect(r.ok).toBe(false);
  });

  it("requires id and content", () => {
    expect(omcc_memory_layer_add(db, { id: "", content: "x" }).ok).toBe(false);
    expect(omcc_memory_layer_add(db, { id: "x", content: "" }).ok).toBe(false);
  });

  it("upserts on conflict", () => {
    omcc_memory_layer_add(db, { id: "dup", content: "v1", level: 3 });
    omcc_memory_layer_add(db, { id: "dup", content: "v2", level: 2 });
    const rows = db.raw
      .prepare("SELECT content, level FROM memory_layers WHERE id = ?")
      .get("dup") as { content: string; level: number };
    expect(rows.content).toBe("v2");
    expect(rows.level).toBe(2);
  });
});

describe("omcc_memory_layer_get", () => {
  it("returns L0 info", () => {
    const r = omcc_memory_layer_get(db, { level: 0 });
    expect(r.ok).toBe(true);
    expect((r.data as any).level).toBe(0);
  });

  it("returns L1 entries (only confidence >= 0.7)", () => {
    omcc_memory_layer_add(db, { id: "l1-high", content: "important rule", level: 1, confidence: 0.9 });
    omcc_memory_layer_add(db, { id: "l1-low", content: "weak rule", level: 1, confidence: 0.3 });
    const r = omcc_memory_layer_get(db, { level: 1 });
    expect(r.ok).toBe(true);
    const data = r.data as any;
    expect(data.count).toBe(1);
    expect(data.entries[0].id).toBe("l1-high");
  });

  it("returns L2 entries", () => {
    omcc_memory_layer_add(db, { id: "l2-1", content: "project state", level: 2 });
    const r = omcc_memory_layer_get(db, { level: 2 });
    expect(r.ok).toBe(true);
    expect((r.data as any).count).toBe(1);
  });

  it("returns L3 entries with optional search", () => {
    omcc_memory_layer_add(db, { id: "l3-1", content: "JWT auth pattern" });
    omcc_memory_layer_add(db, { id: "l3-2", content: "Tailwind CSS convention" });
    const all = omcc_memory_layer_get(db, { level: 3 });
    expect((all.data as any).count).toBe(2);

    const filtered = omcc_memory_layer_get(db, { level: 3, q: "JWT" });
    expect((filtered.data as any).count).toBe(1);
    expect((filtered.data as any).entries[0].id).toBe("l3-1");
  });

  it("rejects invalid level", () => {
    expect(omcc_memory_layer_get(db, { level: 5 }).ok).toBe(false);
    expect(omcc_memory_layer_get(db, { level: -1 }).ok).toBe(false);
  });
});

describe("omcc_memory_promote", () => {
  it("promotes L3 -> L2", () => {
    omcc_memory_layer_add(db, { id: "p1", content: "test pattern", level: 3, confidence: 0.5 });
    const r = omcc_memory_promote(db, { id: "p1", from_level: 3, to_level: 2 });
    expect(r.ok).toBe(true);
    expect((r.data as any).promoted).toBe(true);

    const row = db.raw.prepare("SELECT level FROM memory_layers WHERE id = ?").get("p1") as { level: number };
    expect(row.level).toBe(2);
  });

  it("promotes L2 -> L1 with sufficient confidence", () => {
    omcc_memory_layer_add(db, { id: "p2", content: "strong rule", level: 2, confidence: 0.85 });
    const r = omcc_memory_promote(db, { id: "p2", from_level: 2, to_level: 1 });
    expect(r.ok).toBe(true);

    const row = db.raw.prepare("SELECT level FROM memory_layers WHERE id = ?").get("p2") as { level: number };
    expect(row.level).toBe(1);
  });

  it("rejects L2 -> L1 when confidence < 0.7", () => {
    omcc_memory_layer_add(db, { id: "p3", content: "weak rule", level: 2, confidence: 0.4 });
    const r = omcc_memory_promote(db, { id: "p3", from_level: 2, to_level: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("0.7");

    const row = db.raw.prepare("SELECT level FROM memory_layers WHERE id = ?").get("p3") as { level: number };
    expect(row.level).toBe(2);
  });

  it("rejects invalid promotion paths", () => {
    expect(omcc_memory_promote(db, { id: "x", from_level: 1, to_level: 0 }).ok).toBe(false);
    expect(omcc_memory_promote(db, { id: "x", from_level: 3, to_level: 1 }).ok).toBe(false);
  });

  it("rejects when entry not found", () => {
    const r = omcc_memory_promote(db, { id: "nonexistent", from_level: 3, to_level: 2 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not found");
  });

  it("rejects when entry is at wrong level", () => {
    omcc_memory_layer_add(db, { id: "wrong-level", content: "test", level: 2 });
    const r = omcc_memory_promote(db, { id: "wrong-level", from_level: 3, to_level: 2 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("level 2");
  });
});

describe("omcc_memory_demote", () => {
  it("demotes L1 -> L2", () => {
    omcc_memory_layer_add(db, { id: "d1", content: "stale rule", level: 1, confidence: 0.8 });
    const r = omcc_memory_demote(db, { id: "d1", from_level: 1, to_level: 2 });
    expect(r.ok).toBe(true);
    expect((r.data as any).demoted).toBe(true);

    const row = db.raw.prepare("SELECT level, promoted_at FROM memory_layers WHERE id = ?").get("d1") as {
      level: number;
      promoted_at: string | null;
    };
    expect(row.level).toBe(2);
    expect(row.promoted_at).toBeNull();
  });

  it("demotes L2 -> L3", () => {
    omcc_memory_layer_add(db, { id: "d2", content: "unused state", level: 2 });
    const r = omcc_memory_demote(db, { id: "d2", from_level: 2, to_level: 3 });
    expect(r.ok).toBe(true);

    const row = db.raw.prepare("SELECT level FROM memory_layers WHERE id = ?").get("d2") as { level: number };
    expect(row.level).toBe(3);
  });

  it("rejects invalid demotion paths", () => {
    expect(omcc_memory_demote(db, { id: "x", from_level: 3, to_level: 4 }).ok).toBe(false);
    expect(omcc_memory_demote(db, { id: "x", from_level: 0, to_level: 1 }).ok).toBe(false);
  });

  it("rejects when entry not found", () => {
    const r = omcc_memory_demote(db, { id: "nonexistent", from_level: 1, to_level: 2 });
    expect(r.ok).toBe(false);
  });
});

describe("promote sets promoted_at timestamp", () => {
  it("records promoted_at on promotion", () => {
    omcc_memory_layer_add(db, { id: "ts-test", content: "timestamp check", level: 3 });
    omcc_memory_promote(db, { id: "ts-test", from_level: 3, to_level: 2 });
    const row = db.raw.prepare("SELECT promoted_at FROM memory_layers WHERE id = ?").get("ts-test") as {
      promoted_at: string;
    };
    expect(row.promoted_at).toBeTruthy();
  });
});
