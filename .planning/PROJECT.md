# OpenNMS MCP Server

## What This Is

An MCP (Model Context Protocol) server that exposes OpenNMS network monitoring capabilities as Claude-native tools. It connects to any OpenNMS instance via a user-provided JSON config file (URL + basic auth or API token) and enables Claude CLI to query and manage the network monitoring system through natural language.

## Core Value

Claude can read, triage, and act on OpenNMS data — alarms, nodes, events, assets, categories, and collection config — without the user needing to know REST API syntax.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Connect to OpenNMS via JSON config file (URL + basic auth or token, auto-detected)
- [ ] Alarms: list (with FIQL filtering), get by ID, acknowledge, unacknowledge, clear, escalate
- [ ] Events: list, get by ID, send custom event
- [ ] Nodes: list, get by ID, list IP interfaces, list SNMP interfaces, rescan
- [ ] Node categories: list categories, assign category to node, remove category from node
- [ ] Node assets: get asset record, update asset fields
- [ ] Collection config: list collection services on an interface, enable/disable collection on an interface
- [ ] Prefer REST API v2 endpoints (FIQL queries) where available, fall back to v1
- [ ] MCP stdio transport for Claude CLI integration
- [ ] Useful error messages when OpenNMS is unreachable or credentials are wrong

### Out of Scope

- GUI or web interface — CLI/MCP only
- OpenNMS provisioning/requisitions — complex enough for a separate tool
- Performance data graphing — read-only metrics retrieval deferred
- Multi-instance support — one instance per config file (v1)

## Context

- OpenNMS source code available at `opennms/` for API reference (docs at `opennms/docs/modules/development/pages/rest/`)
- REST v2 uses FIQL query syntax (`_s=` parameter) and lives at `/api/v2/`
- REST v1 lives at `/opennms/rest/` and uses query params
- MCP standard transport for Claude CLI is stdio (not HTTP)
- GitHub MCP is configured, allowing direct push from this session

## Constraints

- **Tech stack**: Node.js/TypeScript — standard for MCP servers, good SDK support
- **MCP SDK**: @modelcontextprotocol/sdk — official Anthropic SDK
- **Config**: JSON file path passed as CLI arg or env var; supports `{url, username, password}` or `{url, token}`
- **API preference**: v2 where available, v1 fallback — document which is used per tool

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | Better MCP SDK support, easier distribution via npm | — Pending |
| stdio transport | Required for Claude CLI integration | — Pending |
| Support both auth methods | Users may have token-based auth configured | — Pending |
| v2 API preferred | FIQL queries are more expressive for filtering | — Pending |

---
*Last updated: 2026-03-02 after initialization*
