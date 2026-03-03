---
phase: 05-collection-config
plan: 01
subsystem: collection-config
tags: [collection, monitoring, services, mcp-tools]
dependency_graph:
  requires: [src/client.ts, src/config.ts]
  provides: [src/tools/collection.ts]
  affects: [src/index.ts]
tech_stack:
  added: []
  patterns: [URLSearchParams-form-body, encodeURIComponent-path, singular-array-key]
key_files:
  created: [src/tools/collection.ts]
  modified: [src/index.ts]
decisions:
  - "status=A for enable_service_collection (Managed), status=F for disable_service_collection (Forced Unmanaged)"
  - "URLSearchParams body for PUT — axios auto-sets Content-Type: application/x-www-form-urlencoded, preventing HTTP 415"
  - "encodeURIComponent applied to ipAddress in all 3 tools and serviceName in enable/disable"
  - "resp.data?.service (singular) for list response — @JsonProperty('service') in OnmsMonitoredServiceList.java"
  - "No resp.data access after PUT — v1 returns 204 No Content (changed) or 304 Not Modified (already set)"
  - "serviceType?.name ?? '(unknown)' defensive fallback — MEDIUM confidence field from Java source"
metrics:
  duration: 2 min
  completed: "2026-03-03"
  tasks_completed: 2
  files_changed: 2
---

# Phase 05 Plan 01: Collection Config Tools Summary

Three collection config tools implemented and wired into the MCP server, completing the Phase 5 v1 toolset.

## What Was Built

- `src/tools/collection.ts` (new): `registerCollectionTools()` exporting 3 MCP tools
  - `list_node_services`: GET `/nodes/{nodeId}/ipinterfaces/{encodedIp}/services` — lists all monitored services on an IP interface with name, status code, human-readable label, and down flag
  - `enable_service_collection`: PUT with `status=A` (Managed/Active) — enables collection for a named service
  - `disable_service_collection`: PUT with `status=F` (Forced Unmanaged) — disables collection for a named service
- `src/index.ts` (modified): import + Step 9 registration call added; server_info renumbered to Step 10, transport connect to Step 11

## Key Implementation Decisions

| Decision | Rationale |
|---|---|
| `status=A` for enable, `status=F` for disable | OnmsMonitoredService.java status codes: A=Managed (collecting), F=Forced Unmanaged |
| `URLSearchParams` as PUT body | v1 endpoint `@Consumes(FORM_URLENCODED)`; JSON body returns HTTP 415 |
| `encodeURIComponent(ipAddress)` in all 3 paths | IP addresses with colons (IPv6) or other chars would cause routing failures |
| `encodeURIComponent(serviceName)` in enable/disable | Service names can contain spaces or special characters |
| `resp.data?.service` (singular key) | `@JsonProperty("service")` in `OnmsMonitoredServiceList.java` |
| No `resp.data` after PUT | v1 returns 204 No Content (changed) or 304 Not Modified (already set) — both success |
| `serviceType?.name ?? "(unknown)"` | MEDIUM confidence JSON field — defensive fallback prevents null display |

## Verification Results

- `npx tsc --noEmit`: zero errors
- `npm run build`: succeeded; `dist/tools/collection.js` produced
- `grep registerCollectionTools src/index.ts`: shows import line and call line

## Deviations from Plan

None — plan executed exactly as written.

## Phase 5 Completion

Phase 5 is complete. All 3 collection config tools are implemented and registered. The v1 OpenNMS MCP toolset is complete.

**Total tools across all phases:** 23 tools
- Phase 2 (Alarms): list_alarms, get_alarm, acknowledge_alarm, modify_alarm (4)
- Phase 3 (Nodes): list_nodes, get_node, get_node_ip_interfaces, get_node_snmp_interfaces, get_node_outages, rescan_node (6)
- Phase 4 (Events/Assets/Categories): list_events, get_event, send_event, get_node_assets, update_node_assets, list_categories, get_node_categories, add_category_to_node, remove_category_from_node (9)
- Phase 5 (Collection Config): list_node_services, enable_service_collection, disable_service_collection (3)
- Plus: server_info (1)
