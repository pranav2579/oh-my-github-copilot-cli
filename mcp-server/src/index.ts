// mcp-server/src/index.ts
// MCP stdio transport entrypoint. Wires the OMCC tool registry to the SDK.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "node:os";
import { join } from "node:path";

import { openDb } from "./db.js";
import { TOOLS, type ToolName } from "./tools.js";
import { LEARNING_TOOLS, type LearningToolName } from "./learning.js";

const ALL_TOOLS = { ...TOOLS, ...LEARNING_TOOLS } as Record<string, (db: any, args: any) => any>;

const DB_PATH =
  process.env.OMCC_DB ??
  join(process.env.HOME ?? homedir(), ".omcc", "state.sqlite");

const TOOL_SCHEMAS: Record<string, { description: string; inputSchema: object }> = {
  omcc_state_get: {
    description: "Retrieve a value from the OMCC key/value state store.",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  omcc_state_set: {
    description: "Set a value in the OMCC key/value state store.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
    },
  },
  omcc_state_delete: {
    description: "Delete a key from the OMCC state store.",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  omcc_prd_set: {
    description: "Create or update a PRD (product requirement doc).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        content: { type: "string" },
        status: { type: "string" },
      },
      required: ["id", "content"],
    },
  },
  omcc_prd_get: {
    description: "Fetch a PRD by id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  omcc_story_add: {
    description: "Add a user story to a PRD.",
    inputSchema: {
      type: "object",
      properties: {
        prd_id: { type: "string" },
        id: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
      },
      required: ["prd_id", "id", "title"],
    },
  },
  omcc_story_update: {
    description: "Update story status/evidence.",
    inputSchema: {
      type: "object",
      properties: {
        prd_id: { type: "string" },
        id: { type: "string" },
        status: { type: "string" },
        evidence: { type: "string" },
      },
      required: ["prd_id", "id"],
    },
  },
  omcc_story_list: {
    description: "List all stories for a PRD.",
    inputSchema: { type: "object", properties: { prd_id: { type: "string" } }, required: ["prd_id"] },
  },
  omcc_phase_get: {
    description: "Get the current workflow phase for a scope.",
    inputSchema: { type: "object", properties: { scope: { type: "string" } } },
  },
  omcc_phase_set: {
    description: "Set the current workflow phase for a scope.",
    inputSchema: {
      type: "object",
      properties: { scope: { type: "string" }, phase: { type: "string" } },
      required: ["phase"],
    },
  },
  omcc_memory_remember: {
    description: "Persist a key/value/tags entry into long-form memory.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" }, tags: { type: "string" } },
      required: ["key", "value"],
    },
  },
  omcc_memory_recall: {
    description: "Recall a memory entry by key.",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  omcc_memory_search: {
    description: "Substring search across memory keys/values/tags.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" }, limit: { type: "integer" } },
      required: ["q"],
    },
  },
  omcc_route_model: {
    description: "Recommend a model for a given task description or category.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        category: { type: "string" },
      },
    },
  },
  omcc_route_categories: {
    description: "List all available model routing categories with descriptions.",
    inputSchema: { type: "object", properties: {} },
  },
  omcc_failure_pattern_add: {
    description: "Add a new failure pattern. Auto-increments occurrences if pattern text matches existing.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        prevention: { type: "string" },
        scope: { type: "string" },
      },
      required: ["pattern", "prevention"],
    },
  },
  omcc_failure_pattern_list: {
    description: "List all failure patterns sorted by occurrences.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        limit: { type: "integer" },
      },
    },
  },
  omcc_failure_pattern_check: {
    description: "Check if current context matches known failure patterns.",
    inputSchema: {
      type: "object",
      properties: { context: { type: "string" } },
      required: ["context"],
    },
  },
  omcc_fitness_score: {
    description: "Compute a deterministic 0.0-1.0 quality score from pre-computed build/lint/test results and file scans. Does not execute commands; accepts results from prior runs.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string" },
        changed_files: { type: "array", items: { type: "string" } },
        build_cmd: { type: "string" },
        build_exit_code: { type: "number" },
        lint_cmd: { type: "string" },
        lint_exit_code: { type: "number" },
        lint_error_count: { type: "number" },
        test_cmd: { type: "string" },
        test_exit_code: { type: "number" },
        test_passed: { type: "number" },
        test_total: { type: "number" },
        format_cmd: { type: "string" },
        format_exit_code: { type: "number" },
      },
    },
  },
  omcc_memory_layer_get: {
    description: "Get content for a specific memory layer (0=Identity, 1=Essential Rules, 2=Project State, 3=Knowledge Base).",
    inputSchema: { type: "object", properties: { level: { type: "number" }, q: { type: "string" } }, required: ["level"] },
  },
  omcc_memory_promote: {
    description: "Promote a memory item up one layer (L3->L2 or L2->L1). L1 requires confidence >= 0.7.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, from_level: { type: "number" }, to_level: { type: "number" } }, required: ["id", "from_level", "to_level"] },
  },
  omcc_memory_demote: {
    description: "Demote a memory item down one layer (L1->L2 or L2->L3).",
    inputSchema: { type: "object", properties: { id: { type: "string" }, from_level: { type: "number" }, to_level: { type: "number" } }, required: ["id", "from_level", "to_level"] },
  },
  omcc_memory_layer_add: {
    description: "Add or update an entry in the layered memory system.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, content: { type: "string" }, level: { type: "number" }, confidence: { type: "number" }, category: { type: "string" }, source: { type: "string" } }, required: ["id", "content"] },
  },
  omcc_decision_add: {
    description: "Record an architectural or project decision with rationale.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        decision: { type: "string" },
        rationale: { type: "string" },
        category: { type: "string", enum: ["architecture", "technology", "scope", "process"] },
      },
      required: ["decision", "rationale"],
    },
  },
  omcc_decision_list: {
    description: "List recorded decisions, optionally filtered by category and status.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["architecture", "technology", "scope", "process"] },
        status: { type: "string", enum: ["active", "superseded", "reversed"] },
      },
    },
  },
  omcc_decision_check: {
    description: "Check if a proposed action contradicts any recorded active decision via keyword matching.",
    inputSchema: {
      type: "object",
      properties: { proposal: { type: "string" } },
      required: ["proposal"],
    },
  },
  omcc_decision_update_status: {
    description: "Update the status of a recorded decision (active, superseded, reversed).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["active", "superseded", "reversed"] },
      },
      required: ["id", "status"],
    },
  },
  omcc_benchmark_record: {
    description: "Record a benchmark data point for cross-agent comparison.",
    inputSchema: {
      type: "object",
      properties: {
        task_description: { type: "string" },
        task_category: { type: "string" },
        model_used: { type: "string" },
        quality_score: { type: "number" },
        tokens_used: { type: "integer" },
        duration_seconds: { type: "number" },
        cost_estimate: { type: "number" },
        success: { type: "integer" },
      },
      required: ["task_description", "model_used"],
    },
  },
  omcc_benchmark_compare: {
    description: "Compare models for a task category sorted by quality/cost value ratio.",
    inputSchema: {
      type: "object",
      properties: { task_category: { type: "string" } },
      required: ["task_category"],
    },
  },
  omcc_benchmark_report: {
    description: "Generate a full benchmark report across all categories with recommended model per category.",
    inputSchema: { type: "object", properties: {} },
  },
  omcc_benchmark_history: {
    description: "List recent benchmark runs, optionally filtered by model and/or category.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string" },
        category: { type: "string" },
        limit: { type: "integer" },
      },
    },
  },
  omcc_learn_extract: {
    description: "Extract patterns from a description of what happened in a session.",
    inputSchema: { type: "object", properties: { session_summary: { type: "string" } }, required: ["session_summary"] },
  },
  omcc_learn_record: {
    description: "Record a specific learned pattern.",
    inputSchema: { type: "object", properties: { pattern: { type: "string" }, category: { type: "string" }, confidence: { type: "number" } }, required: ["pattern", "category"] },
  },
  omcc_learn_promote: {
    description: "Promote a pattern to a higher memory layer.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, target: { type: "string" } }, required: ["id", "target"] },
  },
  omcc_learn_list: {
    description: "List learned patterns.",
    inputSchema: { type: "object", properties: { category: { type: "string" }, min_confidence: { type: "number" } } },
  },
  omcc_msg_send: {
    description: "Send a message to another agent.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        content: { type: "string" },
        channel: { type: "string" },
        priority: { type: "integer" },
      },
      required: ["from", "content"],
    },
  },
  omcc_msg_receive: {
    description: "Get pending messages for an agent.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string" }, channel: { type: "string" } },
      required: ["agent"],
    },
  },
  omcc_msg_acknowledge: {
    description: "Mark a message as acknowledged.",
    inputSchema: {
      type: "object",
      properties: { message_id: { type: "string" } },
      required: ["message_id"],
    },
  },
  omcc_msg_broadcast: {
    description: "Send to all agents on a channel.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        content: { type: "string" },
        channel: { type: "string" },
      },
      required: ["from", "content"],
    },
  },
  omcc_lock_acquire: {
    description: "Acquire a lease-based file lock.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        owner: { type: "string" },
        ttl_seconds: { type: "number" },
      },
      required: ["file_path", "owner"],
    },
  },
  omcc_lock_release: {
    description: "Release a file lock.",
    inputSchema: {
      type: "object",
      properties: { file_path: { type: "string" }, owner: { type: "string" } },
      required: ["file_path", "owner"],
    },
  },
  omcc_lock_check: {
    description: "Check if a file is locked.",
    inputSchema: {
      type: "object",
      properties: { file_path: { type: "string" } },
      required: ["file_path"],
    },
  },
  omcc_eval_create: {
    description: "Create an A/B skill evaluation.",
    inputSchema: {
      type: "object",
      properties: {
        skill_name: { type: "string" },
        test_cases: { type: "string" },
        graders: { type: "string" },
      },
      required: ["skill_name", "test_cases", "graders"],
    },
  },
  omcc_eval_score: {
    description: "Submit scores for a trial arm (with or without skill).",
    inputSchema: {
      type: "object",
      properties: {
        eval_id: { type: "string" },
        arm: { type: "string" },
        test_case_id: { type: "string" },
        grader_results: { type: "string" },
      },
      required: ["eval_id", "arm", "test_case_id", "grader_results"],
    },
  },
  omcc_eval_report: {
    description: "Generate the evaluation report with grade (A/B/C/F) and delta analysis.",
    inputSchema: {
      type: "object",
      properties: {
        eval_id: { type: "string" },
      },
      required: ["eval_id"],
    },
  },
  omcc_eval_history: {
    description: "List past skill evaluations, optionally filtered by skill name.",
    inputSchema: {
      type: "object",
      properties: {
        skill_name: { type: "string" },
      },
    },
  },
};

// --- learning pipeline tools ---
const LEARNING_SCHEMAS: Record<string, { description: string; inputSchema: object }> = {
  omcc_learn_extract: {
    description: "Extract patterns from a description of what happened in a session.",
    inputSchema: {
      type: "object",
      properties: { session_summary: { type: "string" } },
      required: ["session_summary"],
    },
  },
  omcc_learn_record: {
    description: "Record a specific learned pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        category: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["pattern", "category"],
    },
  },
  omcc_learn_promote: {
    description: "Promote a pattern to a higher memory layer.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        target: { type: "string" },
      },
      required: ["id", "target"],
    },
  },
  omcc_learn_list: {
    description: "List learned patterns.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        min_confidence: { type: "number" },
      },
    },
  },
};

const ALL_SCHEMAS: Record<string, { description: string; inputSchema: object }> = { ...TOOL_SCHEMAS, ...LEARNING_SCHEMAS };

async function main() {
  const db = openDb(DB_PATH);

  const server = new Server(
    { name: "omcc-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.keys(TOOL_SCHEMAS).map((name) => ({
      name,
      description: ALL_SCHEMAS[name].description,
      inputSchema: ALL_SCHEMAS[name].inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const fn = ALL_TOOLS[name];
    if (!fn) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }
    const result = (fn as (db: any, args: any) => any)(db, req.params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("SIGINT", () => {
    db.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
