# oh-my-github-copilot-cli (omcc)

> Multi-agent orchestration toolkit for [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) — a port of [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) to the terminal-based Copilot CLI.

**Status:** 🚧 Pre-release (v0.0.x). Not on npm yet.

## What you get

- **28 specialist custom agents** (planner, critic, tester, implementer, security-reviewer, …) installed under `.github/agents/`.
- **22 reusable skills** auto-triggered by user prompts (`workflow-tdd`, `security-scan`, `coding-standards`, …) installed under `.github/skills/`.
- **MCP server** (`omcc-mcp`) for shared state across agent dispatches (PRD/stories, workflow phase, memory, model routing).
- **JS hook extensions** — guardrails (block `rm -rf /`, secret commits), skill autoinjection, statusline.
- **`omcc` CLI** — `init`, `setup`, `doctor`, `upgrade`, `adopt`.

## Quick start

```bash
npm install -g oh-my-github-copilot-cli   # not yet published
cd your-project
omcc init                          # scaffold .github/{agents,skills,extensions}/ + mcp-config
copilot                            # your agents and skills are now available
```

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
