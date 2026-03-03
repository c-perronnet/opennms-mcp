---
phase: 03-nodes
verified: 2026-03-03T00:00:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 3: Nodes Verification Report

**Phase Goal:** Claude can discover and inspect nodes — interfaces, outages, and rescan — to support any node-centric workflow
**Verified:** 2026-03-03
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Claude can list all nodes and see node ID, label, foreignSource, foreignId, and location | VERIFIED | `list_nodes` tool at line 159; `formatNodeSummary` renders ID, label, location, foreignSource, foreignId (lines 71-80) |
| 2  | Claude can filter node list by label or category using FIQL | VERIFIED | `params._s = filter` at line 173; FIQL filter param wired to `/api/v2/nodes` |
| 3  | Claude can retrieve a specific node by numeric ID and see full details | VERIFIED | `get_node` tool at line 195; `formatNodeDetail` renders all 13 fields (lines 83-100) |
| 4  | Claude can retrieve a specific node by foreignSource:foreignId format | VERIFIED | `get_node` accepts string `id`, passes directly to `client.v2.get(\`/nodes/${id}\`)` at line 205; v2 resolves both formats |
| 5  | Claude can list all IP interfaces for a node and see IP address, hostname, managed status, and SNMP primary flag | VERIFIED | `get_node_ip_interfaces` tool at line 215; `formatIpInterface` renders IP, hostname, managed, SNMP primary, ifIndex (lines 103-115) |
| 6  | Claude can list all SNMP interfaces for a node and see ifIndex, ifDescr, ifName, admin/oper status | VERIFIED | `get_node_snmp_interfaces` tool at line 244; `formatSnmpInterface` renders ifIndex, name, descr, alias, admin/oper status, MAC (lines 118-131) |
| 7  | Empty results return a user-friendly message, not an error | VERIFIED | 204/empty guards present in all three list tools (lines 178, 228, 257); outage empty guard at line 300 |
| 8  | Claude can list active and resolved outages for a node given numeric ID | VERIFIED | `get_node_outages` tool at line 275; calls `client.v1.get(\`/outages/forNode/${numericId}\`)` at line 297 |
| 9  | Claude can list outages for a node given foreignSource:foreignId (server resolves numeric ID first) | VERIFIED | Lines 288-293: regex check `/^\d+$/`, if not numeric resolves via `client.v2.get(\`/nodes/${id}\`)`, uses returned `node.id` as numericId |
| 10 | Each outage shows outage ID, node label, IP, time lost, time regained or Active | VERIFIED | `formatOutage` at lines 134-150: renders outage ID, node label, IP, lost timestamp, regained timestamp or "Active (not yet regained)" |
| 11 | Claude can trigger a rescan of a node by numeric ID or foreignSource:foreignId and receive confirmation | VERIFIED | `rescan_node` tool at line 320; `client.v2.put(\`/nodes/${id}/rescan\`, body)` at line 334; returns confirmation string; resp.data NOT accessed |
| 12 | Rescan accepts both numeric ID and foreignSource:foreignId (v2 PUT handles both) | VERIFIED | `id` is passed directly to the v2 PUT path without pre-resolution; v2 resolves both formats natively |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tools/nodes.ts` | NodeDTO, IpInterfaceDTO, SnmpInterfaceDTO, OutageDTO interfaces; formatters; registerNodeTools() with 6 tools | VERIFIED | File exists, 344 lines, all interfaces present (lines 8-68), all formatters present (lines 71-150), 6 server.tool() registrations confirmed |
| `src/index.ts` | registerNodeTools imported and called after registerAlarmTools, before server_info | VERIFIED | Import at line 6; call at line 42 (Step 6); server_info at Step 7 (line 44+); correct ordering maintained |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/index.ts` | `src/tools/nodes.ts` | `import { registerNodeTools } from './tools/nodes.js'` | WIRED | Line 6: import present; line 42: `registerNodeTools(server, client, config)` called |
| `list_nodes` | `/api/v2/nodes` | `client.v2.get('/nodes', { params })` | WIRED | Line 175: exact call present; params includes `_s` for FIQL filter (line 173) |
| `get_node_ip_interfaces` | `/api/v2/nodes/{id}/ipinterfaces` | `client.v2.get(\`/nodes/${id}/ipinterfaces\`)` | WIRED | Line 225: exact call present |
| `get_node_outages (foreignSource:foreignId path)` | `/api/v2/nodes/{id}` | `client.v2.get(\`/nodes/${nodeId}\`)` to resolve numeric ID | WIRED | Lines 290-293: regex guard then v2 resolution with result used as numericId |
| `get_node_outages` | `/opennms/rest/outages/forNode/{numericId}` | `client.v1.get(\`/outages/forNode/${numericId}\`)` | WIRED | Line 297: exact call present; uses resolved numericId |
| `rescan_node` | `/api/v2/nodes/{nodeCriteria}/rescan` | `client.v2.put(\`/nodes/${id}/rescan\`, new URLSearchParams())` | WIRED | Line 334: exact call present; URLSearchParams body used; resp.data not accessed after PUT |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| NODE-01 | 03-01-PLAN.md | User can list nodes, optionally filtered by label or category | SATISFIED | `list_nodes` tool with `filter` (FIQL) and `limit` params; `client.v2.get("/nodes", { params })` |
| NODE-02 | 03-01-PLAN.md | User can get a specific node by numeric ID or foreignSource:foreignId format | SATISFIED | `get_node` tool accepts string id; `client.v2.get(\`/nodes/${id}\`)` resolves both formats |
| NODE-03 | 03-01-PLAN.md | User can list IP interfaces for a node | SATISFIED | `get_node_ip_interfaces` tool; `client.v2.get(\`/nodes/${id}/ipinterfaces\`)` |
| NODE-04 | 03-01-PLAN.md | User can list SNMP interfaces for a node | SATISFIED | `get_node_snmp_interfaces` tool; `client.v2.get(\`/nodes/${id}/snmpinterfaces\`)` |
| NODE-05 | 03-02-PLAN.md | User can list outages for a node | SATISFIED | `get_node_outages` tool; v1 `client.v1.get(\`/outages/forNode/${numericId}\`)`; foreignSource:foreignId resolved first |
| NODE-06 | 03-02-PLAN.md | User can trigger a rescan of a node | SATISFIED | `rescan_node` tool; `client.v2.put(\`/nodes/${id}/rescan\`, new URLSearchParams())` |

All 6 requirement IDs (NODE-01 through NODE-06) are claimed by plans in this phase and have verified implementations. No orphaned requirements detected for Phase 3.

### Anti-Patterns Found

No anti-patterns detected.

- No TODO/FIXME/placeholder comments in `src/tools/nodes.ts` or `src/index.ts`
- No empty implementations (`return null`, `return {}`, `return []`, stub arrow functions)
- No handlers that only log or only call `preventDefault()`
- All 6 tools have real async implementations with try/catch error handling
- `rescan_node` correctly avoids accessing `resp.data` after the PUT (empty 200 response)

### Human Verification Required

#### 1. FIQL wildcard filtering end-to-end

**Test:** Ask Claude to "list nodes where label starts with web" and verify it sends `label==web*` as FIQL and returns matching nodes.
**Expected:** Nodes with labels beginning with "web" are returned; no URL double-encoding artifacts.
**Why human:** Requires a live OpenNMS instance to confirm the FIQL expression reaches the server correctly.

#### 2. foreignSource:foreignId resolution in get_node_outages

**Test:** Ask Claude to list outages for a node using its foreignSource:foreignId (e.g., "MySource:server-001").
**Expected:** The tool resolves to a numeric ID via v2, then queries v1 outages endpoint, and returns outage records or "No outages found."
**Why human:** The two-step API call chain (v2 node lookup then v1 outage query) requires a live instance to confirm both steps succeed and the resolved ID is valid.

#### 3. rescan_node confirmation behavior

**Test:** Ask Claude to rescan a specific node by foreignSource:foreignId.
**Expected:** Claude responds with the confirmation message "Rescan triggered for node X. OpenNMS will re-detect services and interfaces shortly." without errors.
**Why human:** Requires a live OpenNMS instance to confirm the v2 PUT returns HTTP 200 and the tool handles the empty response body correctly.

### Gaps Summary

No gaps. All 12 observable truths are fully verified, all 6 requirement IDs are implemented and wired, both artifacts exist with substantive implementations, all 6 key links are confirmed in the source code, TypeScript compiles without errors (`npx tsc --noEmit` exits 0), and all 4 commits documented in the SUMMARYs exist in git history.

The three human verification items above are normal operational tests that require a live OpenNMS instance — they do not indicate implementation defects.

---

_Verified: 2026-03-03_
_Verifier: Claude (gsd-verifier)_
