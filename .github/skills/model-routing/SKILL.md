---
name: model-routing
description: Route tasks to the optimal model based on task category. Use when dispatching sub-agents or selecting models for specific work types.
---

# Model Category Routing

## Categories
| Category | Best For | Default Model |
|---|---|---|
| orchestrator | Planning, delegation, complex reasoning | claude-opus-4.6 |
| deep-worker | Autonomous research, long execution | gpt-5.4 |
| quick | Single-file changes, formatting | claude-haiku-4.5 |
| reviewer | Code review, security audit | claude-sonnet-4.6 |
| creative | UI/UX, game design, brainstorming | gemini-2.5-pro |

## Usage
- Call `omcc_route_model` with a `category` for direct routing
- Call `omcc_route_model` with a `task` description for auto-classification
- Call `omcc_route_categories` to see all available categories