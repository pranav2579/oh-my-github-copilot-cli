---
name: token-analytics
description: Analyze the token cost of agents, skills, and extensions in the harness. Use to identify bloated components and optimize context budget.
---

# Token Analytics

## When to Use
- When sessions feel slow or hit context limits
- After adding new agents or skills
- During periodic harness maintenance
- When investigating context compaction events

## Workflow
1. Run `node scripts/analyze-tokens.mjs` to generate the full report
2. Review the "Largest files" section for trim candidates
3. For files over 2,000 tokens, consider:
   - Splitting into smaller focused skills
   - Moving detailed examples to on-demand loading
   - Removing redundant instructions
4. Re-run after changes to verify reduction

## Token Estimation
Approximate: 1 word ≈ 1.3 tokens (conservative estimate for English + code mixed content)
