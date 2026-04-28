---
name: harness-run
description: Run declarative YAML workflows for structured development pipelines. Use for feature development, bug fixes, code reviews, and custom workflows.
---

# Harness Run -- YAML Workflow Engine

## Available Workflows
Use `omcc_workflow_list` to see all available workflows in `.github/workflows-omcc/`.

## Usage
1. `omcc_workflow_list` -- See available workflows
2. `omcc_workflow_run(name="feature-to-pr", dry_run=true)` -- Preview execution plan
3. `omcc_workflow_run(name="feature-to-pr")` -- Start the workflow
4. Follow the execution plan: complete each node in order
5. `omcc_workflow_complete_node(run_id, node_id, status, result)` -- Mark nodes done
6. `omcc_workflow_status(run_id)` -- Check progress

## Creating Custom Workflows
Add `.yaml` files to `.github/workflows-omcc/`. Each workflow defines:
- `name`: Human-readable name
- `description`: What the workflow does
- `nodes`: List of steps with dependencies, skills/agents, and prompts

## Node Types
- `skill: <name>` -- Invoke a skill
- `agent: <name>` -- Use a specific agent
- `bash: <command>` -- Run a shell command
- `interactive: true` -- Pause for human input
- `loop:` -- Repeat until condition met
