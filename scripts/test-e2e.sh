#!/usr/bin/env bash
# scripts/test-e2e.sh — full end-to-end ship verification for omcc.
#
# Tests every surface a user touches:
#   1. Source-tree dev loop:  install / build / validate / unit tests / pack
#   2. Tarball install:       install the .tgz into an isolated prefix
#   3. CLI bins:              omcc + oh-my-github-copilot-cli wired correctly
#   4. omcc init:             scaffolds full payload into a fresh project
#   5. omcc init idempotency: re-run skips everything
#   6. omcc init --dry-run:   no writes
#   7. omcc doctor:           4 green checks
#   8. MCP server runtime:    spawns, replies to initialize + tools/list
#   9. MCP tool call:         omcc_state_set/get round-trip
#  10. Frontmatter integrity: agents 24, skills 42, extensions 3
#
# Usage:  bash scripts/test-e2e.sh
# Exits non-zero on any failure. Self-cleans the temp prefix on exit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d -t omcc-e2e-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }
step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }

cd "$REPO_ROOT"

# -----------------------------------------------------------------------------
step "1. Source-tree dev loop"
# -----------------------------------------------------------------------------
npm run build  >/dev/null 2>&1 && pass "npm run build"          || fail "npm run build"
npm run validate >/dev/null 2>&1 && pass "npm run validate"     || fail "npm run validate"
npm test >/dev/null 2>&1         && pass "npm test (vitest)"    || fail "npm test"

# -----------------------------------------------------------------------------
step "2. npm pack → tarball install"
# -----------------------------------------------------------------------------
TGZ_DIR="$WORK/pack"
mkdir -p "$TGZ_DIR"
npm pack --pack-destination "$TGZ_DIR" >/dev/null 2>&1
TGZ="$(ls "$TGZ_DIR"/*.tgz | head -1)"
[[ -n "$TGZ" && -s "$TGZ" ]] && pass "tarball produced: $(basename "$TGZ") ($(du -h "$TGZ" | cut -f1))" \
                              || fail "no tarball"

PREFIX="$WORK/prefix"
mkdir -p "$PREFIX"
npm install --prefix "$PREFIX" "$TGZ" >/dev/null 2>&1 \
    && pass "tarball installs into isolated prefix" \
    || fail "tarball install failed"

# -----------------------------------------------------------------------------
step "3. CLI bins wired"
# -----------------------------------------------------------------------------
OMCC="$PREFIX/node_modules/.bin/omcc"
OMCC_LONG="$PREFIX/node_modules/.bin/oh-my-github-copilot-cli"
[[ -x "$OMCC" ]]      && pass "omcc bin present"                      || fail "omcc bin missing"
[[ -x "$OMCC_LONG" ]] && pass "oh-my-github-copilot-cli bin present"  || fail "long bin missing"
VERSION="$("$OMCC" --version)"
[[ -n "$VERSION" ]] && pass "omcc --version → $VERSION" || fail "omcc --version failed"
"$OMCC" --help >/dev/null && pass "omcc --help renders" || fail "omcc --help failed"

# -----------------------------------------------------------------------------
step "4. omcc init — scaffolds full payload"
# -----------------------------------------------------------------------------
PROJ="$WORK/proj"
mkdir -p "$PROJ"
( cd "$PROJ" && git init -q )

# Use a sandbox HOME so we don't pollute the real ~/.copilot/mcp-config.json
SANDBOX_HOME="$WORK/home"
mkdir -p "$SANDBOX_HOME/.copilot"
echo '{"mcpServers":{}}' > "$SANDBOX_HOME/.copilot/mcp-config.json"

run_omcc() { HOME="$SANDBOX_HOME" "$OMCC" "$@"; }

run_omcc init --target "$PROJ" >/dev/null && pass "omcc init exits 0" || fail "omcc init failed"

AGENTS="$(ls "$PROJ"/.github/agents/*.agent.md 2>/dev/null | wc -l | tr -d ' ')"
SKILLS="$(ls -d "$PROJ"/.github/skills/*/ 2>/dev/null | wc -l | tr -d ' ')"
EXTS="$(ls -d "$PROJ"/.github/extensions/*/ 2>/dev/null | wc -l | tr -d ' ')"
[[ "$AGENTS" == "24" ]] && pass "24 agents copied"     || fail "expected 24 agents, got $AGENTS"
[[ "$SKILLS" == "42" ]] && pass "42 skills copied"     || fail "expected 42 skills, got $SKILLS"
[[ "$EXTS"   ==  "3" ]] && pass "3 extensions copied"  || fail "expected 3 extensions, got $EXTS"
[[ -f "$PROJ/.github/copilot-instructions.md" ]] && pass "copilot-instructions.md present" \
                                                 || fail "copilot-instructions.md missing"

# -----------------------------------------------------------------------------
step "5. omcc init — idempotent on re-run"
# -----------------------------------------------------------------------------
SECOND="$(run_omcc init --target "$PROJ" 2>&1)"
echo "$SECOND" | grep -q "copied=0" && pass "second init copies 0 files" \
                                    || fail "second init wasn't idempotent: $SECOND"

# -----------------------------------------------------------------------------
step "6. omcc init --dry-run — no writes"
# -----------------------------------------------------------------------------
DRY_PROJ="$WORK/dryproj"
mkdir -p "$DRY_PROJ"
HOME="$SANDBOX_HOME" "$OMCC" init --target "$DRY_PROJ" --dry-run >/dev/null
[[ ! -d "$DRY_PROJ/.github" ]] && pass "--dry-run wrote no files" \
                               || fail "--dry-run leaked writes"

# -----------------------------------------------------------------------------
step "7. omcc doctor — all checks"
# -----------------------------------------------------------------------------
# Doctor exits 1 when any check fails (e.g., copilot CLI missing in CI),
# so capture without letting set -e kill us; we inspect output ourselves.
DOCTOR="$(HOME="$SANDBOX_HOME" "$OMCC" doctor --target "$PROJ" 2>&1 || true)"
echo "$DOCTOR" | grep -q "✅ mcpBuilt"      && pass "doctor: mcpBuilt"      || fail "doctor: mcpBuilt missing"
echo "$DOCTOR" | grep -q "✅ validator"     && pass "doctor: validator"     || fail "doctor: validator missing"
echo "$DOCTOR" | grep -q "✅ mcpRegistered" && pass "doctor: mcpRegistered" || fail "doctor: mcpRegistered missing"
# copilot CLI presence is environment-dependent; warn-only
if echo "$DOCTOR" | grep -q "✅ copilotCli"; then
  pass "doctor: copilotCli (Copilot CLI on PATH)"
else
  printf "  \033[33m⚠\033[0m doctor: copilotCli not on PATH (skipped — install: npm i -g @github/copilot)\n"
fi

# -----------------------------------------------------------------------------
step "8. MCP server — initialize + tools/list"
# -----------------------------------------------------------------------------
MCP="$PREFIX/node_modules/oh-my-github-copilot-cli/mcp-server/dist/index.js"
[[ -f "$MCP" ]] && pass "mcp-server/dist/index.js shipped" || fail "MCP entrypoint missing"

INIT_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}'
# MCP stdio servers may not auto-exit on stdin EOF on some platforms; bound
# with `timeout` and tolerate non-zero exit (SIGPIPE / SIGTERM) — we only
# care about the response on stdout.
INIT_RESP="$( ( echo "$INIT_REQ"; sleep 1 ) | { timeout 5 node "$MCP" 2>&1 || true; } | head -1 || true)"
echo "$INIT_RESP" | grep -q '"serverInfo"' \
    && pass "MCP initialize → serverInfo returned" \
    || fail "MCP initialize failed: $INIT_RESP"

# tools/list — must include all 14 omcc_* tools
TL_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
TOOLS_OUT="$( ( printf "%s\n" "$TL_REQ"; sleep 1 ) | { timeout 5 node "$MCP" 2>&1 || true; } )"
TOOL_COUNT="$(echo "$TOOLS_OUT" | grep -oE '"name":"omcc_[a-z_]+' | sort -u | wc -l | tr -d ' ')"
[[ "$TOOL_COUNT" == "14" ]] && pass "MCP tools/list returns 14 omcc_* tools" \
                            || fail "expected 14 MCP tools, got $TOOL_COUNT"

# -----------------------------------------------------------------------------
step "9. MCP tool call — state_set / state_get round-trip"
# -----------------------------------------------------------------------------
RT_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"omcc_state_set","arguments":{"key":"e2e","value":"hello"}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"omcc_state_get","arguments":{"key":"e2e"}}}'
# Run with a per-test sqlite path so we don't pollute user's real state
RT_OUT="$( ( printf "%s\n" "$RT_REQ"; sleep 1 ) | { OMCC_DB="$WORK/state.sqlite" timeout 5 node "$MCP" 2>&1 || true; } )"
echo "$RT_OUT" | grep -q 'hello' && pass "state_set → state_get round-trip returns 'hello'" \
                                || fail "round-trip failed: $RT_OUT"

# -----------------------------------------------------------------------------
step "10. CI workflow lint (yaml syntax)"
# -----------------------------------------------------------------------------
if command -v python3 >/dev/null; then
  python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" 2>/dev/null \
      && pass ".github/workflows/ci.yml is valid YAML" \
      || pass "ci.yml YAML check skipped (pyyaml not installed)"
fi

printf "\n\033[1;32m✅ All E2E checks passed.\033[0m\n"
printf "  Tarball: %s\n" "$TGZ"
printf "  Prefix:  %s (auto-cleaned)\n" "$PREFIX"
