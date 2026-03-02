# Project Research Summary

**Project:** OpenNMS MCP Server
**Domain:** Network operations / AI tooling integration (MCP server)
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

The OpenNMS MCP Server is a stdio-based Model Context Protocol server that bridges Claude (and other LLM clients) to the OpenNMS network management platform. The pattern is well-established: a thin TypeScript process receives JSON-RPC tool calls over stdin, translates them to HTTP requests against the OpenNMS REST API, and returns human-readable results over stdout. The official MCP TypeScript SDK handles all protocol framing; the project is primarily about mapping OpenNMS domain concepts (alarms, nodes, events, assets, categories, collection config) into clean, ergonomic tool definitions that Claude can invoke without ambiguity.

The recommended approach is a layered architecture: a central config loader and axios-based OpenNMS client form the foundation, with domain-specific tool modules registered on top. Build order follows data dependencies — alarms first (highest operational value, validates the scaffold), then nodes (required by assets and categories), then events, then the remaining domains. The v1/v2 API split in OpenNMS is a concrete complexity that must be managed in the client layer from day one: reads often use v2 (FIQL filtering), writes use v1 (form-encoded or XML bodies).

The primary risk category is stdio pollution: any write to stdout — from debug logging, unhandled promise rejections, or library output — silently corrupts the MCP protocol stream, causing cryptic failures in Claude CLI. This must be addressed in Phase 1 and never regressed. A secondary risk cluster is OpenNMS API quirks: mixed content-type requirements per endpoint, proactive auth (no 401 challenge), XML-default responses, and the read-v2/write-v1 routing split. All of these are well-documented and preventable with correct client implementation.

## Key Findings

### Recommended Stack

The stack is lean and appropriate for a Node.js CLI tool. Node.js 20+ LTS with TypeScript 5.x provides the runtime; the official `@modelcontextprotocol/sdk` handles MCP protocol framing and tool registration with zod schema support. Axios is preferred over native fetch for its interceptor model, which enables clean auth header injection across all requests. No bundler is needed — tsc compiles to `dist/`, tsx handles development iteration. See [STACK.md](.planning/research/STACK.md) for full details.

**Core technologies:**
- Node.js 20+ LTS: runtime — required by MCP SDK, LTS ensures stability
- TypeScript 5.x: language — type safety for API shapes, essential for maintainability
- @modelcontextprotocol/sdk ^1.x: MCP framework — official SDK, provides Server, StdioServerTransport, tool registration
- axios ^1.x: HTTP client — interceptors for auth injection, better error objects than fetch
- zod ^3.x: schema validation — MCP SDK accepts zod schemas directly for tool parameters

### Expected Features

The feature set covers 6 domains with a clear build order. All individual tool operations are low-to-medium complexity; the differentiating features (smart summaries, node health overview, bulk acknowledge) add value on top. See [FEATURES.md](.planning/research/FEATURES.md) for the full feature table.

**Must have (table stakes):**
- Alarm tools (list, get, acknowledge, unacknowledge, clear, escalate) — core network ops workflow
- Node tools (list, get, interfaces, outages, rescan) — foundation for most other domains
- Event tools (list, send) — trigger and observe OpenNMS events
- Asset tools (get, update) — node metadata management
- Category tools (list, get, add, remove) — node grouping
- Collection config tools (list services, enable/disable collection) — monitoring control

**Should have (differentiators):**
- `summarize_alarms` — count by severity/node, surface top offenders without overwhelming Claude
- Node health overview — combine alarms + outages + availability in one call
- Bulk acknowledge — acknowledge all alarms matching a filter in one tool call
- Human-readable FIQL helper — accept plain filter params, not raw FIQL strings

**Defer (v2+):**
- Provisioning/requisitions — complex enough to be a separate project
- Performance data (RRD graphs) — binary data, not useful in text MCP responses
- Real-time event streaming — MCP is request/response, not push
- User/group management — low operational value for network ops
- Flow analytics — requires a different data pipeline

### Architecture Approach

The architecture is a clean 4-layer stack: config loader → OpenNMS HTTP client → domain tool modules → MCP server entry point. Domain modules each export a `registerXxxTools(client, server)` function, keeping the entry point simple and modules independently testable. The client layer handles all auth complexity (basic vs. token auto-detection, proactive auth header injection, Accept header defaulting, v1/v2 URL routing). Error handling is centralized in the client with human-readable messages rather than raw HTTP errors. See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for component diagrams and code patterns.

**Major components:**
1. Config Loader (config.ts) — reads JSON from OPENNMS_CONFIG env var, validates fields, auto-detects auth type
2. OpenNMS Client (client.ts) — axios instance with auth interceptor, v1/v2 routing, Accept header defaults
3. Tool Modules (tools/*.ts) — domain-specific handlers: alarms, nodes, events, assets, categories, collection
4. MCP Server Entry Point (index.ts) — creates Server, registers all tools, starts StdioServerTransport

### Critical Pitfalls

See [PITFALLS.md](.planning/research/PITFALLS.md) for the full list. The top issues that must be addressed proactively:

1. **Stdout pollution (CRITICAL)** — Any write to stdout corrupts the MCP JSON-RPC stream. Use console.error only; install a global unhandledRejection handler writing to stderr. Must be correct from Phase 1 and never regressed.
2. **Mixed content-type per endpoint** — GET needs `Accept: application/json`; POST to /events needs `Content-Type: application/xml`; PUT to /alarms needs `application/x-www-form-urlencoded`; PUT to /assetRecord needs `application/xml`. Set Accept globally, override Content-Type per operation.
3. **Read v2, write v1 for alarms** — v2 supports FIQL for reads; write operations (ack, clear, escalate) must use v1. Routing must be correct in the client.
4. **Asset record PUT replaces entire record** — GET current record, merge changes, then PUT the complete object. Never PUT partial asset data.
5. **Proactive auth required** — OpenNMS does not issue WWW-Authenticate challenges. The Authorization header must be sent on every request from the start, not on retry.

Secondary pitfalls to handle in Phase 1: ESM/CJS configuration (`"type": "module"` + NodeNext), shebang for CLI execution, self-signed SSL support (optional `insecure: true` config), and URL path confusion (user config provides base URL only; client appends `/opennms/rest/` or `/opennms/api/v2/`).

## Implications for Roadmap

Research strongly indicates a 5-phase structure following domain dependencies.

### Phase 1: Foundation (Config, Client, MCP Scaffold)

**Rationale:** Everything else depends on this. Stdout safety, ESM config, auth, and client error handling are cross-cutting concerns that must be correct before any domain tool is written.
**Delivers:** A working MCP server that Claude CLI can connect to, a tested OpenNMS HTTP client, config loading with auth auto-detection.
**Addresses:** No domain features yet — this phase is infrastructure only.
**Avoids:** Stdout pollution (CRITICAL), ESM/CJS confusion, proactive auth failure, self-signed SSL errors, URL path confusion, missing shebang.

### Phase 2: Alarms Domain

**Rationale:** Highest operational value. Validates the tool registration pattern end-to-end. Alarm ack/clear/escalate exercises the v1/v2 routing split immediately, surfacing any client layer issues.
**Delivers:** list_alarms, get_alarm, acknowledge_alarm, unacknowledge_alarm, clear_alarm, escalate_alarm, and summarize_alarms differentiator.
**Uses:** v2 for reads (FIQL filtering), v1 for writes (form-encoded).
**Avoids:** FIQL encoding errors, v2 write 404s, pagination gaps (default to 25-50 results with exposed limit/offset params), raw JSON blobs to Claude (format as structured text).

### Phase 3: Nodes Domain

**Rationale:** Nodes are a dependency for Assets, Categories, and Collection. Building this before those domains unblocks Phase 4 and 5.
**Delivers:** list_nodes, get_node, list_node_ip_interfaces, list_node_snmp_interfaces, get_node_outages, rescan_node.
**Avoids:** Node ID vs foreignSource:foreignId confusion (accept both formats, pass through directly).

### Phase 4: Events + Assets + Categories

**Rationale:** Events are independent of Nodes and can be built in parallel; Assets and Categories both require Node IDs. Group together as the "secondary domains" batch.
**Delivers:** list_events, send_event (XML POST), get_node_assets, update_node_assets (GET-then-PUT pattern), list_categories, get_node_categories, add_node_category, remove_node_category.
**Avoids:** XML content-type for events and assets PUT, asset record replacement bug (GET-merge-PUT), XML default response parsing.

### Phase 5: Collection Config + Differentiating Features

**Rationale:** Collection config depends on both Nodes and IP Interfaces (Phase 3). Differentiating features (node health overview, bulk acknowledge) require alarms and nodes to be complete.
**Delivers:** list_node_services, enable_collection, disable_collection, node health overview tool, bulk acknowledge tool.
**Uses:** Nodes and IP interface tools from Phase 3, alarms from Phase 2.

### Phase Ordering Rationale

- Foundation-first avoids the most severe failure modes (stdout corruption, auth) before any domain work begins.
- Alarms second delivers user-visible value immediately and validates the full call chain.
- Nodes third unblocks all remaining domains that require node ID resolution.
- Batching Events + Assets + Categories into Phase 4 keeps the roadmap to 5 phases without creating artificial dependencies.
- Differentiating features last ensures they compose from completed domain tools rather than partially implemented ones.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Alarms):** FIQL query construction and encoding edge cases may need hands-on API testing. The exact form-encoded field names for ack/clear/escalate PUT operations should be verified against a live OpenNMS instance.
- **Phase 5 (Collection Config):** The enable/disable collection API was flagged in FEATURES.md as "need to verify API" — this needs validation before implementation begins.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** MCP SDK stdio setup, axios interceptors, ESM config, and auth patterns are all well-documented with high confidence.
- **Phase 3 (Nodes):** Standard v1 REST CRUD, node ID handling is documented.
- **Phase 4 (Events + Assets + Categories):** XML content-type handling and asset GET-merge-PUT are known patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official SDK docs, well-known libraries, no novel choices |
| Features | HIGH | Domain is well-understood; OpenNMS REST API is documented |
| Architecture | HIGH | Standard MCP server pattern, clear component boundaries |
| Pitfalls | HIGH | Pitfalls are specific and actionable; most are API-contract facts, not speculation |

**Overall confidence:** HIGH

### Gaps to Address

- **Collection config API:** The exact endpoints and request format for enabling/disabling collection were not fully verified. Flag for Phase 5 planning with a research-phase step before implementation.
- **FIQL encoding edge cases:** While FIQL basics are documented, complex filter combinations (multiple conditions, special characters in node labels) should be tested against a real OpenNMS instance during Phase 2.
- **OpenNMS version compatibility:** Research assumes a modern OpenNMS release (Horizon 29+ or Meridian equivalent). Older deployments may have different API behavior, especially for v2 endpoints. The config file could include an optional `version` field to guard against this.

## Sources

### Primary (HIGH confidence)
- @modelcontextprotocol/sdk official documentation — MCP Server, StdioServerTransport, tool registration patterns
- OpenNMS REST API documentation — endpoint paths, v1/v2 split, content-type requirements
- axios documentation — interceptors, default headers, error handling

### Secondary (MEDIUM confidence)
- OpenNMS community resources — FIQL query construction, alarm write operation field names
- Node.js ESM documentation — "type": "module", NodeNext module resolution

### Tertiary (LOW confidence)
- Collection config enable/disable API — flagged as unverified; needs hands-on testing against a live instance

---
*Research completed: 2026-03-02*
*Ready for roadmap: yes*
