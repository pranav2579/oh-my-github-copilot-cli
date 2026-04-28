// mcp-server/src/worktree-manager.ts
// Side-effect-free worktree lifecycle tools. Records state in SQLite and returns
// git commands for the calling agent to execute. No actual git operations here.

import type { OmccDb } from "./db.js";
import type { ToolResult } from "./tools.js";

function ok(data?: unknown): ToolResult {
  return { ok: true, data };
}
function err(error: string): ToolResult {
  return { ok: false, error };
}

/** Ensure the worktrees table exists. Called once at DB init. */
export function initWorktreeTable(db: OmccDb): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id             TEXT PRIMARY KEY,
      branch_name    TEXT NOT NULL UNIQUE,
      base_branch    TEXT NOT NULL DEFAULT 'main',
      worktree_path  TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'active',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      merged_at      TEXT
    );
  `);
}

// --- omcc_worktree_create ---

export function omcc_worktree_create(
  db: OmccDb,
  args: { branch_name: string; base_branch?: string },
): ToolResult {
  if (!args?.branch_name) return err("branch_name required");

  const branch = args.branch_name;
  const base = args.base_branch ?? "main";
  const worktreePath = `.worktrees/${branch}`;
  const id = `wt-${branch}`;

  // Reject duplicate active worktrees
  const existing = db.raw
    .prepare("SELECT id, status FROM worktrees WHERE branch_name = ?")
    .get(branch) as { id: string; status: string } | undefined;

  if (existing && existing.status === "active") {
    return err(`Worktree for branch '${branch}' already exists (status: active)`);
  }

  // Remove stale record if branch was previously merged/abandoned
  if (existing) {
    db.raw.prepare("DELETE FROM worktrees WHERE id = ?").run(existing.id);
  }

  db.raw
    .prepare(
      "INSERT INTO worktrees (id, branch_name, base_branch, worktree_path, status) VALUES (?, ?, ?, ?, 'active')",
    )
    .run(id, branch, base, worktreePath);

  return ok({
    id,
    branch_name: branch,
    base_branch: base,
    worktree_path: worktreePath,
    status: "active",
    commands: [
      `git worktree add ${worktreePath} -b ${branch} ${base}`,
    ],
  });
}

// --- omcc_worktree_list ---

export function omcc_worktree_list(
  db: OmccDb,
  _args: Record<string, unknown>,
): ToolResult {
  const rows = db.raw
    .prepare(
      "SELECT id, branch_name, base_branch, worktree_path, status, created_at, merged_at FROM worktrees ORDER BY created_at DESC",
    )
    .all();
  return ok(rows);
}

// --- omcc_worktree_merge ---

export function omcc_worktree_merge(
  db: OmccDb,
  args: { branch_name: string; target_branch?: string },
): ToolResult {
  if (!args?.branch_name) return err("branch_name required");

  const branch = args.branch_name;
  const target = args.target_branch ?? "main";

  const row = db.raw
    .prepare("SELECT id, status, worktree_path FROM worktrees WHERE branch_name = ?")
    .get(branch) as { id: string; status: string; worktree_path: string } | undefined;

  if (!row) return err(`No worktree found for branch '${branch}'`);
  if (row.status !== "active") return err(`Worktree '${branch}' is not active (status: ${row.status})`);

  db.raw
    .prepare("UPDATE worktrees SET status = 'merged', merged_at = datetime('now') WHERE id = ?")
    .run(row.id);

  return ok({
    id: row.id,
    branch_name: branch,
    target_branch: target,
    status: "merged",
    commands: [
      `git checkout ${target}`,
      `git merge ${branch} --no-ff -m "merge: ${branch} into ${target}"`,
    ],
  });
}

// --- omcc_worktree_cleanup ---

export function omcc_worktree_cleanup(
  db: OmccDb,
  args: { branch_name: string },
): ToolResult {
  if (!args?.branch_name) return err("branch_name required");

  const branch = args.branch_name;

  const row = db.raw
    .prepare("SELECT id, status, worktree_path FROM worktrees WHERE branch_name = ?")
    .get(branch) as { id: string; status: string; worktree_path: string } | undefined;

  if (!row) return err(`No worktree found for branch '${branch}'`);

  const wasActive = row.status === "active";

  // Mark as abandoned if it was still active; leave merged status alone
  if (wasActive) {
    db.raw.prepare("UPDATE worktrees SET status = 'abandoned' WHERE id = ?").run(row.id);
  }

  return ok({
    id: row.id,
    branch_name: branch,
    status: wasActive ? "abandoned" : row.status,
    commands: [
      `git worktree remove ${row.worktree_path} --force`,
      `git worktree prune`,
      `git branch -D ${branch}`,
    ],
  });
}
