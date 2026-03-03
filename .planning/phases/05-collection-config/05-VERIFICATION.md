---
phase: 05-collection-config
verified: 2026-03-03T00:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 5: Collection Config Verification Report

**Phase Goal:** Claude can inspect monitored services on a node interface and enable or disable collection per service
**Verified:** 2026-03-03
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Claude can list monitored services on a node IP interface and see each service name and collection status | VERIFIED | `list_node_services` tool in `src/tools/collection.ts` lines 47-76: GET `/nodes/${nodeId}/ipinterfaces/${encodedIp}/services`, reads `resp.data?.service` (singular key), formats each entry with name + statusLong + statusCode + down flag |
| 2 | Claude can enable collection on a service and receive confirmation that it is now Active (A) | VERIFIED | `enable_service_collection` tool lines 81-109: PUT with `URLSearchParams({ status: "A" })`, returns confirmation string "Status set to Active (A)" |
| 3 | Claude can disable collection on a service and receive confirmation that it is now Forced Unmanaged (F) | VERIFIED | `disable_service_collection` tool lines 113-139: PUT with `URLSearchParams({ status: "F" })`, returns confirmation string "Status set to Forced Unmanaged (F)" |
| 4 | All three tools are registered and callable from Claude CLI via the MCP server | VERIFIED | `src/index.ts` line 9 imports `registerCollectionTools`; line 54 calls `registerCollectionTools(server, client, config)` as Step 9, before `server.connect()` at Step 11 |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tools/collection.ts` | `MonitoredServiceDTO` type, `formatService` helper, `registerCollectionTools()` exporting all three tools | VERIFIED | File exists, 142 lines, substantive implementation. Exports `registerCollectionTools`. All three tools present. `tsc --noEmit` passes. |
| `src/index.ts` | Wires `registerCollectionTools()` into server before `server.connect()` | VERIFIED | Line 9: import present. Line 54: `registerCollectionTools(server, client, config)` called as Step 9. `server.connect()` is Step 11. |
| `dist/tools/collection.js` | Built output from `npm run build` | VERIFIED | File exists at `dist/tools/collection.js` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/tools/collection.ts` | `client.v1 GET /nodes/{nodeId}/ipinterfaces/{ipAddress}/services` | `list_node_services` handler | VERIFIED | Line 61: `client.v1.get(\`/nodes/${nodeId}/ipinterfaces/${encodedIp}/services\`)` |
| `src/tools/collection.ts` | `client.v1 PUT /nodes/{nodeId}/ipinterfaces/{ipAddress}/services/{serviceName}` | `enable_service_collection` and `disable_service_collection` handlers | VERIFIED | Line 102: `client.v1.put(...)` with `status=A`; line 132: `client.v1.put(...)` with `status=F` |
| `src/index.ts` | `src/tools/collection.ts` | import + `registerCollectionTools(server, client, config)` | VERIFIED | Line 9: `import { registerCollectionTools } from "./tools/collection.js"`; line 54: call present |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| COLL-01 | 05-01-PLAN.md | User can list the monitored services on a node's IP interface | SATISFIED | `list_node_services` tool: GET v1 endpoint, `resp.data?.service` (singular), returns formatted list with name/status/down flag |
| COLL-02 | 05-01-PLAN.md | User can enable collection on a node's IP interface service | SATISFIED | `enable_service_collection` tool: PUT with `URLSearchParams({ status: "A" })`, `encodeURIComponent` on both ip and serviceName |
| COLL-03 | 05-01-PLAN.md | User can disable collection on a node's IP interface service | SATISFIED | `disable_service_collection` tool: PUT with `URLSearchParams({ status: "F" })`, `encodeURIComponent` on both ip and serviceName |

All three requirement IDs from the PLAN frontmatter are present in REQUIREMENTS.md and marked complete. No orphaned requirements found.

### Anti-Patterns Found

No anti-patterns detected.

- No TODO/FIXME/PLACEHOLDER comments in `src/tools/collection.ts`
- No `return null`, `return {}`, or `return []` stubs
- All three tools have substantive async handlers with real API calls

### Critical Invariant Verification

| Invariant | Required | Actual | Pass |
|-----------|----------|--------|------|
| `encodeURIComponent(ipAddress)` in all 3 tools | 3 occurrences | Lines 60, 97, 129 (3 total) | YES |
| `encodeURIComponent(serviceName)` in enable + disable | 2 occurrences | Lines 98, 130 (2 total) | YES |
| `URLSearchParams({ status: "A" })` for enable | Required | Line 101 confirmed | YES |
| `URLSearchParams({ status: "F" })` for disable | Required | Line 131 confirmed | YES |
| `resp.data?.service` (singular, not `services`) | Required | Line 64 confirmed | YES |
| No `resp.data` access after PUT calls | Required | Lines 102-104 and 132-134: `await put(...)` then immediate return, no data access | YES |
| `serviceType?.name ?? "(unknown)"` fallback | Required | Line 28 confirmed | YES |

### TypeScript Compilation

`npx tsc --noEmit` completed with zero errors.

### Human Verification Required

The following behaviors cannot be verified without a live OpenNMS instance:

**1. list_node_services returns real service data**
- Test: Call `list_node_services` with a valid node ID and IP address
- Expected: Service list showing names (e.g. "ICMP", "SNMP") with status codes ("A" or "F") and optional [DOWN] flag
- Why human: `serviceType.name` serialization in JSON response is MEDIUM confidence (no live response sample available); requires live server to confirm nested object is present

**2. enable/disable round-trip**
- Test: Disable a service with `disable_service_collection`, then list with `list_node_services`, then re-enable
- Expected: Status transitions from A to F and back to A; 204/304 responses both treated as success
- Why human: HTTP 304 "not modified" path cannot be exercised without a real server

### Gaps Summary

No gaps. All must-haves verified against actual codebase. Phase goal is achieved.

---

_Verified: 2026-03-03_
_Verifier: Claude (gsd-verifier)_
