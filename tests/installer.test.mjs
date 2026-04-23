import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const installer = require("../bridge/installer.cjs");

let tmp;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "omcc-installer-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("resolveTargets", () => {
  it("project scope resolves to <target>/.github", () => {
    const t = installer.resolveTargets({ scope: "project", target: tmp });
    expect(t.payloadDest.agents).toBe(join(tmp, ".github", "agents"));
    expect(t.payloadDest.skills).toBe(join(tmp, ".github", "skills"));
    expect(t.payloadDest.extensions).toBe(join(tmp, ".github", "extensions"));
  });
  it("user scope resolves to ~/.copilot", () => {
    const t = installer.resolveTargets({ scope: "user" });
    // Use path.sep-tolerant regex so Windows backslash paths also match.
    expect(t.payloadDest.agents).toMatch(/[\\/]\.copilot[\\/]agents$/);
  });
});

describe("init", () => {
  it("copies all four payload directories and is idempotent", () => {
    const mcpPath = join(tmp, "mcp-config.json");
    // Use a fake mcp-config path by setting target only and mocking via copy, not by hijacking ~/.copilot.
    // Patch resolveTargets indirectly by calling mergeMcpConfig with our own path.
    const r1 = installer.copyPayload(installer.resolveTargets({ target: tmp }), {});
    expect(r1.agents.copied).toBeGreaterThan(0);
    expect(r1.skills.copied).toBeGreaterThan(0);
    expect(r1.extensions.copied).toBeGreaterThan(0);
    expect(r1.instructions.copied).toBe(1);

    // Re-run: everything should be skipped (idempotent).
    const r2 = installer.copyPayload(installer.resolveTargets({ target: tmp }), {});
    expect(r2.agents.copied).toBe(0);
    expect(r2.skills.copied).toBe(0);
    expect(r2.extensions.copied).toBe(0);
    expect(r2.instructions.copied).toBe(0);
  });

  it("dry-run does not write files", () => {
    installer.copyPayload(installer.resolveTargets({ target: tmp }), { dryRun: true });
    expect(existsSync(join(tmp, ".github", "agents"))).toBe(false);
  });
});

describe("mergeMcpConfig", () => {
  it("creates the file if missing and adds the omcc-mcp entry", () => {
    const mcpPath = join(tmp, "mcp-config.json");
    const r = installer.mergeMcpConfig(mcpPath);
    expect(r.action).toBe("added");
    const data = JSON.parse(readFileSync(mcpPath, "utf8"));
    expect(data.mcpServers["omcc-mcp"]).toBeDefined();
    expect(data.mcpServers["omcc-mcp"].command).toBe("node");
  });

  it("preserves existing servers when merging", () => {
    const mcpPath = join(tmp, "mcp-config.json");
    writeFileSync(mcpPath, JSON.stringify({
      mcpServers: { other: { command: "x", args: [], tools: ["*"] } },
    }, null, 2));
    installer.mergeMcpConfig(mcpPath);
    const data = JSON.parse(readFileSync(mcpPath, "utf8"));
    expect(data.mcpServers.other.command).toBe("x");
    expect(data.mcpServers["omcc-mcp"]).toBeDefined();
  });

  it("skip-if-present without --force", () => {
    const mcpPath = join(tmp, "mcp-config.json");
    writeFileSync(mcpPath, JSON.stringify({
      mcpServers: { "omcc-mcp": { command: "stale", args: [], tools: ["*"] } },
    }, null, 2));
    const r = installer.mergeMcpConfig(mcpPath);
    expect(r.action).toBe("skipped-existing");
    const data = JSON.parse(readFileSync(mcpPath, "utf8"));
    expect(data.mcpServers["omcc-mcp"].command).toBe("stale");
  });

  it("--force overwrites only the omcc-mcp entry", () => {
    const mcpPath = join(tmp, "mcp-config.json");
    writeFileSync(mcpPath, JSON.stringify({
      mcpServers: {
        "omcc-mcp": { command: "stale", args: [] },
        other:       { command: "keep",  args: [] },
      },
    }, null, 2));
    const r = installer.mergeMcpConfig(mcpPath, { force: true });
    expect(r.action).toBe("overwritten");
    const data = JSON.parse(readFileSync(mcpPath, "utf8"));
    expect(data.mcpServers["omcc-mcp"].command).toBe("node");
    expect(data.mcpServers.other.command).toBe("keep");
  });

  it("preserves JSONC comments via jsonc-parser", () => {
    const mcpPath = join(tmp, "mcp-config.json");
    writeFileSync(mcpPath, `// user config
{
  "mcpServers": {
    // important server
    "other": { "command": "x", "args": [] }
  }
}
`);
    installer.mergeMcpConfig(mcpPath);
    const text = readFileSync(mcpPath, "utf8");
    expect(text).toContain("// user config");
    expect(text).toContain("// important server");
    expect(text).toContain("omcc-mcp");
  });
});
