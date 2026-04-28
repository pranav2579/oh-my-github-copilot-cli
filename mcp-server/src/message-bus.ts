// mcp-server/src/message-bus.ts
// Inter-agent messaging and file locking primitives.

import type { OmccDb } from "./db.js";
import type { ToolResult } from "./tools.js";
import { randomUUID } from "node:crypto";

function ok(data?: unknown): ToolResult {
  return { ok: true, data };
}
function err(error: string): ToolResult {
  return { ok: false, error };
}

export function omcc_msg_send(
  db: OmccDb,
  args: { from: string; to?: string; content: string; channel?: string; priority?: number }
): ToolResult {
  if (!args?.from || !args?.content) return err("from and content required");
  const id = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO messages (id, sender, recipient, content, channel, priority) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, args.from, args.to ?? null, args.content, args.channel ?? "default", args.priority ?? 0);
  return ok({ id });
}

export function omcc_msg_receive(
  db: OmccDb,
  args: { agent: string; channel?: string }
): ToolResult {
  if (!args?.agent) return err("agent required");
  const where = args.channel
    ? "WHERE (recipient = ? OR recipient IS NULL) AND channel = ? AND acknowledged = 0"
    : "WHERE (recipient = ? OR recipient IS NULL) AND acknowledged = 0";
  const params = args.channel ? [args.agent, args.channel] : [args.agent];
  const rows = db.raw
    .prepare(`SELECT id, sender, content, channel, priority, created_at FROM messages ${where} ORDER BY priority DESC, created_at ASC`)
    .all(...params);
  return ok(rows);
}

export function omcc_msg_acknowledge(
  db: OmccDb,
  args: { message_id: string }
): ToolResult {
  if (!args?.message_id) return err("message_id required");
  const r = db.raw.prepare("UPDATE messages SET acknowledged = 1 WHERE id = ?").run(args.message_id);
  return ok({ acknowledged: Number(r.changes) });
}

export function omcc_msg_broadcast(
  db: OmccDb,
  args: { from: string; content: string; channel?: string }
): ToolResult {
  if (!args?.from || !args?.content) return err("from and content required");
  const id = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO messages (id, sender, recipient, content, channel, priority) VALUES (?, ?, NULL, ?, ?, 0)"
    )
    .run(id, args.from, args.content, args.channel ?? "broadcast");
  return ok({ id });
}

export function omcc_lock_acquire(
  db: OmccDb,
  args: { file_path: string; owner: string; ttl_seconds?: number }
): ToolResult {
  if (!args?.file_path || !args?.owner) return err("file_path and owner required");
  const ttl = args.ttl_seconds ?? 300;
  const existing = db.raw
    .prepare("SELECT owner, expires_at FROM file_locks WHERE file_path = ? AND expires_at > datetime('now')")
    .get(args.file_path) as { owner: string; expires_at: string } | undefined;
  if (existing) {
    if (existing.owner === args.owner) {
      db.raw
        .prepare("UPDATE file_locks SET expires_at = datetime('now', '+' || ? || ' seconds') WHERE file_path = ?")
        .run(ttl, args.file_path);
      return ok({ acquired: true, renewed: true });
    }
    return ok({ acquired: false, held_by: existing.owner, expires_at: existing.expires_at });
  }
  db.raw
    .prepare(
      "INSERT OR REPLACE INTO file_locks (file_path, owner, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' seconds'))"
    )
    .run(args.file_path, args.owner, ttl);
  return ok({ acquired: true });
}

export function omcc_lock_release(
  db: OmccDb,
  args: { file_path: string; owner: string }
): ToolResult {
  if (!args?.file_path || !args?.owner) return err("file_path and owner required");
  const r = db.raw
    .prepare("DELETE FROM file_locks WHERE file_path = ? AND owner = ?")
    .run(args.file_path, args.owner);
  return ok({ released: Number(r.changes) > 0 });
}

export function omcc_lock_check(
  db: OmccDb,
  args: { file_path: string }
): ToolResult {
  if (!args?.file_path) return err("file_path required");
  const row = db.raw
    .prepare("SELECT owner, expires_at FROM file_locks WHERE file_path = ? AND expires_at > datetime('now')")
    .get(args.file_path);
  return ok(row ?? { locked: false });
}
