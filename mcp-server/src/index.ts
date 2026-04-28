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

const DB_PATH =
  process.env.OMCC_DB ??
  join(process.env.HOME ?? homedir(), ".omcc", "state.sqlite");

const TOOL_SCHEMAS: Record<ToolName, { description: string; inputSchema: object }> = {
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
};

async function main() {
  const db = openDb(DB_PATH);

  const server = new Server(
    { name: "omcc-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => ({
      name,
      description: TOOL_SCHEMAS[name].description,
      inputSchema: TOOL_SCHEMAS[name].inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name as ToolName;
    const fn = TOOLS[name];
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
