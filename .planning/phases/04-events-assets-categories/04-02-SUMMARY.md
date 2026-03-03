---
phase: 04-events-assets-categories
plan: 02
subsystem: api
tags: [typescript, mcp, opennms, categories, axios, v1]

# Dependency graph
requires:
  - phase: 04-events-assets-categories/04-01
    provides: registerEventTools pattern (registerXxxTools signature, URLSearchParams PUT, src/index.ts wiring)
  - phase: 03-nodes
    provides: Node ID format patterns (numeric ID or foreignSource:foreignId accepted in v1 path segments)
provides:
  - registerCategoryTools() exporting list_categories, get_node_categories, add_category_to_node, remove_category_from_node
  - Four new MCP tools covering category management (global list, node-specific list, assign, remove)
affects: [05-collection, any phase managing node membership or grouping]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "POST not PUT for node category assignment — NodeRestService @POST @Path matches assign; @PUT would silently update category fields instead"
    - "encodeURIComponent(categoryName) in URL path segment — JAX-RS @PathParam auto-decodes; prevents 404 for names with spaces"
    - "Category list key 'category' (singular) — @JsonProperty('category') in OnmsCategoryCollection.java; same pattern as alarm/event/node/outage arrays"
    - "GET /categories returns 200 with empty array (not 204) — v1 endpoint; ?? [] guard handles both undefined and empty gracefully"

key-files:
  created:
    - src/tools/categories.ts
  modified:
    - src/index.ts

key-decisions:
  - "POST not PUT for add_category_to_node — @POST @Path in NodeRestService.java assigns node membership; PUT updates category entity fields silently"
  - "encodeURIComponent(categoryName) required in path — prevents 404 for category names with spaces or special characters"
  - "list_categories uses ?? [] guard — v1 returns 200 with empty list (not 204), but guard ensures safety if API changes"
  - "_config underscore prefix — unused parameter kept for consistent registerXxxTools(server, client, config) signature across all tool modules"

patterns-established:
  - "Category assignment pattern: POST /nodes/{id}/categories/{name} (no body) returns 201; DELETE /nodes/{id}/categories/{name} returns 204"
  - "URL-encode path parameters for user-supplied strings — prevents routing failures for names with spaces, slashes, or special chars"

requirements-completed: [CAT-01, CAT-02, CAT-03, CAT-04]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 4 Plan 02: Category Management Summary

**Four MCP tools for OpenNMS category management using v1 REST — global category list, node-specific category list, assign (POST not PUT), and remove (DELETE with encodeURIComponent)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T12:12:05Z
- **Completed:** 2026-03-03T12:13:36Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created src/tools/categories.ts with four MCP tools covering CAT-01 through CAT-04
- Implemented add_category_to_node using POST (not PUT) — critical correctness requirement per NodeRestService.java annotation
- Applied encodeURIComponent() on category names in all URL path segments for both assign and remove operations
- Wired registerCategoryTools() into src/index.ts as Step 8 after registerEventTools; step numbers updated throughout
- TypeScript compiles clean; full tool count reaches 20 (4 alarms + 6 nodes + 5 events/assets + 4 categories + 1 server_info)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/tools/categories.ts with all four tools** - `4e76c7a` (feat)
2. **Task 2: Wire registerCategoryTools into src/index.ts** - `e22e294` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/tools/categories.ts` - registerCategoryTools() with list_categories, get_node_categories, add_category_to_node, remove_category_from_node
- `src/index.ts` - Added import and Step 8 registration call for registerCategoryTools; renumbered server_info (Step 9) and connect (Step 10)

## Decisions Made
- POST (not PUT) for add_category_to_node: NodeRestService.java uses @POST @Path("/{nodeCriteria}/categories/{categoryName}") for node membership assignment. PUT would silently hit @PUT and update the category entity's own fields — wrong behavior, no HTTP error.
- encodeURIComponent(categoryName): Category names like "Backbone Routers" or names with slashes would cause 404 without encoding. JAX-RS @PathParam auto-decodes, so encoding is safe and correct.
- ?? [] guard on category list: The v1 endpoint returns 200 with an empty list (not 204), but the guard also handles undefined gracefully if the API behavior changes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 complete: all 9 planned tools (events + assets + categories) fully registered
- Full tool set: 20 MCP tools across 5 tool modules (alarms, nodes, events/assets, categories, server_info inline)
- Phase 5 (Collection) can proceed: registerCategoryTools pattern established, src/index.ts wiring pattern confirmed
- TypeScript compiles clean (npx tsc --noEmit exits 0)

---
*Phase: 04-events-assets-categories*
*Completed: 2026-03-03*

## Self-Check: PASSED

- FOUND: src/tools/categories.ts
- FOUND: .planning/phases/04-events-assets-categories/04-02-SUMMARY.md
- FOUND: commit 4e76c7a (Task 1 — categories.ts)
- FOUND: commit e22e294 (Task 2 — index.ts wiring)
