---
phase: 04-events-assets-categories
plan: 01
subsystem: api
tags: [typescript, mcp, opennms, events, assets, axios, fiql]

# Dependency graph
requires:
  - phase: 03-nodes
    provides: registerNodeTools pattern (registerXxxTools signature, URLSearchParams PUT, 204 guard, v1/v2 routing)
  - phase: 02-alarms
    provides: registerAlarmTools pattern (FIQL _s param, singular array key, axios params encoding)
provides:
  - registerEventTools() exporting list_events, get_event, send_event, get_node_asset_record, update_node_asset_record
  - Five new MCP tools covering event read/send and asset record read/update
affects: [05-collection, any phase needing event or asset context]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "URLSearchParams body for v1 PUT asset record — axios auto-sets application/x-www-form-urlencoded"
    - "204 guard before accessing event array — v2 returns HTTP 204 on empty results"
    - "FIQL property name mapping: eventUei (not uei), node.id (not nodeId), eventSeverity (not severity)"
    - "JAXB field name mapping for send_event: nodeid (lowercase), interface, descr — NOT nodeId/ipAddress/description"
    - "EventDTO.id is Integer (not string) — unlike NodeDTO which uses @XmlID string"

key-files:
  created:
    - src/tools/events.ts
  modified:
    - src/index.ts

key-decisions:
  - "event and asset tools co-located in events.ts — single registerEventTools() export keeps wiring symmetrical with existing phases"
  - "send_event body uses JAXB field names: nodeid (lowercase), interface, descr — mismatched names would silently fail"
  - "list_events uses client.v2.get with FIQL _s param — v1 has no FIQL support"
  - "update_node_asset_record uses URLSearchParams body for server-side partial update — no GET-merge-PUT needed"
  - "FIQL property names for events differ from JSON response field names: eventUei not uei, node.id not nodeId"

patterns-established:
  - "JAXB annotation lookup: when POST body fails silently, check @XmlElement(name=) for exact field names"
  - "v1 BeanWrapper partial update: only submitted URLSearchParams fields are modified, rest untouched"
  - "Asset record tools co-located with events rather than separate file — no assets.ts required"

requirements-completed: [EVENT-01, EVENT-02, EVENT-03, ASSET-01, ASSET-02]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 4 Plan 01: Events and Asset Records Summary

**Five MCP tools for OpenNMS events (list/get/send via v2) and node asset records (read/partial-update via v1) in a single registerEventTools() export**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T08:38:29Z
- **Completed:** 2026-03-03T08:41:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created src/tools/events.ts with five MCP tools covering EVENT-01/02/03 and ASSET-01/02
- Registered list_events with FIQL filter support (v2 /events), 204 guard, and singular "event" array key
- Registered send_event mapping tool params to JAXB field names (nodeid, interface, descr)
- Registered get_node_asset_record and update_node_asset_record using v1 /nodes/{id}/assetRecord
- Wired registerEventTools() into src/index.ts as Step 7 before server_info

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/tools/events.ts with all five tools** - `8e3eccf` (feat)
2. **Task 2: Wire registerEventTools into src/index.ts** - `e7672bf` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/tools/events.ts` - registerEventTools() with list_events, get_event, send_event, get_node_asset_record, update_node_asset_record
- `src/index.ts` - Added import and registration call for registerEventTools

## Decisions Made
- Co-located asset tools in events.ts (not a separate assets.ts) per research recommendation — keeps registration symmetrical with alarms and nodes phases
- send_event uses JAXB field names from Event.java annotations (nodeid, interface, descr) rather than user-facing camelCase — wrong names would fail silently
- FIQL filter property names for events differ from JSON response keys: eventUei (not uei), node.id (not nodeId), eventSeverity (not severity) — documented in tool description
- update_node_asset_record relies on Spring BeanWrapper server-side partial update — no client-side GET-merge-PUT needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 Plan 01 complete; events and asset MCP tools fully registered
- Phase 4 Plan 02 (categories) can proceed: registerCategoryTools() pattern established
- TypeScript compiles clean (npx tsc --noEmit exits 0)

---
*Phase: 04-events-assets-categories*
*Completed: 2026-03-03*
