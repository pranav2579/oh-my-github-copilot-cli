---
applyTo: "**"
---

# OMCC — Copilot CLI instructions

You are working in a repository that has the **oh-my-copilot-cli** payload installed. This means a curated set of custom agents, skills, hook extensions, and an MCP server (`omcc-mcp`) are available to you.

## Available custom agents

Specialist agents in `.github/agents/*.agent.md`. Invoke via the `task` tool with the appropriate `agent_type`, or via `--agent <name>` when launching a Copilot CLI session in headless mode.

Highlights:

- **planner / planner-omc** — write SPEC.md and PLAN.md before any code.
- **critic** — adversarial review of plans, designs, and diffs.
- **architect** — strategic architecture and debugging guidance (read-only).
- **executor / implementer** — make precise, scoped code edits per PLAN.md.
- **tester / test-engineer / qa-tester** — write failing tests first.
- **verifier / done-checker** — Definition-of-Done gate; refuses to ship if anything is red.
- **security-reviewer** — secrets, injection, authn/authz, supply-chain.
- **code-reviewer / code-simplifier** — diff review, complexity reduction.
- **debugger / tracer** — root-cause analysis with logs and instrumentation.
- **explore** — read-only codebase reconnaissance.
- **document-specialist** — external docs and API reference research.

See `docs/REFERENCE.md` for the full list with role descriptions.

## Reusable skills

Skills in `.github/skills/<name>/SKILL.md` are auto-invoked by Copilot CLI when their `description` matches the user's prompt. Notable ones:

- **autopilot** — full autonomous lifecycle: requirements → design → plan → implement → QA → verify.
- **workflow-spec / workflow-tdd / workflow-critique / workflow-verify** — phased TDD workflow with hard gates.
- **omcc-doctor / omcc-reference / omcc-setup / omcc-teams** — OMCC self-management.
- **debug / deep-dive / trace** — investigation flows.
- **release / ccg** — release engineering.
- **remember / learner / writer-memory** — persistent memory operations against `omcc-mcp`.

## Tool naming conventions

This repository uses **Copilot CLI tool names** (lowercase): `view`, `edit`, `create`, `grep`, `glob`, `bash`, `task`, `web_fetch`, `web_search`. Old Claude-Code-isms (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`, `Task`) in any prompt body are equivalent to their lowercase Copilot CLI counterparts.

## MCP tools

All tools provided by `omcc-mcp` are prefixed `omcc_` to avoid host collisions. The current surface (see `docs/REFERENCE.md` for the full schema):

- `omcc_state_get` / `omcc_state_set` / `omcc_state_delete` — key/value state.
- `omcc_prd_set` / `omcc_prd_get` — current PRD content.
- `omcc_story_add` / `omcc_story_update` / `omcc_story_list` — user stories with status and evidence.
- `omcc_phase_get` / `omcc_phase_set` — current workflow phase (`spec` / `plan` / `tdd` / `impl` / `verify`).
- `omcc_memory_remember` / `omcc_memory_recall` / `omcc_memory_search` — long-form memory.
- `omcc_route_model` — recommend a model for a task description.

## Operating rules

1. **Read before write.** View any file in this session before editing it.
2. **Cite path:line** when referencing existing code in plans or reviews.
3. **Tests are ground truth.** A change is not done until `npm test`, `npm run validate`, and `npm run build` exit 0 (or the equivalent commands for the host project).
4. **No TODOs in shipped code.** Grep for `TODO|FIXME|XXX` over changed files must be empty.
5. **Slash-command discipline.** Never name a skill or agent the same as a Copilot CLI built-in. The `npm run validate` check enforces this.
6. **MCP tool naming.** All `omcc-mcp` tools must be prefixed `omcc_`.
