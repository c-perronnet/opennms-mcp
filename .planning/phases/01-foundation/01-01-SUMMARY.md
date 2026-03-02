---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [typescript, zod, esm, node16, mcp, config-loading]

# Dependency graph
requires: []
provides:
  - "package.json with ESM project config and @modelcontextprotocol/sdk, axios, zod dependencies"
  - "tsconfig.json with Node16 module resolution for ESM TypeScript"
  - "src/config.ts: OpenNMSConfig type, isTokenAuth() guard, loadConfig() with Zod validation"
affects: [02-api-client, 03-alarms, 04-nodes, 05-advanced]

# Tech tracking
tech-stack:
  added:
    - "@modelcontextprotocol/sdk@^1.27.1"
    - "axios@^1.13.6"
    - "zod@^3.25.0"
    - "typescript@^5.9.3"
    - "@types/node@^22.0.0"
  patterns:
    - "ESM-native TypeScript with module:Node16 and .js import extensions"
    - "Zod union with TokenAuthSchema first to prevent strict() misfire on basic auth"
    - "loadConfig() fails fast with clear error before any MCP server initialization"

key-files:
  created:
    - "package.json"
    - "tsconfig.json"
    - "src/config.ts"
  modified:
    - ".gitignore"

key-decisions:
  - "TokenAuthSchema placed first in z.union([Token, Basic]) to prevent .strict() rejecting 'token' as unknown on BasicAuth"
  - "loadConfig() is synchronous (fs.readFileSync) — config must be validated before MCP server creation to enable clean process.exit(1)"
  - "URL trailing slash stripped in loadConfig() to prevent double-slash in API base paths like /api/v2//alarms"

patterns-established:
  - "Pattern: All relative imports in src/ use .js extension even in .ts files (Node16 ESM requirement)"
  - "Pattern: Config validation at startup boundary — fail fast with clear message before touching network"

requirements-completed: [FOUND-01, FOUND-02, FOUND-03, FOUND-05, FOUND-08]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 1 Plan 01: Project Init and Config Loading Summary

**ESM TypeScript project scaffold with Zod-validated config loader supporting basic auth, token auth, insecure TLS, and clear startup errors**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T20:07:08Z
- **Completed:** 2026-03-02T20:09:11Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- TypeScript ESM project initialized with Node16 module resolution, correct `"type": "module"`, and all required dependencies installed
- `src/config.ts` implements Zod-validated `loadConfig()` with typed `OpenNMSConfig` union, `isTokenAuth()` type guard, trailing slash stripping, and clear error messages for all bad-config cases
- `npm run build` compiles to `dist/` with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize project — package.json and tsconfig.json** - `400e629` (chore)
2. **Task 2: Implement src/config.ts with Zod validation** - `4621df1` (feat)

**Plan metadata:** `46e4a5a` (docs: complete plan)

## Files Created/Modified

- `package.json` - ESM project config, build/start scripts, dependency declarations
- `tsconfig.json` - TypeScript compiler settings for Node16 ESM
- `src/config.ts` - Config loading, Zod validation, OpenNMSConfig type, isTokenAuth(), loadConfig() exports
- `.gitignore` - Added node_modules/ and dist/ exclusions
- `package-lock.json` - Dependency lock file from npm install

## Decisions Made

- TokenAuthSchema listed first in the Zod union — prevents `.strict()` on BasicAuthSchema from rejecting the `token` key as an unknown field when a token config is parsed
- Synchronous `fs.readFileSync` used in `loadConfig()` — config must be validated before the MCP server is instantiated so `process.exit(1)` can fire cleanly before any network/MCP initialization
- Trailing slash stripped from URL in `loadConfig()` to prevent double-slash paths like `/api/v2//alarms` at every call site

## Deviations from Plan

None - plan executed exactly as written. The plan file was truncated after the verify block for Task 1, but the research document (01-RESEARCH.md) contained the complete implementation pattern. All must_haves verified programmatically.

## Issues Encountered

The plan file `01-01-PLAN.md` is truncated at line 127, ending mid-way through the Task 1 verify block. The research document contained the complete implementation patterns, so execution proceeded without blocking. The plan file should be regenerated or completed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `OpenNMSConfig`, `isTokenAuth()`, and `loadConfig()` are ready to import in Phase 2 (API client)
- `package.json` and `tsconfig.json` provide the build system for all subsequent phases
- No blockers for Phase 2 plan execution

## Self-Check: PASSED

- FOUND: /home/c_perronnet/git/opennms-mcp/package.json
- FOUND: /home/c_perronnet/git/opennms-mcp/tsconfig.json
- FOUND: /home/c_perronnet/git/opennms-mcp/src/config.ts
- FOUND: /home/c_perronnet/git/opennms-mcp/dist/config.js
- FOUND: /home/c_perronnet/git/opennms-mcp/.planning/phases/01-foundation/01-01-SUMMARY.md
- FOUND: commit 400e629
- FOUND: commit 4621df1
- FOUND: commit 46e4a5a
