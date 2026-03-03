---
phase: 03-nodes
plan: "02"
subsystem: api
tags: [opennms, mcp, nodes, outages, rescan, typescript, axios, zod]

# Dependency graph
requires:
  - phase: 03-nodes/03-01
    provides: NodeDTO interface with string id field, registerNodeTools() function shell, client.v1/v2 pattern, buildErrorMessage
provides:
  - OutageDTO TypeScript interface with epoch ms fields for ifLostService and ifRegainedService
  - formatOutage() helper displaying lost/regained timestamps and Active status
  - get_node_outages MCP tool (v1 /outages/forNode/{numericId}, auto-resolves foreignSource:foreignId via v2)
  - rescan_node MCP tool (v2 PUT /nodes/{id}/rescan, URLSearchParams body, no resp.data access)
affects: [any phase presenting node operational status, future outage-focused plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "foreignSource:foreignId resolution pattern: if id is not purely numeric, resolve via v2 /nodes/{id} to get numeric id before calling v1 endpoint"
    - "v1-only outage endpoint: /opennms/rest/outages/forNode/{numericId} accepts numeric int only — never pass foreignSource:foreignId directly to v1"
    - "URLSearchParams as PUT body: axios auto-sets Content-Type: application/x-www-form-urlencoded, satisfying @Consumes(APPLICATION_FORM_URLENCODED) on Java side"
    - "Empty PUT response: rescan returns HTTP 200 with empty body — do not access resp.data after mutation"
    - "Singular outage array key: resp.data.outage (not 'outages') — follows @JsonProperty('outage') in OnmsOutageCollection.java"

key-files:
  created: []
  modified:
    - src/tools/nodes.ts

key-decisions:
  - "v1 /outages/forNode/{numericId} requires numeric int — foreignSource:foreignId must be resolved to numeric ID via v2 before calling v1 outages endpoint"
  - "Outage array key is 'outage' (singular) — matches @JsonProperty('outage') in OnmsOutageCollection.java, consistent with node/ipInterface/snmpInterface pattern"
  - "rescan_node uses v2 PUT (not v1) — rescan endpoint exists only on /api/v2/nodes/{nodeCriteria}/rescan"
  - "new URLSearchParams() used as rescan body — satisfies @Consumes(APPLICATION_FORM_URLENCODED) with empty form payload; axios handles Content-Type automatically"
  - "No resp.data access after rescan PUT — HTTP 200 returns empty body; accessing data would yield undefined or empty string"

patterns-established:
  - "v1-requires-numeric pattern: when v1 endpoint requires numeric ID, check /^\\d+$/.test(id) and resolve via client.v2.get(`/nodes/${id}`) if needed"
  - "Active outage detection: o.ifRegainedService == null (loose equality catches both null and undefined) — field is absent/null when service still down"

requirements-completed: [NODE-05, NODE-06]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 3 Plan 02: Node Outages and Rescan Summary

**v1 outage listing with foreignSource:foreignId resolution and v2 rescan triggering complete the OpenNMS node tool suite with get_node_outages and rescan_node**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T07:56:50Z
- **Completed:** 2026-03-03T07:58:30Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added OutageDTO interface accurately reflecting OnmsOutage.java transient fields and OnmsOutageCollection.java serialization
- Implemented get_node_outages using v1 /outages/forNode/{numericId} with automatic foreignSource:foreignId resolution via v2
- Implemented rescan_node using v2 PUT /nodes/{id}/rescan with URLSearchParams body satisfying Java @Consumes(APPLICATION_FORM_URLENCODED)
- registerNodeTools() now registers all 6 node tools: list_nodes, get_node, get_node_ip_interfaces, get_node_snmp_interfaces, get_node_outages, rescan_node

## Task Commits

Each task was committed atomically:

1. **Task 1: Add OutageDTO interface, formatOutage helper, and get_node_outages tool** - `ff96aa8` (feat)
2. **Task 2: Add rescan_node tool** - `daa852e` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/tools/nodes.ts` - Added OutageDTO interface, formatOutage() formatter, get_node_outages tool registration, rescan_node tool registration

## Decisions Made
- The v1 outage endpoint (/opennms/rest/outages/forNode/{numericId}) accepts only integer node IDs. When the caller provides foreignSource:foreignId, we resolve it via a v2 /nodes/{id} GET first, then use the returned node.id string (which is always numeric) for the v1 call.
- The outage array key is "outage" (singular) matching @JsonProperty("outage") in OnmsOutageCollection.java, consistent with the "node"/"ipInterface"/"snmpInterface" pattern established in Plan 01.
- The rescan endpoint exists only on v2 (/api/v2/nodes/{nodeCriteria}/rescan). Using v1 would 404. The v2 endpoint accepts both numeric IDs and foreignSource:foreignId natively so no pre-resolution is needed.
- URLSearchParams() used as PUT body to satisfy the Java endpoint's @Consumes(APPLICATION_FORM_URLENCODED) constraint. axios automatically sets the correct Content-Type header when it detects a URLSearchParams instance.
- resp.data is not accessed after the rescan PUT because HTTP 200 returns an empty body. Accessing it would yield an empty string or undefined.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 node tools registered and TypeScript compiles cleanly
- Node tool suite complete: list, get, IP interfaces, SNMP interfaces, outages, rescan
- Ready for Phase 4 (Events) or Phase 5 (Collection)

---
*Phase: 03-nodes*
*Completed: 2026-03-03*
