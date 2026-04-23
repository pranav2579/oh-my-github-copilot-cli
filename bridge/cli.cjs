#!/usr/bin/env node
// omcc — top-level CLI.

const { Command } = require("commander");
const path = require("node:path");
const pkg = require("../package.json");
const { init, doctor, MCP_SERVER_NAME, PKG_ROOT } = require("./installer.cjs");

const program = new Command();
program
  .name("omcc")
  .description("oh-my-copilot-cli — multi-agent toolkit for GitHub Copilot CLI")
  .version(pkg.version);

function fmtCounts(c) {
  return `copied=${c.copied} skipped=${c.skipped}`;
}

function runInit(opts) {
  const result = init({
    scope: opts.scope,
    target: opts.target,
    force: !!opts.force,
    dryRun: !!opts.dryRun,
  });
  console.log(`OMCC init (scope=${result.targets.scope})`);
  console.log(`  destRoot:   ${result.targets.destRoot}`);
  console.log(`  agents:     ${fmtCounts(result.payload.agents)}`);
  console.log(`  skills:     ${fmtCounts(result.payload.skills)}`);
  console.log(`  extensions: ${fmtCounts(result.payload.extensions)}`);
  console.log(`  instructions: ${fmtCounts(result.payload.instructions)}`);
  console.log(`  mcp-config: ${result.mcp.action} (${result.mcp.path})`);
  if (result.mcp.action === "skipped-existing") {
    console.log("  → '" + MCP_SERVER_NAME + "' already present in mcp-config.json. Pass --force to overwrite.");
  }
  if (opts.dryRun) console.log("(dry run — no files written)");
}

program
  .command("init")
  .description("Scaffold OMCC into a target repo or user scope")
  .option("--scope <scope>", "project|user", "project")
  .option("--target <path>", "project root (default: cwd)")
  .option("--force", "overwrite existing files / mcp-config entry")
  .option("--dry-run", "show what would happen without writing files")
  .action(runInit);

program
  .command("setup")
  .description("Alias of init")
  .option("--scope <scope>", "project|user", "project")
  .option("--target <path>", "project root (default: cwd)")
  .option("--force", "overwrite existing files / mcp-config entry")
  .option("--dry-run", "show what would happen without writing files")
  .action(runInit);

program
  .command("doctor")
  .description("Verify install: copilot CLI present, MCP server built, payload validates")
  .option("--scope <scope>", "project|user", "project")
  .option("--target <path>", "project root (default: cwd)")
  .action((opts) => {
    const r = doctor(opts);
    console.log(`OMCC doctor (scope=${r.scope})`);
    console.log(`  destRoot:   ${r.destRoot}`);
    console.log(`  mcpConfig:  ${r.mcpConfig}`);
    let allOk = true;
    for (const [k, v] of Object.entries(r.checks)) {
      const mark = v.ok ? "✅" : "❌";
      if (!v.ok) allOk = false;
      console.log(`  ${mark} ${k}: ${v.note}`);
    }
    if (!allOk) process.exit(1);
  });

program
  .command("upgrade")
  .description("Re-run init with --force on the current target (preserves user-edited files via filesystem mtime check)")
  .option("--scope <scope>", "project|user", "project")
  .option("--target <path>", "project root (default: cwd)")
  .action((opts) => {
    runInit({ ...opts, force: true });
  });

program
  .command("adopt <target>")
  .description("Bootstrap an existing repo by running init with sensible defaults")
  .option("--mode <mode>", "template|submodule (subtree NYI)", "template")
  .action((target, opts) => {
    if (opts.mode !== "template") {
      console.error(`omcc adopt: mode '${opts.mode}' is not yet supported in v0.1; use --mode template.`);
      process.exit(1);
    }
    runInit({ scope: "project", target: path.resolve(target) });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("omcc: " + (err?.stack ?? err));
  process.exit(1);
});
