# Requirements: OpenNMS MCP Server

**Defined:** 2026-03-02
**Core Value:** Claude can read, triage, and act on OpenNMS data — alarms, nodes, events, assets, categories, and collection config — without the user needing to know REST API syntax.

## v1 Requirements

### Foundation

- [x] **FOUND-01**: User can configure OpenNMS connection via a JSON file with URL and basic auth credentials (`username` + `password`)
- [x] **FOUND-02**: User can configure OpenNMS connection via a JSON file with URL and API token (`token`); auth type is auto-detected from config keys
- [x] **FOUND-03**: Config file path is provided via `OPENNMS_CONFIG` env var or positional CLI argument
- [ ] **FOUND-04**: Server starts and connects to Claude CLI via stdio transport
- [x] **FOUND-05**: User receives a clear error message when the config file is missing, malformed, or has invalid fields
- [ ] **FOUND-06**: User receives a clear error message when OpenNMS is unreachable (network error)
- [ ] **FOUND-07**: User receives a clear error message when credentials are invalid (401/403)
- [x] **FOUND-08**: Optional `insecure: true` config field disables TLS certificate verification for self-signed certs

### Alarms

- [ ] **ALARM-01**: User can list alarms, optionally filtered by FIQL expression (e.g. severity, node label, UEI)
- [ ] **ALARM-02**: User can get a specific alarm by ID
- [ ] **ALARM-03**: User can acknowledge an alarm by ID
- [ ] **ALARM-04**: User can unacknowledge an alarm by ID
- [ ] **ALARM-05**: User can clear an alarm by ID
- [ ] **ALARM-06**: User can escalate an alarm by ID
- [ ] **ALARM-07**: Alarm list results include: ID, severity, node label, description, time, ack status
- [ ] **ALARM-08**: User can control result limit (default 25) when listing alarms

### Events

- [ ] **EVENT-01**: User can list events, optionally filtered by node, UEI, or severity
- [ ] **EVENT-02**: User can get a specific event by ID
- [ ] **EVENT-03**: User can send a custom event to OpenNMS by specifying UEI and optional parameters (node ID, interface, description)

### Nodes

- [ ] **NODE-01**: User can list nodes, optionally filtered by label or category
- [ ] **NODE-02**: User can get a specific node by numeric ID or by `foreignSource:foreignId` format
- [ ] **NODE-03**: User can list IP interfaces for a node
- [ ] **NODE-04**: User can list SNMP interfaces for a node
- [ ] **NODE-05**: User can list outages for a node
- [ ] **NODE-06**: User can trigger a rescan of a node

### Assets

- [ ] **ASSET-01**: User can get the asset record for a node (all asset fields)
- [ ] **ASSET-02**: User can update one or more asset fields for a node without clearing other fields (GET-merge-PUT pattern)

### Categories

- [ ] **CAT-01**: User can list all categories defined in OpenNMS
- [ ] **CAT-02**: User can list the categories assigned to a specific node
- [ ] **CAT-03**: User can assign a category to a node by category name
- [ ] **CAT-04**: User can remove a category from a node by category name

### Collection Config

- [ ] **COLL-01**: User can list the monitored services on a node's IP interface
- [ ] **COLL-02**: User can enable collection on a node's IP interface service
- [ ] **COLL-03**: User can disable collection on a node's IP interface service

## v2 Requirements

### Differentiators (deferred to v2)

- **DIFF-01**: `summarize_alarms` tool — counts by severity and top offending nodes without overwhelming Claude
- **DIFF-02**: Node health overview tool — combines alarms + outages + availability in a single call
- **DIFF-03**: Bulk acknowledge — acknowledge all alarms matching a FIQL filter in one tool call
- **DIFF-04**: Human-readable filter helper — accept plain key/value params alongside FIQL expressions

### Extended Domains (deferred)

- **EXT-01**: Provisioning/requisitions management
- **EXT-02**: Scheduled outages management
- **EXT-03**: User and group management

## Out of Scope

| Feature | Reason |
|---------|--------|
| Performance data / RRD graphs | Binary/chart data not useful in text MCP responses |
| Real-time event streaming | MCP is request/response, not push |
| Flow analytics | Requires a separate data pipeline |
| Web UI / HTTP transport | Claude CLI requires stdio; no GUI needed |
| Multi-instance support | One config file = one OpenNMS instance; v1 scope |
| npm publish / npx zero-install | Clone-and-build is sufficient for v1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Pending |
| FOUND-05 | Phase 1 | Complete |
| FOUND-06 | Phase 1 | Pending |
| FOUND-07 | Phase 1 | Pending |
| FOUND-08 | Phase 1 | Complete |
| ALARM-01 | Phase 2 | Pending |
| ALARM-02 | Phase 2 | Pending |
| ALARM-03 | Phase 2 | Pending |
| ALARM-04 | Phase 2 | Pending |
| ALARM-05 | Phase 2 | Pending |
| ALARM-06 | Phase 2 | Pending |
| ALARM-07 | Phase 2 | Pending |
| ALARM-08 | Phase 2 | Pending |
| EVENT-01 | Phase 4 | Pending |
| EVENT-02 | Phase 4 | Pending |
| EVENT-03 | Phase 4 | Pending |
| NODE-01 | Phase 3 | Pending |
| NODE-02 | Phase 3 | Pending |
| NODE-03 | Phase 3 | Pending |
| NODE-04 | Phase 3 | Pending |
| NODE-05 | Phase 3 | Pending |
| NODE-06 | Phase 3 | Pending |
| ASSET-01 | Phase 4 | Pending |
| ASSET-02 | Phase 4 | Pending |
| CAT-01 | Phase 4 | Pending |
| CAT-02 | Phase 4 | Pending |
| CAT-03 | Phase 4 | Pending |
| CAT-04 | Phase 4 | Pending |
| COLL-01 | Phase 5 | Pending |
| COLL-02 | Phase 5 | Pending |
| COLL-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after initial definition*
