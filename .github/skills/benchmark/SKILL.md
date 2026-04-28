---
name: benchmark
description: Compare AI model performance across task categories. Track quality, speed, cost, and success rate to find the optimal model for each type of work.
---

# Cross-Agent Benchmarking

## Recording Benchmarks
After completing a task, record its metrics with omcc_benchmark_record.

## Comparing Models
Use omcc_benchmark_compare(task_category) to see which model is best.

## Full Report
Use omcc_benchmark_report to get a complete comparison across all categories.

## Metrics
| Metric | What It Measures |
|---|---|
| quality_score | Fitness score of the output (0.0-1.0) |
| tokens_used | Total tokens consumed |
| duration_seconds | Wall clock time |
| cost_estimate | Approximate dollar cost |
| success | Whether the task completed without errors |
| value_ratio | quality / cost (higher = better value) |
