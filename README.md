# oh-my-github-copilot-cli (omcc)

> Multi-agent orchestration toolkit for [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) — a port of [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) to the terminal-based Copilot CLI.

[![npm version](https://img.shields.io/npm/v/oh-my-github-copilot-cli.svg)](https://www.npmjs.com/package/oh-my-github-copilot-cli)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node ≥ 22](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org/)

**Status:** ✅ Published — `oh-my-github-copilot-cli@0.1.1` on [npm](https://www.npmjs.com/package/oh-my-github-copilot-cli).

## What you get

- **24 specialist custom agents** (planner, critic, tester, implementer, security-reviewer, …) installed under `.github/agents/`.
- **42 reusable skills** auto-triggered by user prompts (`workflow-tdd`, `autopilot`, `debug`, `release`, …) installed under `.github/skills/`.
- **MCP server** (`omcc-mcp`, 14 `omcc_*` tools) for shared state across agent dispatches — PRD/stories, workflow phase, memory, model routing. Uses Node 22's built-in `node:sqlite`, zero native deps.
- **3 SDK hook extensions** — guardrails (block `rm -rf /`, secret commits), skill autoinjection, statusline.
- **`omcc` CLI** — `init`, `setup`, `doctor`, `upgrade`, `adopt`.

## Quick start

```bash
npm install -g oh-my-github-copilot-cli
cd your-project
omcc init        # scaffold .github/{agents,skills,extensions}/ + mcp-config
omcc doctor      # verify copilot, MCP server boots, payload validates
copilot          # your agents and skills are now available
```

## Verify end-to-end

To smoke-test a fresh install without touching globals:

```bash
mkdir /tmp/omcc-e2e && cd /tmp/omcc-e2e
npm install --prefix . oh-my-github-copilot-cli@latest
./node_modules/.bin/omcc --version
mkdir testproj && cd testproj && git init
../node_modules/.bin/omcc init
../node_modules/.bin/omcc doctor          # all 4 checks should be green
# Boot the MCP server directly:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}' \
  | node ../node_modules/oh-my-github-copilot-cli/mcp-server/dist/index.js
```

`omcc doctor` will confirm: Copilot CLI on PATH, MCP server boots without errors, payload frontmatter validates, and the MCP entry is registered uniquely in your `~/.copilot/mcp-config.json`.

## Requirements

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) ≥ 1.0.34
- Node.js ≥ 22 (uses built-in `node:sqlite` — no native dependencies)
- macOS, Linux, or Windows

## Documentation

See [`docs/`](./docs/):

- [`REFERENCE.md`](./docs/REFERENCE.md) — every agent, skill, MCP tool, and the slash-command collision matrix.
- [`MIGRATION.md`](./docs/MIGRATION.md) — for users coming from `oh-my-claudecode` or `oh-my-githubcopilot`.
- [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — design overview.
- [`ATTRIBUTION.md`](./docs/ATTRIBUTION.md) — per-file provenance.

## License

MIT — see [LICENSE](./LICENSE).

This project ports content from [`Yeachan-Heo/oh-my-claudecode`](https://github.com/Yeachan-Heo/oh-my-claudecode) (MIT) and is design-inspired by [`jmstar85/oh-my-githubcopilot`](https://github.com/jmstar85/oh-my-githubcopilot). See [`LICENSE-THIRD-PARTY.md`](./LICENSE-THIRD-PARTY.md) and [`licenses/`](./licenses/) for full upstream attribution.
