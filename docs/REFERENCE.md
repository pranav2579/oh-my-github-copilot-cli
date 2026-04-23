# OMCC Reference

Generated for v0.1.0. For exhaustive frontmatter, read the agent / skill files directly under `.github/agents/` and `.github/skills/`.

## Custom agents (`.github/agents/*.agent.md`)

OMCC ships 24 custom agents (5 personal seeds + 19 ported from `oh-my-claudecode`).

| Agent | Source | Role |
|---|---|---|
| `planner` | seed | Writes SPEC.md and PLAN.md only. Cannot edit code. |
| `critic` | seed | Adversarial review of plans/specs/code. Cannot edit. |
| `tester` | seed | Writes failing tests first. Edits in `tests/` only. |
| `implementer` | seed | Edits files strictly per PLAN.md. |
| `done-checker` | seed | Walks DoD checklist; refuses to declare done if anything is red. |
| `analyst` | OMC | High-level requirements analysis. |
| `architect` | OMC | System / module design. |
| `code-reviewer` | OMC | Reviews diffs for correctness. |
| `code-simplifier` | OMC | Refactors for readability. |
| `critic-omc` | OMC | OMC's adversarial critic (kept distinct from seed). |
| `debugger` | OMC | Triages failing runs. |
| `designer` | OMC | API / UX design. |
| `document-specialist` | OMC | Authors docs. |
| `executor` | OMC | Generic task executor. |
| `explore` | OMC | Codebase exploration. |
| `git-master` | OMC | Git operations. |
| `planner-omc` | OMC | OMC's planner (kept distinct from seed). |
| `qa-tester` | OMC | QA checklists. |
| `scientist` | OMC | Hypothesis-driven investigation. |
| `security-reviewer` | OMC | Reviews for vulnerabilities. |
| `test-engineer` | OMC | Test framework setup. |
| `tracer` | OMC | Cross-module trace. |
| `verifier` | OMC | Confirms output against acceptance criteria. |
| `writer` | OMC | Long-form prose. |

## Skills (`.github/skills/*/SKILL.md`)

42 skills total (4 personal `workflow-*` + 38 from OMC). Skills are auto-triggered by user prompts via the `omcc-autoinject-skills` extension when `triggers:` keywords overlap. Browse `.github/skills/` for the full list.

### Personal workflow skills

| Skill | Triggers |
|---|---|
| `workflow-tdd` | tdd, write tests first, red green refactor |
| `workflow-spec` | spec, plan, design, requirements |
| `workflow-critique` | critique, review, red-team, adversarial |
| `workflow-verify` | verify, done check, definition of done |

## MCP tool surface (`omcc-mcp`, prefix `omcc_*`)

All tools are exposed by the bundled `mcp-server` (Node 22 `node:sqlite`, no native deps). DB lives at `~/.omcc/state.sqlite` (override with `OMCC_DB`).

| Tool | Purpose |
|---|---|
| `omcc_state_get` | Get value by key from KV store |
| `omcc_state_set` | Set KV value |
| `omcc_state_delete` | Delete KV key |
| `omcc_prd_set` | Create or update a PRD |
| `omcc_prd_get` | Fetch a PRD by id |
| `omcc_story_add` | Add a story to a PRD |
| `omcc_story_update` | Update story status / evidence |
| `omcc_story_list` | List all stories for a PRD |
| `omcc_phase_get` | Get current workflow phase for a scope |
| `omcc_phase_set` | Set current workflow phase for a scope |
| `omcc_memory_remember` | Persist a key/value/tags entry |
| `omcc_memory_recall` | Recall by key |
| `omcc_memory_search` | Substring search across keys/values/tags |
| `omcc_route_model` | Recommend a Copilot CLI model for a task |

`omcc_route_model` returns one of: `claude-opus-4.7` (design/review), `claude-haiku-4.5` (quick/explore), `gpt-5.3-codex` (raw codegen), `claude-sonnet-4.6` (default).

## SDK extensions (`.github/extensions/`)

| Extension | Hooks | Behavior |
|---|---|---|
| `omcc-guardrails` | `onPreToolUse` for `bash`, `edit`, `create` | Denies `rm -rf /`, force-push to protected branches, writes to `.env`/`.pem`/`~/.ssh/`, and commits containing detected secrets. Override with `OMCC_ALLOW_SECRETS=1`. |
| `omcc-autoinject-skills` | `onUserPromptSubmitted` | Scans `~/.copilot/skills/*/SKILL.md` and `.github/skills/*/SKILL.md`; injects best-matching skill body as additional context. |
| `omcc-statusline` | `onSessionStart`, `onPostToolUse`, `onSessionEnd` | Writes `~/.omcc/statusline.json` for external readers. |

## Slash-command collision matrix

OMCC renames any agent or skill whose name would collide with a Copilot CLI built-in slash command (`/plan`, `/clear`, `/help`, `/status`, `/setup`, `/exit`, `/quit`, `/model`, `/session`, `/login`, `/logout`, `/version`, `/feedback`). The renames applied during port:

| Original | Renamed to |
|---|---|
| `plan` | `omcc-plan` |
| `setup` | `omcc-setup` |
| `omc-*` | `omcc-*` |

`scripts/validate-frontmatter.mjs` enforces this in CI.

## CLI commands (`omcc`)

| Command | Purpose |
|---|---|
| `omcc init [--scope project\|user] [--target <path>] [--force] [--dry-run]` | Scaffold OMCC into a project or user scope |
| `omcc setup ...` | Alias of `init` |
| `omcc doctor` | Verify Copilot CLI version, MCP build, payload validation, mcp-config registration |
| `omcc upgrade` | Re-run `init --force` against the current target |
| `omcc adopt <target>` | Bootstrap an existing repo (currently `--mode template` only) |
