import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  omcc_state_get, omcc_state_set, omcc_state_delete,
  omcc_prd_set, omcc_prd_get,
  omcc_story_add, omcc_story_update, omcc_story_list,
  omcc_phase_get, omcc_phase_set,
  omcc_memory_remember, omcc_memory_recall, omcc_memory_search,
  omcc_route_model,
} from "../src/tools.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

function cleanup() {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}

describe("state", () => {
  it("set/get/delete round-trip", () => {
    expect(omcc_state_get(db, { key: "k" }).data).toBeNull();
    expect(omcc_state_set(db, { key: "k", value: "v" }).ok).toBe(true);
    expect(omcc_state_get(db, { key: "k" }).data).toBe("v");
    expect(omcc_state_delete(db, { key: "k" }).data).toEqual({ deleted: 1 });
    expect(omcc_state_get(db, { key: "k" }).data).toBeNull();
    cleanup();
  });

  it("requires key", () => {
    expect(omcc_state_get(db, {} as any).ok).toBe(false);
    expect(omcc_state_set(db, { key: "", value: "v" } as any).ok).toBe(false);
    cleanup();
  });

  it("rejects non-string value", () => {
    expect(omcc_state_set(db, { key: "k", value: 123 as any }).ok).toBe(false);
    cleanup();
  });
});

describe("prd + stories", () => {
  it("set prd, add stories, list, update status", () => {
    omcc_prd_set(db, { id: "prd-1", content: "build auth", status: "draft" });
    const p = omcc_prd_get(db, { id: "prd-1" }).data as any;
    expect(p.id).toBe("prd-1");
    expect(p.status).toBe("draft");

    omcc_story_add(db, { prd_id: "prd-1", id: "s1", title: "login" });
    omcc_story_add(db, { prd_id: "prd-1", id: "s2", title: "logout" });
    const list = omcc_story_list(db, { prd_id: "prd-1" }).data as any[];
    expect(list).toHaveLength(2);
    expect(list[0].status).toBe("pending");

    omcc_story_update(db, { prd_id: "prd-1", id: "s1", status: "done", evidence: "PR #42" });
    const updated = omcc_story_list(db, { prd_id: "prd-1" }).data as any[];
    const s1 = updated.find((s: any) => s.id === "s1");
    expect(s1.status).toBe("done");
    expect(s1.evidence).toBe("PR #42");
    cleanup();
  });

  it("story_update with no fields is rejected", () => {
    omcc_prd_set(db, { id: "p", content: "x" });
    omcc_story_add(db, { prd_id: "p", id: "s", title: "t" });
    expect(omcc_story_update(db, { prd_id: "p", id: "s" }).ok).toBe(false);
    cleanup();
  });
});

describe("workflow phase", () => {
  it("default scope when omitted", () => {
    omcc_phase_set(db, { phase: "spec" });
    const p = omcc_phase_get(db, {}).data as any;
    expect(p.phase).toBe("spec");
    cleanup();
  });

  it("multiple scopes", () => {
    omcc_phase_set(db, { scope: "main", phase: "tdd" });
    omcc_phase_set(db, { scope: "exp", phase: "spec" });
    expect((omcc_phase_get(db, { scope: "main" }).data as any).phase).toBe("tdd");
    expect((omcc_phase_get(db, { scope: "exp" }).data as any).phase).toBe("spec");
    cleanup();
  });
});

describe("memory", () => {
  it("remember/recall and search", () => {
    omcc_memory_remember(db, { key: "auth-pattern", value: "JWT with refresh tokens", tags: "auth,jwt" });
    omcc_memory_remember(db, { key: "css-pref", value: "Tailwind utility-first", tags: "frontend" });
    expect((omcc_memory_recall(db, { key: "auth-pattern" }).data as any).value).toBe(
      "JWT with refresh tokens"
    );
    const results = omcc_memory_search(db, { q: "JWT" }).data as any[];
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("auth-pattern");
    cleanup();
  });
});

describe("model routing", () => {
  it.each([
    ["design a new architecture for the API", "claude-opus-4.7"],
    ["refactor this function into smaller pieces", "claude-sonnet-4.6"],
    ["implement the login endpoint", "gpt-5.3-codex"],
    ["write a unit test for parseUser", "claude-sonnet-4.6"],
    ["a quick one-liner formatting change", "claude-haiku-4.5"],
    ["explore the codebase to find auth code", "claude-haiku-4.5"],
    ["something completely unrelated", "claude-sonnet-4.6"],
  ])("%s → %s", (task, expected) => {
    const r = omcc_route_model(db, { task }).data as any;
    expect(r.model).toBe(expected);
    cleanup();
  });
});
