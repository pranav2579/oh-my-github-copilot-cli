import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  initWorktreeTable,
  omcc_worktree_create,
  omcc_worktree_list,
  omcc_worktree_merge,
  omcc_worktree_cleanup,
} from "../src/worktree-manager.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omcc-wt-test-"));
  db = openDb(join(tmp, "db.sqlite"));
  initWorktreeTable(db);
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("omcc_worktree_create", () => {
  it("creates a worktree record and returns git commands", () => {
    const result = omcc_worktree_create(db, { branch_name: "fix-42" });
    expect(result.ok).toBe(true);

    const data = result.data as any;
    expect(data.id).toBe("wt-fix-42");
    expect(data.branch_name).toBe("fix-42");
    expect(data.base_branch).toBe("main");
    expect(data.worktree_path).toBe(".worktrees/fix-42");
    expect(data.status).toBe("active");
    expect(data.commands).toEqual([
      "git worktree add .worktrees/fix-42 -b fix-42 main",
    ]);
  });

  it("uses custom base_branch", () => {
    const result = omcc_worktree_create(db, {
      branch_name: "feat-x",
      base_branch: "develop",
    });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.base_branch).toBe("develop");
    expect(data.commands[0]).toContain("develop");
  });

  it("rejects duplicate active branch name", () => {
    omcc_worktree_create(db, { branch_name: "fix-42" });
    const dup = omcc_worktree_create(db, { branch_name: "fix-42" });
    expect(dup.ok).toBe(false);
    expect(dup.error).toContain("already exists");
  });

  it("requires branch_name", () => {
    const result = omcc_worktree_create(db, {} as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("branch_name required");
  });
});

describe("omcc_worktree_list", () => {
  it("returns all worktrees ordered by creation time", () => {
    omcc_worktree_create(db, { branch_name: "a" });
    omcc_worktree_create(db, { branch_name: "b" });

    const result = omcc_worktree_list(db, {});
    expect(result.ok).toBe(true);
    const rows = result.data as any[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.branch_name)).toContain("a");
    expect(rows.map((r: any) => r.branch_name)).toContain("b");
  });

  it("returns empty list when no worktrees exist", () => {
    const result = omcc_worktree_list(db, {});
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe("omcc_worktree_merge", () => {
  it("marks worktree as merged and returns merge commands", () => {
    omcc_worktree_create(db, { branch_name: "fix-42" });

    const result = omcc_worktree_merge(db, { branch_name: "fix-42" });
    expect(result.ok).toBe(true);

    const data = result.data as any;
    expect(data.status).toBe("merged");
    expect(data.target_branch).toBe("main");
    expect(data.commands).toEqual([
      "git checkout main",
      'git merge fix-42 --no-ff -m "merge: fix-42 into main"',
    ]);
  });

  it("uses custom target_branch", () => {
    omcc_worktree_create(db, { branch_name: "feat-x" });
    const result = omcc_worktree_merge(db, {
      branch_name: "feat-x",
      target_branch: "develop",
    });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.target_branch).toBe("develop");
    expect(data.commands[0]).toBe("git checkout develop");
  });

  it("rejects merge of non-existent branch", () => {
    const result = omcc_worktree_merge(db, { branch_name: "nope" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No worktree found");
  });

  it("rejects merge of already-merged branch", () => {
    omcc_worktree_create(db, { branch_name: "fix-42" });
    omcc_worktree_merge(db, { branch_name: "fix-42" });

    const again = omcc_worktree_merge(db, { branch_name: "fix-42" });
    expect(again.ok).toBe(false);
    expect(again.error).toContain("not active");
  });

  it("requires branch_name", () => {
    const result = omcc_worktree_merge(db, {} as any);
    expect(result.ok).toBe(false);
  });
});

describe("omcc_worktree_cleanup", () => {
  it("marks active worktree as abandoned and returns cleanup commands", () => {
    omcc_worktree_create(db, { branch_name: "fix-42" });

    const result = omcc_worktree_cleanup(db, { branch_name: "fix-42" });
    expect(result.ok).toBe(true);

    const data = result.data as any;
    expect(data.status).toBe("abandoned");
    expect(data.commands).toEqual([
      "git worktree remove .worktrees/fix-42 --force",
      "git worktree prune",
      "git branch -D fix-42",
    ]);
  });

  it("preserves merged status on cleanup", () => {
    omcc_worktree_create(db, { branch_name: "fix-42" });
    omcc_worktree_merge(db, { branch_name: "fix-42" });

    const result = omcc_worktree_cleanup(db, { branch_name: "fix-42" });
    expect(result.ok).toBe(true);
    expect((result.data as any).status).toBe("merged");
  });

  it("rejects cleanup of non-existent branch", () => {
    const result = omcc_worktree_cleanup(db, { branch_name: "nope" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No worktree found");
  });

  it("requires branch_name", () => {
    const result = omcc_worktree_cleanup(db, {} as any);
    expect(result.ok).toBe(false);
  });
});

describe("status transitions", () => {
  it("active -> merged -> cleanup preserves merged", () => {
    omcc_worktree_create(db, { branch_name: "flow" });

    // Verify active
    let list = omcc_worktree_list(db, {}).data as any[];
    expect(list[0].status).toBe("active");

    // Merge
    omcc_worktree_merge(db, { branch_name: "flow" });
    list = omcc_worktree_list(db, {}).data as any[];
    expect(list[0].status).toBe("merged");
    expect(list[0].merged_at).toBeTruthy();

    // Cleanup preserves merged status
    omcc_worktree_cleanup(db, { branch_name: "flow" });
    list = omcc_worktree_list(db, {}).data as any[];
    expect(list[0].status).toBe("merged");
  });

  it("active -> abandoned via cleanup", () => {
    omcc_worktree_create(db, { branch_name: "wip" });
    omcc_worktree_cleanup(db, { branch_name: "wip" });

    const list = omcc_worktree_list(db, {}).data as any[];
    expect(list[0].status).toBe("abandoned");
  });

  it("allows re-creating a worktree after it was abandoned", () => {
    omcc_worktree_create(db, { branch_name: "retry" });
    omcc_worktree_cleanup(db, { branch_name: "retry" });

    // Old record is abandoned; creating again should succeed (old row is replaced)
    const result = omcc_worktree_create(db, { branch_name: "retry" });
    expect(result.ok).toBe(true);
    expect((result.data as any).status).toBe("active");
  });
});
