---
name: memory-layers
description: Manage the 4-layer memory system (L0 Identity, L1 Essential Rules, L2 Project State, L3 Knowledge Base). Use to promote learned patterns, review memory layers, or optimize context loading.
---

# Memory Layers

## Layer Architecture
| Layer | Content | Loading | Token Budget |
|---|---|---|---|
| L0 | Agent identity, core principles | Always (copilot-instructions.md) | ~200 |
| L1 | Essential rules, top failure patterns | Session start | ~800 |
| L2 | Project state (brief, decisions, features) | On-demand | ~2000 |
| L3 | Full knowledge base | Queried | Unlimited |

## Workflow

1. `omcc_memory_layer_get(level=1)` -- Review current essential rules
2. `omcc_memory_layer_get(level=3)` -- Search full knowledge base
3. `omcc_memory_layer_add(id, content, level=3)` -- Add new knowledge
4. `omcc_memory_promote(id, from_level=3, to_level=2)` -- Promote useful knowledge
5. `omcc_memory_promote(id, from_level=2, to_level=1)` -- Promote to essential (needs confidence >= 0.7)
6. `omcc_memory_demote(id, from_level=1, to_level=2)` -- Demote stale rules
7. Run `node scripts/generate-essential-rules.mjs` -- Regenerate L1 file

## MCP Tools

- **omcc_memory_layer_get** -- Get content for a specific layer (0-3)
- **omcc_memory_layer_add** -- Add or update a memory entry at a given layer
- **omcc_memory_promote** -- Promote an entry up one layer (confidence gated for L1)
- **omcc_memory_demote** -- Demote an entry down one layer

## L1 Generation

The `scripts/generate-essential-rules.mjs` script reads all L1 entries with confidence >= 0.7 and writes `.github/harness/essential-rules.md`. Run it after promoting entries to L1.

## L2 State File Templates

Templates in `templates/state-files/`:
- `project-brief.md` -- Goals, non-goals, tech stack, team
- `decision-log.md` -- Architectural decisions with date + rationale
- `features.md` -- Living feature registry

Copy these to your project and fill them in. L2 content is loaded on-demand when the agent needs project context.
