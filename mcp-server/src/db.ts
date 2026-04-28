// mcp-server/src/db.ts
// Thin wrapper over Node 22's built-in node:sqlite. Provides the OMCC schema.

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Load node:sqlite via createRequire so vite/vitest transformers don't mangle
// the bare specifier — they tend to strip the `node:` prefix.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export interface OmccDb {
  raw: InstanceType<typeof DatabaseSync>;
  close(): void;
}

export function openDb(path: string): OmccDb {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prd (
      id        TEXT PRIMARY KEY,
      content   TEXT NOT NULL,
      status    TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stories (
      prd_id    TEXT NOT NULL,
      id        TEXT NOT NULL,
      title     TEXT NOT NULL,
      status    TEXT NOT NULL DEFAULT 'pending',
      evidence  TEXT,
      PRIMARY KEY (prd_id, id),
      FOREIGN KEY (prd_id) REFERENCES prd(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_phase (
      scope TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory (
      key       TEXT PRIMARY KEY,
      value     TEXT NOT NULL,
      tags      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS failure_patterns (
      id          TEXT PRIMARY KEY,
      pattern     TEXT NOT NULL,
      prevention  TEXT NOT NULL,
      occurrences INTEGER NOT NULL DEFAULT 1,
      last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
      scope       TEXT NOT NULL DEFAULT 'project',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_layers (
      id          TEXT PRIMARY KEY,
      level       INTEGER NOT NULL DEFAULT 3,
      content     TEXT NOT NULL,
      confidence  REAL DEFAULT 0.5,
      category    TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      promoted_at TEXT,
      source      TEXT
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id        TEXT PRIMARY KEY,
      decision  TEXT NOT NULL,
      rationale TEXT NOT NULL,
      date      TEXT NOT NULL DEFAULT (datetime('now')),
      category  TEXT,
      status    TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS learned_patterns (
      id          TEXT PRIMARY KEY,
      pattern     TEXT NOT NULL,
      category    TEXT NOT NULL,
      confidence  REAL DEFAULT 0.3,
      source      TEXT,
      occurrences INTEGER DEFAULT 1,
      last_seen   TEXT DEFAULT (datetime('now')),
      promoted_to TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      sender      TEXT NOT NULL,
      recipient   TEXT,
      content     TEXT NOT NULL,
      channel     TEXT NOT NULL DEFAULT 'default',
      priority    INTEGER DEFAULT 0,
      acknowledged INTEGER DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS file_locks (
      file_path   TEXT PRIMARY KEY,
      owner       TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );
  `);
  return {
    raw: db,
    close() {
      db.close();
    },
  };
}
