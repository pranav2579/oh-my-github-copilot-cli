# Contributing to oh-my-github-copilot-cli

Thank you for considering a contribution!

## Quick start

1. Fork and clone the repo.
2. `npm install`
3. Make your changes.
4. `npm run validate && npm test && npm run build` — all must pass.
5. Open a PR against `main`.

## What we're looking for

- New custom agents or skills (with frontmatter, examples, and tests).
- MCP tool improvements (kept under the `omcc_*` prefix).
- Hook extension enhancements (must respect Copilot CLI's permission model).
- Documentation, especially for the slash-command collision matrix and migration guides.

## Coding standards

See [`AGENTS.md`](./AGENTS.md) for the operating rules every AI agent (and human contributor) follows when working in this repo.

- Read before you write. Cite `path:line` when referring to existing code.
- Tests are ground truth. No "done" without green test output.
- No `TODO|FIXME|XXX` in shipped code.
- Slash-command and MCP tool names must not collide with Copilot CLI built-ins. The `npm run validate` check enforces this.

## License

By contributing you agree your contributions are licensed under MIT (see [`LICENSE`](./LICENSE)).

## Attribution

If your change ports or adapts content from another project, update [`docs/ATTRIBUTION.md`](./docs/ATTRIBUTION.md) and ensure the upstream license is preserved in [`licenses/`](./licenses/).
