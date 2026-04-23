// OMCC Statusline (passive). Writes ~/.omcc/statusline.json on session events.
import { joinSession } from "@github/copilot-sdk/extension";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateDir = process.env.OMCC_DIR ?? join(homedir(), ".omcc");
const statusFile = join(stateDir, "statusline.json");
mkdirSync(stateDir, { recursive: true });

const state = {
  schemaVersion: 1,
  sessionId: null,
  startedAt: null,
  toolCalls: 0,
  lastTool: null,
  lastTs: null,
  status: "idle",
};

function flush() {
  try { writeFileSync(statusFile, JSON.stringify(state, null, 2) + "\n"); }
  catch { /* never break a session over status */ }
}

await joinSession({
  hooks: {
    onSessionStart: (input, { sessionId }) => {
      state.sessionId = sessionId;
      state.startedAt = input.timestamp;
      state.toolCalls = 0;
      state.lastTool = null;
      state.lastTs = input.timestamp;
      state.status = "active";
      flush();
    },
    onPostToolUse: (input) => {
      state.toolCalls += 1;
      state.lastTool = input.toolName;
      state.lastTs = input.timestamp;
      flush();
    },
    onSessionEnd: (input) => {
      state.status = `ended:${input.reason}`;
      state.lastTs = input.timestamp;
      flush();
    },
  },
});
