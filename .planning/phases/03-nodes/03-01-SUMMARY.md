---
phase: 03-nodes
plan: "01"
subsystem: api
tags: [opennms, mcp, nodes, typescript, axios, zod, fiql]

# Dependency graph
requires:
  - phase: 02-alarms
    provides: registerAlarmTools pattern (server, client, _config), 204-guard idiom, FIQL params pattern via axios _s param
provides:
  - NodeDTO, IpInterfaceDTO, SnmpInterfaceDTO TypeScript interfaces with JAXB-accurate field types
  - list_nodes MCP tool with FIQL filter and limit params, 204 guard, singular "node" array key
  - get_node MCP tool accepting numeric ID or foreignSource:foreignId format
  - get_node_ip_interfaces MCP tool with 204 guard, singular "ipInterface" array key
  - get_node_snmp_interfaces MCP tool with 204 guard, singular "snmpInterface" array key
  - registerNodeTools() wired into src/index.ts as Step 6
affects: [04-events, 05-collection, any phase needing node context]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Singular JSON array key pattern: OpenNMS v2 API uses singular property names (node, ipInterface, snmpInterface) — always check JAXB @JsonProperty annotations"
    - "foreignSource:foreignId dual-format ID: v2 API resolves both numeric IDs and colon-separated foreign identity in path segments transparently"
    - "node.id is string (@XmlID): serialized as string in JSON even though internally Integer in Java"

key-files:
  created:
    - src/tools/nodes.ts
  modified:
    - src/index.ts

key-decisions:
  - "node.id typed as string (not number) — @XmlID annotation causes Java to serialize node ID as string in JSON responses"
  - "Array key 'node' (singular) not 'nodes' — follows @JsonProperty('node') in OnmsNodeList.java; ipInterface and snmpInterface follow same convention"
  - "foreignSource:foreignId format accepted directly in path segment — v2 API resolves both numeric and FSS:FID transparently, no separate lookup"
  - "SnmpInterfaceDTO fields all optional — ifDescr/ifName etc. lack @XmlAttribute in Java source, inferred from UI TypeScript types only"

patterns-established:
  - "registerNodeTools signature: (server: McpServer, client: ApiClient, _config: OpenNMSConfig) — _config prefix for unused but required 3-arg signature"
  - "204/empty guard before accessing paginated list: resp.status === 204 || !resp.data?.arrayKey?.length"
  - "Formatters as module-level functions: formatNodeSummary, formatNodeDetail, formatIpInterface, formatSnmpInterface"

requirements-completed: [NODE-01, NODE-02, NODE-03, NODE-04]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 3 Plan 01: Nodes Summary

**Four MCP read tools for OpenNMS node discovery using FIQL filtering, dual-format node IDs, and singular array key guards across list_nodes, get_node, get_node_ip_interfaces, and get_node_snmp_interfaces**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T07:51:36Z
- **Completed:** 2026-03-03T07:53:44Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `src/tools/nodes.ts` with three TypeScript interfaces (NodeDTO, IpInterfaceDTO, SnmpInterfaceDTO) and four formatter functions, all accurately reflecting JAXB serialization behavior
- Implemented four read MCP tools: `list_nodes` (FIQL filter + limit), `get_node` (numeric or foreignSource:foreignId), `get_node_ip_interfaces`, `get_node_snmp_interfaces`
- Wired `registerNodeTools()` into `src/index.ts` as Step 6 with correct import and call — no other lines changed

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/tools/nodes.ts with interfaces, formatters, and four read tools** - `4e95a14` (feat)
2. **Task 2: Wire registerNodeTools into src/index.ts** - `e709517` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/tools/nodes.ts` - NodeDTO/IpInterfaceDTO/SnmpInterfaceDTO interfaces, formatters, registerNodeTools() with list_nodes, get_node, get_node_ip_interfaces, get_node_snmp_interfaces
- `src/index.ts` - Added import for registerNodeTools, added Step 6 registration call, renumbered Steps 7-8

## Decisions Made
- Typed `node.id` as `string` (not `number`): OpenNMS serializes node ID via `@XmlID` as a string in JSON even though the internal Java type is Integer. Using `number` would cause silent type mismatches in path interpolation.
- Used singular array key `"node"` (not `"nodes"`): The v2 API follows `@JsonProperty("node")` in `OnmsNodeList.java`. Same pattern applies to `"ipInterface"` and `"snmpInterface"`.
- Accepted `foreignSource:foreignId` in path segment directly: The v2 API transparently resolves both `42` and `MySource:server-001` as node identifiers — no separate lookup or transformation needed.
- All `SnmpInterfaceDTO` fields marked optional: `ifDescr`, `ifName`, etc. lack `@XmlAttribute` annotations in the Java source; field presence in JSON responses is inferred from UI TypeScript types only.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Node tools are fully registered and compiled; ready for Phase 4 (Events) or Phase 5 (Collection)
- Node ID string type and singular array key conventions established for future tool authors

---
*Phase: 03-nodes*
*Completed: 2026-03-03*
