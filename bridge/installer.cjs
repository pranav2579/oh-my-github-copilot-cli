// omcc installer.
// - resolveTargets(scope, target): figure out where .github / mcp-config.json live
// - copyPayload(): copy agents/skills/extensions/copilot-instructions.md
// - mergeMcpConfig(): jsonc-aware merge of ~/.copilot/mcp-config.json
//
// Public API:
//   init({ scope, target, force, dryRun })
//   doctor({ target })

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const jsoncParser = require("jsonc-parser");

const PKG_ROOT = path.resolve(__dirname, "..");
const PAYLOAD_PATHS = [
  ".github/agents",
  ".github/skills",
  ".github/extensions",
  ".github/copilot-instructions.md",
];

const MCP_SERVER_NAME = "omcc-mcp";

function resolveTargets({ scope = "project", target } = {}) {
  if (scope === "user") {
    const home = os.homedir();
    return {
      scope,
      destRoot: path.join(home, ".copilot"),
      mcpConfig: path.join(home, ".copilot", "mcp-config.json"),
      payloadDest: {
        agents: path.join(home, ".copilot", "agents"),
        skills: path.join(home, ".copilot", "skills"),
        extensions: path.join(home, ".copilot", "extensions"),
        instructions: path.join(home, ".copilot", "copilot-instructions.md"),
      },
    };
  }
  const root = path.resolve(target ?? process.cwd());
  return {
    scope: "project",
    destRoot: root,
    mcpConfig: path.join(os.homedir(), ".copilot", "mcp-config.json"),
    payloadDest: {
      agents: path.join(root, ".github", "agents"),
      skills: path.join(root, ".github", "skills"),
      extensions: path.join(root, ".github", "extensions"),
      instructions: path.join(root, ".github", "copilot-instructions.md"),
    },
  };
}

function copyDir(src, dest, { force = false, dryRun = false } = {}) {
  const stats = { copied: 0, skipped: 0 };
  if (!fs.existsSync(src)) return stats;
  if (!fs.statSync(src).isDirectory()) return stats;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const sub = copyDir(s, d, { force, dryRun });
      stats.copied += sub.copied;
      stats.skipped += sub.skipped;
    } else {
      if (fs.existsSync(d) && !force) {
        // Skip identical
        try {
          const a = fs.readFileSync(s);
          const b = fs.readFileSync(d);
          if (a.equals(b)) { stats.skipped++; continue; }
        } catch { /* fall through */ }
        stats.skipped++;
        continue;
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
      stats.copied++;
    }
  }
  return stats;
}

function copyFile(src, dest, { force = false, dryRun = false } = {}) {
  if (!fs.existsSync(src)) return { copied: 0, skipped: 0 };
  if (fs.existsSync(dest) && !force) {
    try {
      const a = fs.readFileSync(src), b = fs.readFileSync(dest);
      if (a.equals(b)) return { copied: 0, skipped: 1 };
    } catch { /* fall through */ }
    return { copied: 0, skipped: 1 };
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return { copied: 1, skipped: 0 };
}

function copyPayload(targets, opts) {
  const r = {
    agents:       copyDir(path.join(PKG_ROOT, ".github/agents"),     targets.payloadDest.agents,     opts),
    skills:       copyDir(path.join(PKG_ROOT, ".github/skills"),     targets.payloadDest.skills,     opts),
    extensions:   copyDir(path.join(PKG_ROOT, ".github/extensions"), targets.payloadDest.extensions, opts),
    instructions: copyFile(path.join(PKG_ROOT, ".github/copilot-instructions.md"),
                           targets.payloadDest.instructions, opts),
  };
  return r;
}

function readJsonc(filePath) {
  if (!fs.existsSync(filePath)) return { data: { mcpServers: {} }, raw: "" };
  const raw = fs.readFileSync(filePath, "utf8");
  const errors = [];
  const data = jsoncParser.parse(raw, errors, { allowTrailingComma: true });
  if (errors.length) {
    throw new Error(`Failed to parse JSONC at ${filePath}: ${JSON.stringify(errors)}`);
  }
  return { data: data ?? {}, raw };
}

function mcpServerEntry() {
  // Use a path relative to the installed package so users don't have to know it.
  const dist = path.join(PKG_ROOT, "mcp-server", "dist", "index.js");
  return {
    type: "local",
    command: "node",
    args: [dist],
    tools: ["*"],
  };
}

function mergeMcpConfig(mcpConfigPath, { force = false, dryRun = false } = {}) {
  const { data, raw } = readJsonc(mcpConfigPath);
  const next = JSON.parse(JSON.stringify(data ?? {}));
  next.mcpServers = next.mcpServers ?? {};
  const existing = next.mcpServers[MCP_SERVER_NAME];
  let action = "added";
  if (existing) {
    if (!force) {
      return { action: "skipped-existing", path: mcpConfigPath };
    }
    action = "overwritten";
  }
  next.mcpServers[MCP_SERVER_NAME] = mcpServerEntry();

  // Only ever touch the omcc-mcp entry. Use jsonc-parser modify to preserve comments.
  let outText;
  if (raw && raw.trim().length > 0) {
    const edits = jsoncParser.modify(raw, ["mcpServers", MCP_SERVER_NAME], next.mcpServers[MCP_SERVER_NAME], {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    outText = jsoncParser.applyEdits(raw, edits);
  } else {
    outText = JSON.stringify(next, null, 2) + "\n";
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
    fs.writeFileSync(mcpConfigPath, outText);
  }
  return { action, path: mcpConfigPath };
}

function checkMcpToolUniqueness(mcpConfigPath) {
  // Best-effort: enumerate all servers and ensure no two declare a same tool name.
  // Today we can only check the omcc-mcp entry against itself, but at least we
  // surface whether the server entry exists.
  if (!fs.existsSync(mcpConfigPath)) return { ok: true, note: "no mcp-config.json" };
  const { data } = readJsonc(mcpConfigPath);
  const servers = data?.mcpServers ?? {};
  if (!servers[MCP_SERVER_NAME]) return { ok: false, note: "omcc-mcp missing from mcp-config.json" };
  return { ok: true, note: `${Object.keys(servers).length} server(s) configured` };
}

function checkMcpBuilt() {
  const dist = path.join(PKG_ROOT, "mcp-server", "dist", "index.js");
  if (!fs.existsSync(dist)) return { ok: false, note: `missing ${dist}` };
  // Verify runtime SDK is resolvable from the package root (catches the
  // "shipped dist but forgot to hoist @modelcontextprotocol/sdk" footgun).
  try {
    require.resolve("@modelcontextprotocol/sdk/server/mcp.js", { paths: [PKG_ROOT] });
  } catch (e) {
    return { ok: false, note: `dist present but @modelcontextprotocol/sdk not resolvable from ${PKG_ROOT}` };
  }
  // Spawn the server with a 2s timeout to confirm it boots without throwing.
  const r = spawnSync(process.execPath, [dist], {
    encoding: "utf8",
    timeout: 2000,
    input: "",
  });
  if (r.error && r.error.code !== "ETIMEDOUT") {
    return { ok: false, note: `spawn failed: ${r.error.message}` };
  }
  if (r.status !== null && r.status !== 0) {
    return { ok: false, note: `mcp server exited ${r.status}: ${(r.stderr || "").split("\n")[0]}` };
  }
  return { ok: true, note: dist };
}

function checkCopilotCli() {
  const r = spawnSync("copilot", ["--version"], { encoding: "utf8" });
  if (r.error) return { ok: false, note: "copilot CLI not on PATH" };
  return { ok: true, note: r.stdout.trim() || r.stderr.trim() };
}

function checkValidator() {
  const r = spawnSync(process.execPath,
    [path.join(PKG_ROOT, "scripts", "validate-frontmatter.mjs")],
    { encoding: "utf8", cwd: PKG_ROOT });
  return { ok: r.status === 0, note: (r.stdout + r.stderr).split("\n").slice(-3).join(" ").trim() };
}

function init(opts = {}) {
  const targets = resolveTargets(opts);
  const payload = copyPayload(targets, opts);
  const mcp = mergeMcpConfig(targets.mcpConfig, opts);
  return { targets, payload, mcp };
}

function doctor(opts = {}) {
  const targets = resolveTargets(opts);
  return {
    scope: targets.scope,
    destRoot: targets.destRoot,
    mcpConfig: targets.mcpConfig,
    checks: {
      copilotCli:   checkCopilotCli(),
      mcpBuilt:     checkMcpBuilt(),
      validator:    checkValidator(),
      mcpRegistered: checkMcpToolUniqueness(targets.mcpConfig),
    },
  };
}

module.exports = {
  PKG_ROOT,
  MCP_SERVER_NAME,
  resolveTargets,
  copyPayload,
  mergeMcpConfig,
  init,
  doctor,
};
