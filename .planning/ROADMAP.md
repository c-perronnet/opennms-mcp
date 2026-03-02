# Roadmap: OpenNMS MCP Server

## Overview

Five phases, foundation-first. Phase 1 builds the infrastructure every other phase depends on — stdout-safe MCP scaffold, config loading, and a tested OpenNMS HTTP client. Alarms ship second because they deliver the highest operational value and exercise the full v1/v2 routing split. Nodes ship third because assets, categories, and collection config all need node IDs. Phase 4 batches the remaining read/write domains together. Phase 5 completes collection config and adds cross-domain composites that require both alarms and nodes to exist.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Config loading, HTTP client, and stdout-safe MCP scaffold connected to Claude CLI
- [ ] **Phase 2: Alarms** - Full alarm read/write tool suite with FIQL filtering over OpenNMS REST v1/v2
- [ ] **Phase 3: Nodes** - Node discovery, interface listing, outage retrieval, and rescan over REST v1
- [ ] **Phase 4: Events, Assets, and Categories** - Event send/list, asset GET-merge-PUT, category assignment on nodes
- [ ] **Phase 5: Collection Config** - Enable/disable monitoring collection per service on a node interface

## Phase Details

### Phase 1: Foundation
**Goal**: Claude CLI can connect to the MCP server and reach OpenNMS with correct auth; all error paths return readable messages
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07, FOUND-08
**Success Criteria** (what must be TRUE):
  1. Claude CLI starts the server with a valid config file and registers as connected with no errors
  2. Claude CLI receives a clear error when the config file is missing, malformed, or has unknown fields
  3. Claude CLI receives a clear error when OpenNMS is unreachable (network timeout or DNS failure)
  4. Claude CLI receives a clear error when credentials are wrong (401/403 response)
  5. The server accepts both basic auth (username/password) and token auth configs without extra configuration
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Project init: package.json, tsconfig.json, src/config.ts with Zod validation
- [x] 01-02-PLAN.md — HTTP client + MCP server entry point: src/client.ts, src/index.ts (gap closure)

### Phase 2: Alarms
**Goal**: Claude can read, filter, and act on alarms (acknowledge, unacknowledge, clear, escalate) via natural language
**Depends on**: Phase 1
**Requirements**: ALARM-01, ALARM-02, ALARM-03, ALARM-04, ALARM-05, ALARM-06, ALARM-07, ALARM-08
**Success Criteria** (what must be TRUE):
  1. Claude can list alarms with optional FIQL filter and see ID, severity, node label, description, time, and ack status for each
  2. Claude can get a single alarm by ID and see full details
  3. Claude can acknowledge, unacknowledge, clear, and escalate an alarm by ID and receive confirmation
  4. Claude can control how many alarms are returned (default 25, user-overridable)
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — Read tools: src/tools/alarms.ts (list_alarms, get_alarm, AlarmDTO types, formatters) + wire into src/index.ts
- [ ] 02-02-PLAN.md — Mutation tools: acknowledge_alarm + modify_alarm (unack/clear/escalate) added to src/tools/alarms.ts

### Phase 3: Nodes
**Goal**: Claude can discover and inspect nodes — interfaces, outages, and rescan — to support any node-centric workflow
**Depends on**: Phase 1
**Requirements**: NODE-01, NODE-02, NODE-03, NODE-04, NODE-05, NODE-06
**Success Criteria** (what must be TRUE):
  1. Claude can list nodes filtered by label or category and see node details
  2. Claude can get a specific node by numeric ID or by foreignSource:foreignId format
  3. Claude can list IP interfaces and SNMP interfaces for a node
  4. Claude can list active outages for a node and trigger a rescan
**Plans**: TBD

### Phase 4: Events, Assets, and Categories
**Goal**: Claude can send and inspect events, read and update node asset records, and manage node category membership
**Depends on**: Phase 3
**Requirements**: EVENT-01, EVENT-02, EVENT-03, ASSET-01, ASSET-02, CAT-01, CAT-02, CAT-03, CAT-04
**Success Criteria** (what must be TRUE):
  1. Claude can list events filtered by node, UEI, or severity and get a specific event by ID
  2. Claude can send a custom event to OpenNMS by specifying UEI and optional parameters
  3. Claude can read the full asset record for a node and update one or more fields without clearing others
  4. Claude can list all categories in OpenNMS and see which categories a node belongs to
  5. Claude can assign and remove a category on a node by category name
**Plans**: TBD

### Phase 5: Collection Config
**Goal**: Claude can inspect monitored services on a node interface and enable or disable collection per service
**Depends on**: Phase 3
**Requirements**: COLL-01, COLL-02, COLL-03
**Success Criteria** (what must be TRUE):
  1. Claude can list the monitored services on a specific node IP interface
  2. Claude can enable collection on a service and receive confirmation that it is active
  3. Claude can disable collection on a service and receive confirmation that it is inactive
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete   | 2026-03-02 |
| 2. Alarms | 1/2 | In Progress|  |
| 3. Nodes | 0/? | Not started | - |
| 4. Events, Assets, Categories | 0/? | Not started | - |
| 5. Collection Config | 0/? | Not started | - |
