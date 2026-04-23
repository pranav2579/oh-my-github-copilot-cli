# AGENTS.md — oh-my-copilot-cli

This file provides cross-tool primary instructions for any AI agent working in this repository (Copilot CLI, Claude Code, Codex, Gemini, etc.).

## Project purpose

`oh-my-copilot-cli` (OMCC, binary `omcc`) ships a multi-agent orchestration payload — custom agents, skills, MCP server, and JS hook extensions — for the terminal-based GitHub Copilot CLI. Content is ported from [`Yeachan-Heo/oh-my-claudecode`](https://github.com/Yeachan-Heo/oh-my-claudecode) (MIT) and adapted to the Copilot CLI tool surface.

## Repository layout (target)

- `.github/agents/` — custom agents (`*.agent.md`)
- `.github/skills/<name>/SKILL.md` — auto-trigger skills
- `.github/extensions/<name>/extension.mjs` — JS SDK hook extensions
- `mcp-server/` — TypeScript MCP server providing the `omcc-mcp` tool surface (all tools prefixed `omcc_*`)
- `bridge/cli.cjs` — `omcc` CLI binary (commander)
- `scripts/` — build, validation, port-from-omc helpers
- `docs/` — reference, migration, architecture, attribution

## Operating rules for AI agents

1. **Read before write.** View any file in this session before editing it. Never edit from memory.
2. **Cite path:line** when referencing existing code in plans or reviews.
3. **Tests are ground truth.** A change is not done until `npm test`, `npm run validate`, and `npm run build` exit 0.
4. **No TODOs in shipped code.** Grep for `TODO|FIXME|XXX` over changed files must be empty.
5. **License/attribution discipline.** Any port from upstream MUST keep the upstream copyright notice and update `docs/ATTRIBUTION.md`.
6. **Slash-command discipline.** Never name a skill or agent the same as a Copilot CLI built-in (`plan`, `clear`, `help`, `status`, `setup`, `exit`, `quit`, `model`, `session`, `login`). Prefix all OMCC-original ones with `omcc-`.
7. **MCP tool naming.** Every tool exposed by `omcc-mcp` is prefixed `omcc_`. The `omcc doctor` command enforces uniqueness.

## Build, test, validate

```bash
npm install
npm run build      # build mcp-server
npm run validate   # parse all *.agent.md and SKILL.md, check frontmatter + slash-command collisions
npm test           # vitest suite
```

## License

MIT. See `LICENSE`.
