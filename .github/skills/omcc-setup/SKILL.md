---
name: omcc-setup
description: Use first for install/update routing — sends setup, doctor, or MCP requests to the correct OMCC setup flow
---

# Setup

Use `/oh-my-github-copilot-cli:setup` as the unified setup/configuration entrypoint.

## Usage

```bash
/oh-my-github-copilot-cli:setup                # full setup wizard
/oh-my-github-copilot-cli:setup doctor         # installation diagnostics
/oh-my-github-copilot-cli:setup mcp            # MCP server configuration
/oh-my-github-copilot-cli:setup wizard --local # explicit wizard path
```

## Routing

Process the request by the **first argument only** so install/setup questions land on the right flow immediately:

- No argument, `wizard`, `local`, `global`, or `--force` -> route to `/oh-my-github-copilot-cli:omcc-setup` with the same remaining args
- `doctor` -> route to `/oh-my-github-copilot-cli:omcc-doctor` with everything after the `doctor` token
- `mcp` -> route to `/oh-my-github-copilot-cli:mcp-setup` with everything after the `mcp` token

Examples:

```bash
/oh-my-github-copilot-cli:setup --local          # => /oh-my-github-copilot-cli:omcc-setup --local
/oh-my-github-copilot-cli:setup doctor --json    # => /oh-my-github-copilot-cli:omcc-doctor --json
/oh-my-github-copilot-cli:setup mcp github       # => /oh-my-github-copilot-cli:mcp-setup github
```

## Notes

- `/oh-my-github-copilot-cli:omcc-setup`, `/oh-my-github-copilot-cli:omcc-doctor`, and `/oh-my-github-copilot-cli:mcp-setup` remain valid compatibility entrypoints.
- Prefer `/oh-my-github-copilot-cli:setup` in new documentation and user guidance.

Task: {{ARGUMENTS}}
