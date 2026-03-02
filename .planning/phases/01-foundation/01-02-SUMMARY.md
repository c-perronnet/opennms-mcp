---
phase: 01-foundation
plan: 02
subsystem: api
tags: [axios, mcp, typescript, http-client, stdio]

# Dependency graph
requires:
  - phase: 01-foundation plan 01
    provides: OpenNMSConfig type, isTokenAuth(), loadConfig() from src/config.ts

provides:
  - Axios HTTP client factory (createApiClient) returning {v1, v2} instances with auth baked in
  - Error classifier (buildErrorMessage) for network vs auth vs API errors
  - MCP server entry point (src/index.ts) startable via OPENNMS_CONFIG env or positional argv
  - server_info stub tool for connectivity verification
  - Phase 1 foundation complete — server connectable by Claude CLI

affects: [02-alarms, 03-nodes, 04-events, 05-assets, all future tool plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "axios instances created with auth headers at factory time (not per-request)"
    - "insecure TLS via httpsAgent: new https.Agent({ rejectUnauthorized: false })"
    - "all MCP server.tool() registrations before server.connect()"
    - "console.error() only for logging — stdout reserved for StdioServerTransport JSON-RPC"
    - "config loaded and validated before McpServer instantiation for clean process.exit(1)"

key-files:
  created:
    - src/client.ts
    - src/index.ts
  modified: []

key-decisions:
  - "Explicit OpenNMSConfig type annotation on let config variable — required to resolve TypeScript implicit-any error in try/catch pattern"
  - "buildAuthHeaders() is unexported internal helper — auth header construction is an implementation detail of createApiClient()"
  - "httpsAgent set to undefined (not null) when insecure is falsy — axios rejects null for httpsAgent"

patterns-established:
  - "Tool handler pattern: wrap entire body in try/catch, return isError: true on failure, never throw"
  - "API client pattern: v1 for /opennms/rest (mutations/categories), v2 for /api/v2 (FIQL reads)"

requirements-completed: [FOUND-03, FOUND-04, FOUND-06, FOUND-07, FOUND-08]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 1 Plan 02: HTTP Client Factory and MCP Server Entry Point Summary

**Axios v1/v2 client factory with baked-in auth headers, TLS bypass support, and readable error classification; MCP server entry point with StdioServerTransport and server_info connectivity tool**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T21:29:57Z
- **Completed:** 2026-03-02T21:31:59Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- createApiClient() returns {v1, v2} axios instances with auth (Basic or Bearer) set at creation time
- buildErrorMessage() classifies AxiosErrors into network-unreachable, credential-failure (401/403), or generic API error messages
- MCP server entry point with config path resolution (OPENNMS_CONFIG env var + argv[2] fallback), clean process.exit(1) on bad config
- server_info tool registered before server.connect() per MCP SDK contract; stdout clean (zero bytes) before JSON-RPC handshake

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/client.ts** - `552f02b` (feat)
2. **Task 2: Create src/index.ts** - `30d2182` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `src/client.ts` - Axios client factory with auth header injection, insecure TLS support, and error classification
- `src/index.ts` - MCP server entry point — config loading, McpServer, StdioServerTransport, server_info tool

## Decisions Made
- Explicit `OpenNMSConfig` type annotation on `let config` variable required to resolve TypeScript implicit-any error in try/catch pattern (auto-fixed during Task 2).
- `buildAuthHeaders()` kept unexported — it's an implementation detail, not part of the public API surface.
- `httpsAgent` set to `undefined` (not `null`) when `insecure` is falsy — axios does not accept `null` for this option.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript implicit-any on config variable in try/catch pattern**
- **Found during:** Task 2 (src/index.ts — initial compile)
- **Issue:** `let config;` followed by assignment inside `try {}` block causes TypeScript to infer type `any` at declaration site. Build produced TS7034 and TS7005 errors.
- **Fix:** Added `import { OpenNMSConfig } from "./config.js"` and typed the variable as `let config: OpenNMSConfig;`
- **Files modified:** src/index.ts
- **Verification:** `npm run build` exits 0 with no TypeScript errors after fix
- **Committed in:** `30d2182` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 TypeScript type error)
**Impact on plan:** Required for correct compilation. No scope creep — one-line fix.

## Issues Encountered
None beyond the auto-fixed TypeScript type annotation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 complete: package.json, tsconfig.json, src/config.ts, src/client.ts, src/index.ts all implemented and passing
- MCP server startable via `OPENNMS_CONFIG=/path/to/config.json node dist/index.js`
- server_info tool available for connectivity testing once a live OpenNMS instance is available
- Phase 2 (alarms tools) can begin — client factory and error handling patterns established

---
*Phase: 01-foundation*
*Completed: 2026-03-02*

## Self-Check: PASSED

- src/client.ts: FOUND
- src/index.ts: FOUND
- 01-02-SUMMARY.md: FOUND
- Commit 552f02b (feat: client.ts): FOUND
- Commit 30d2182 (feat: index.ts): FOUND
