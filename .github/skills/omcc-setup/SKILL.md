---
name: omcc-setup
description: Use first for install/update routing — sends setup, doctor, or MCP requests to the correct OMCC setup flow
---

# Setup

Use `/oh-my-copilot-cli:setup` as the unified setup/configuration entrypoint.

## Usage

```bash
/oh-my-copilot-cli:setup                # full setup wizard
/oh-my-copilot-cli:setup doctor         # installation diagnostics
/oh-my-copilot-cli:setup mcp            # MCP server configuration
/oh-my-copilot-cli:setup wizard --local # explicit wizard path
```

## Routing

Process the request by the **first argument only** so install/setup questions land on the right flow immediately:

- No argument, `wizard`, `local`, `global`, or `--force` -> route to `/oh-my-copilot-cli:omcc-setup` with the same remaining args
- `doctor` -> route to `/oh-my-copilot-cli:omcc-doctor` with everything after the `doctor` token
- `mcp` -> route to `/oh-my-copilot-cli:mcp-setup` with everything after the `mcp` token

Examples:

```bash
/oh-my-copilot-cli:setup --local          # => /oh-my-copilot-cli:omcc-setup --local
/oh-my-copilot-cli:setup doctor --json    # => /oh-my-copilot-cli:omcc-doctor --json
/oh-my-copilot-cli:setup mcp github       # => /oh-my-copilot-cli:mcp-setup github
```

## Notes

- `/oh-my-copilot-cli:omcc-setup`, `/oh-my-copilot-cli:omcc-doctor`, and `/oh-my-copilot-cli:mcp-setup` remain valid compatibility entrypoints.
- Prefer `/oh-my-copilot-cli:setup` in new documentation and user guidance.

Task: {{ARGUMENTS}}
