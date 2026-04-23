# oh-my-github-copilot-cli

> **Multi-agent orchestration for GitHub Copilot CLI.** Drop a curated payload of specialist agents, auto-triggered skills, an MCP state server, and safety guardrails into any repo with a single command.

<p align="left">
  <a href="https://www.npmjs.com/package/oh-my-github-copilot-cli"><img src="https://img.shields.io/npm/v/oh-my-github-copilot-cli.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/oh-my-github-copilot-cli"><img src="https://img.shields.io/npm/dm/oh-my-github-copilot-cli.svg?color=blue" alt="npm downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg?logo=node.js&logoColor=white" alt="Node ≥ 22"></a>
  <a href="https://github.com/pranav2579/oh-my-github-copilot-cli/actions"><img src="https://img.shields.io/github/actions/workflow/status/pranav2579/oh-my-github-copilot-cli/ci.yml?branch=main&label=CI&logo=github" alt="CI"></a>
  <a href="https://github.com/pranav2579/oh-my-github-copilot-cli/stargazers"><img src="https://img.shields.io/github/stars/pranav2579/oh-my-github-copilot-cli?style=social" alt="GitHub stars"></a>
</p>

<p align="left">
  <img src="https://img.shields.io/badge/Agents-24-blueviolet" alt="24 Agents">
  <img src="https://img.shields.io/badge/Skills-42-orange" alt="42 Skills">
  <img src="https://img.shields.io/badge/MCP%20tools-14-0a66c2" alt="14 MCP tools">
  <img src="https://img.shields.io/badge/Hook%20extensions-3-6f42c1" alt="3 hook extensions">
  <img src="https://img.shields.io/badge/Works%20with-GitHub%20Copilot%20CLI-181717?logo=github" alt="Works with GitHub Copilot CLI">
</p>

[Quick start](#-quick-start) · [What's inside](#-whats-inside) · [Workflows](#-workflow-examples) · [Architecture](#-architecture) · [Verification](#-end-to-end-verification) · [Reference](./docs/REFERENCE.md) · [Changelog](./CHANGELOG.md)

---

## Why omcc?

GitHub Copilot CLI gives you one general-purpose model. **Real engineering work isn't general-purpose** — it's planning, then critique, then tests-first, then implementation, then verification. Each phase needs different prompts, different guardrails, and different shared state.

`omcc` ships a battle-tested multi-agent payload — ported from [`oh-my-claudecode`](https://github.com/Yeachan-Heo/oh-my-claudecode) (MIT) and rewritten for the Copilot CLI tool surface — so you get this structure for free in any repo, with one command:

```bash
npx oh-my-github-copilot-cli init
```

No build step. No native dependencies. No vendor lock-in — everything lands as plain markdown + a small Node MCP server inside your repo's `.github/`, fully diffable and editable.

---

## ✨ What's inside

| Capability | Count | Where it lands | What it does |
|---|---:|---|---|
| **🤖 Custom agents** | 24 | `.github/agents/*.agent.md` | Specialist roles — `planner`, `critic`, `tester`, `implementer`, `verifier`, `security-reviewer`, `architect`, `debugger`, `tracer`, `code-reviewer`, … Invoke with `task` or `--agent`. |
| **🪄 Auto-triggered skills** | 42 | `.github/skills/<name>/SKILL.md` | Workflow recipes auto-loaded by prompt match — `autopilot`, `workflow-spec` / `workflow-tdd` / `workflow-critique` / `workflow-verify`, `debug`, `release`, `deep-dive`, `trace`, `remember`, … |
| **🧠 MCP state server** (`omcc-mcp`) | 14 tools | bundled, registered in `~/.copilot/mcp-config.json` | Cross-agent shared state: PRD/stories, workflow phase, long-form memory, k/v scratch, model routing. Backed by Node 22's built-in `node:sqlite` — **zero native deps**. |
| **🛡️ SDK hook extensions** | 3 | `.github/extensions/*/extension.mjs` | `omcc-guardrails` (block `rm -rf /`, secret commits, force-push to protected branches), `omcc-autoinject-skills` (best-match skill body injected on user prompt), `omcc-statusline` (passive status writer). |
| **⚙️ `omcc` CLI** | 5 commands | `omcc` + `oh-my-github-copilot-cli` bins | `init` · `setup` · `doctor` · `upgrade` · `adopt`. JSONC-aware merge that only ever touches the `omcc-mcp` entry. |
| **🧪 Tests** | 50 | `tests/` (vitest) | Frontmatter validator, installer idempotency, guardrails, MCP server contracts. CI matrix: macOS + Ubuntu + Windows × Node 22. |

> **Highlighted skills:** `autopilot` (full SPEC → PLAN → CRITIQUE → TDD → IMPL → VERIFY in one go), `workflow-tdd` (refuses to start without SPEC.md + PLAN.md), `release` (cuts versioned releases per repo's rules), `ccg` (orchestrates Claude · Codex · Gemini in parallel via host CLIs).

---

## 🚀 Quick start

```bash
# 1. Install
npm install -g oh-my-github-copilot-cli

# 2. Scaffold into any repo
cd your-project
omcc init

# 3. Verify
omcc doctor

# 4. Use it
copilot                       # GitHub Copilot CLI
> /agents                     # 24 specialists are now listed
> autopilot: build a CLI that converts CSV → JSON
```

`omcc init` is **idempotent** and **non-destructive**: re-runs skip files that already exist (use `--force` to overwrite). The MCP server entry is merged into your existing `~/.copilot/mcp-config.json` without touching unrelated servers.

### Try without installing

```bash
npx oh-my-github-copilot-cli init
```

---

## 🛠️ `omcc` CLI

```text
omcc init        Scaffold .github/{agents,skills,extensions}/ + register MCP server
omcc setup       Alias of init
omcc doctor      Verify install: copilot CLI on PATH, MCP server boots,
                 frontmatter validates, MCP entry registered uniquely
omcc upgrade     Re-run init with --force, preserving user-edited files via mtime
omcc adopt <p>   Bootstrap an existing repo with sensible defaults

Common flags:
  --scope project|user   Target this repo (default) or ~/.copilot
  --target <path>        Project root (default: cwd)
  --force                Overwrite existing files / mcp-config entry
  --dry-run              Print what would happen without writing
```

---

## 🎬 Workflow examples

### One-shot autonomous build (`autopilot`)

```text
> autopilot: build a token-bucket rate limiter in src/lib/ratelimit.ts with tests
```

`autopilot` orchestrates: `planner` writes `SPEC.md` + `PLAN.md` → `critic` red-teams the plan → `tester` writes failing tests → `implementer` makes them pass → `verifier` runs lint/typecheck/tests/grep-TODO. Refuses to declare done if anything is red.

### Strict TDD (`workflow-tdd`)

```text
> workflow-tdd implement OAuth refresh token rotation
```

Hard-gates the phases: refuses to write implementation code until SPEC.md and PLAN.md exist; refuses to mark "done" until the `done-checker` agent shows raw-output green from your repo's lint/test commands.

### Adversarial review (`workflow-critique`)

```text
> critique my plan in PLAN.md
```

Invokes the `critic` sub-agent — concrete findings only (missing edge cases, wrong assumptions, perf cliffs, security holes). Cannot edit files.

### Cross-model second opinion (`ccg`)

```text
> ccg: should we use Postgres advisory locks or Redis SETNX for this?
```

Fans the question out to Claude, Codex, and Gemini via their host CLIs in parallel, then synthesizes their answers.

---

## 🏛️ Architecture

```
your-repo/
├── .github/
│   ├── agents/                    24 *.agent.md  ─┐
│   ├── skills/                    42 SKILL.md    ├─ Read by Copilot CLI
│   ├── extensions/                3 SDK hooks    ─┘  (auto-discovered)
│   └── copilot-instructions.md    Repo-wide AGENTS.md addendum
│
~/.copilot/
└── mcp-config.json                ← omcc-mcp entry merged in (jsonc-aware)
                                      command: node …/mcp-server/dist/index.js
                                      14 omcc_* tools, sqlite-backed state
```

**Tool surface (Copilot CLI native):** every agent and skill uses `view` / `edit` / `create` / `grep` / `glob` / `bash` / `task` — no Claude Code-isms, no cross-IDE shims. The frontmatter validator (`scripts/validate-frontmatter.mjs`) rejects naming collisions with Copilot CLI built-ins (`/plan`, `/clear`, `/help`, `/setup`, `/model`, …) at install time.

**Storage:** the MCP server uses the `node:sqlite` builtin (Node ≥ 22). Nothing native compiles, nothing downloads at install — the published tarball is ~230 KB.

---

## 🧪 End-to-end verification

Smoke-test a fresh install in an isolated prefix (no globals touched):

```bash
mkdir /tmp/omcc-e2e && cd /tmp/omcc-e2e
npm install --prefix . oh-my-github-copilot-cli@latest

# CLI bins are wired
./node_modules/.bin/omcc --version

# Doctor: 4 green checks
mkdir testproj && cd testproj && git init
../node_modules/.bin/omcc init
../node_modules/.bin/omcc doctor

# MCP server boots cleanly
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}' \
  | node ../node_modules/oh-my-github-copilot-cli/mcp-server/dist/index.js
```

`omcc doctor` confirms: ✅ Copilot CLI on PATH · ✅ MCP server boots without errors · ✅ all agent/skill frontmatter validates · ✅ MCP entry registered uniquely.

---

## 📦 Requirements

| | Min | Notes |
|---|---|---|
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) | `1.0.34` | `copilot --version` |
| Node.js | `22.0.0` | Uses built-in `node:sqlite` — no native deps |
| OS | macOS · Linux · Windows | CI runs all three on every commit |

---

## 📚 Documentation

- [`docs/REFERENCE.md`](./docs/REFERENCE.md) — every agent, skill, and MCP tool with its trigger surface; slash-command collision matrix.
- [`docs/ATTRIBUTION.md`](./docs/ATTRIBUTION.md) — per-file provenance and upstream commit pin.
- [`CHANGELOG.md`](./CHANGELOG.md) — versioned release notes.
- [`AGENTS.md`](./AGENTS.md) — cross-tool ground rules for any agent (Copilot, Claude Code, Codex, Gemini, …) working in this repo.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to add an agent or skill, the validator's expectations, and CI gates.

---

## 🤝 Contributing

PRs welcome. Local dev loop:

```bash
git clone https://github.com/pranav2579/oh-my-github-copilot-cli
cd oh-my-github-copilot-cli
npm install
npm run build       # compile mcp-server
npm run validate    # frontmatter + slash-command collision check
npm test            # vitest
```

Required for any agent/skill PR: filename matches `name:` in frontmatter, name is unique, slash-name doesn't collide with a Copilot CLI built-in. The validator enforces all three; CI blocks merges that fail.

---

## 🪪 License & attribution

MIT — see [`LICENSE`](./LICENSE).

This project ports content from [`Yeachan-Heo/oh-my-claudecode`](https://github.com/Yeachan-Heo/oh-my-claudecode) (MIT, commit pinned in `docs/ATTRIBUTION.md`) and is design-inspired by [`jmstar85/oh-my-githubcopilot`](https://github.com/jmstar85/oh-my-githubcopilot). Upstream copyright notices are preserved in [`LICENSE-THIRD-PARTY.md`](./LICENSE-THIRD-PARTY.md) and [`licenses/`](./licenses/).

---

<p align="left">
  Built with ❤️ for the GitHub Copilot CLI community by <a href="https://github.com/pranav2579">@pranav2579</a>.
  <br>
  If <code>omcc</code> saves you time, please ⭐ the <a href="https://github.com/pranav2579/oh-my-github-copilot-cli">repo</a>.
</p>
