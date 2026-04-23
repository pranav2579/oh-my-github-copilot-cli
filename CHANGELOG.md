# Changelog

All notable changes to `oh-my-github-copilot-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — first usable release

### Added

- **Ported payload from oh-my-claudecode@0ac52cda** (MIT): 19 agents + 38 skills, branding-rewritten and adapted to the Copilot CLI tool surface (`view`/`edit`/`grep`/`glob`/`bash`/`task`).
- **MCP server** (`omcc-mcp`) with 14 tools (`omcc_state_*`, `omcc_prd_*`, `omcc_story_*`, `omcc_phase_*`, `omcc_memory_*`, `omcc_route_model`) backed by Node 22's built-in `node:sqlite` (no native deps).
- **Three SDK extensions** under `.github/extensions/`:
  - `omcc-guardrails` — denies destructive bash, secret-bearing writes, force-pushes to protected branches, and commits with detected secrets.
  - `omcc-autoinject-skills` — best-match skill body injected as additional context on user prompt.
  - `omcc-statusline` — passive writer of `~/.omcc/statusline.json`.
- **`omcc` CLI binary** with `init` / `setup` / `doctor` / `upgrade` / `adopt` subcommands. Idempotent file copy + JSONC-aware `mcp-config.json` merge that only ever touches the `omcc-mcp` entry.
- **Frontmatter validator** (`scripts/validate-frontmatter.mjs`) that enforces filename↔name match, name uniqueness, and slash-command non-collision.
- **CI matrix** (`.github/workflows/ci.yml`): macOS, Ubuntu, Windows × Node 22; runs build, validate, MCP tests, root tests, and `npm pack --dry-run`.
- **Test suite**: 65 vitest tests (15 MCP server + 41 guardrail + 9 installer), all green.

## [0.0.1] — initial bootstrap

Local-only tag. Not published.
