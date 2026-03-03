# Phase 4: Events, Assets, and Categories - Research

**Researched:** 2026-03-03
**Domain:** OpenNMS Events REST API (v1 + v2), Asset Record API (v1), Category API (v1)
**Confidence:** HIGH — primary sources are Java source files in the repo, official REST docs in the repo, and UI TypeScript service files in the repo

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EVENT-01 | User can list events, optionally filtered by node, UEI, or severity | v2 GET `/api/v2/events?_s=<fiql>` confirmed; FIQL fields `eventUei==`, `node.id==`, `eventSeverity==` documented; envelope key `"event"` confirmed from `EventCollectionDTO.java` |
| EVENT-02 | User can get a specific event by ID | v2 GET `/api/v2/events/{id}` confirmed from `EventRestApi.java`; returns single `EventDTO`; 404 on miss |
| EVENT-03 | User can send a custom event to OpenNMS by specifying UEI and optional parameters | v2 POST `/api/v2/events` with JSON body (accepts `application/json`); OR v1 POST `/opennms/rest/events` with XML/JSON; both confirmed from Java source; v2 preferred (returns 204 on success); Event XML/JSON model fields documented |
| ASSET-01 | User can get the asset record for a node (all asset fields) | v1 GET `/opennms/rest/nodes/{nodeCriteria}/assetRecord`; path sub-resource via `NodeRestService.getAssetRecordResource()`; accepts numeric ID and foreignSource:foreignId; full asset field list from `OnmsAssetRecord.java` |
| ASSET-02 | User can update one or more asset fields without clearing others (GET-merge-PUT pattern) | v1 PUT `/opennms/rest/nodes/{nodeCriteria}/assetRecord` with `application/x-www-form-urlencoded`; Spring `BeanWrapper` applies only the fields in the form body — non-submitted fields are UNTOUCHED; no GET-merge-PUT needed — the API already does field-level merge |
| CAT-01 | User can list all categories defined in OpenNMS | v1 GET `/opennms/rest/categories` → `OnmsCategoryCollection`; array key is `"category"` (singular); fields: `id`, `name`, `description` |
| CAT-02 | User can list the categories assigned to a specific node | v1 GET `/opennms/rest/nodes/{nodeCriteria}/categories` → `OnmsCategoryCollection`; same envelope; accepts numeric ID and foreignSource:foreignId |
| CAT-03 | User can assign a category to a node by category name | v1 **POST** `/opennms/rest/nodes/{nodeCriteria}/categories/{categoryName}` — NOT PUT; returns 201 Created; category must exist; assigns existing category to node |
| CAT-04 | User can remove a category from a node by category name | v1 DELETE `/opennms/rest/nodes/{nodeCriteria}/categories/{categoryName}`; returns 204 No Content |
</phase_requirements>

---

## Summary

Phase 4 implements nine requirements across three domains: events (read + send), asset records (read + update), and node categories (list-all, list-for-node, assign, remove). All APIs are on the v1 REST layer except event reads, which benefit from v2's FIQL filtering support.

The most important architectural discovery is around **category assignment**: the NodeRestService uses `@POST` (not `@PUT`) for adding a category to a node at `/{nodeCriteria}/categories/{categoryName}`. This is the inverse of what one might assume from the REQUIREMENTS.md description which says "PUT". The Java source is authoritative: `@POST @Path("/{nodeCriteria}/categories/{categoryName}")` → creates the association and returns HTTP 201. The CategoryRestService also has a `@PUT` for `/categories/{name}/nodes/{node}/` but it delegates to the same `addCategoryToNode` method — either path works, but the node-centric path (`/nodes/{id}/categories/{name}`) with POST is the canonical pattern used by the UI.

The second important discovery is around **asset record updates**: ASSET-02 describes a "GET-merge-PUT" pattern, but the actual Java implementation uses Spring `BeanWrapper.setPropertyValue()` to apply only the fields present in the form body. Existing fields not present in the PUT body are not touched. This means the partial update is handled server-side — no need to GET the record first and merge in the client. Simply PUT the fields to change as form parameters.

The third domain — **events** — mirrors the alarm read pattern closely. The v2 EventService uses FIQL, supports filtering by `eventUei`, `node.id`, and `eventSeverity`. Sending events uses `POST /api/v2/events` with a JSON body matching the `org.opennms.netmgt.xml.event.Event` schema.

**Primary recommendation:** Split into two plans: Plan 01 — events read/send + asset read/update; Plan 02 — categories (list-all, list-for-node, add, remove). All use the `registerXxxTools(server, client, config)` pattern established in previous phases.

---

## Standard Stack

### Core (all established in Phase 1 — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.27.1 | `server.tool()` registration for all new tools | Official MCP SDK; already installed |
| `axios` | 1.13.6 | HTTP client; `client.v2` for event reads, `client.v1` for all writes and asset/category ops | Already installed; established pattern |
| `zod` | ^3.25.0 | Input schema for tool args | Already installed; MCP SDK peer dep |

### No New Dependencies

Phase 4 requires no new npm packages. All functionality uses:
- `client.v2.get()` — list events, get event by ID (FIQL available)
- `client.v2.post()` — send event (v2 POST, JSON body)
- `client.v1.get()` — get asset record, list categories, list node categories
- `client.v1.put()` — update asset record (form-encoded)
- `client.v1.post()` — add category to node (NOT put — see critical finding below)
- `client.v1.delete()` — remove category from node

**Installation:** Nothing new to install.

---

## Architecture Patterns

### Recommended File Structure

```
src/
├── index.ts             # Existing; Phase 4: add registerEventTools(), registerCategoryTools()
├── config.ts            # Untouched
├── client.ts            # Untouched
└── tools/
    ├── alarms.ts        # Phase 2: existing
    ├── nodes.ts         # Phase 3: existing
    ├── events.ts        # Phase 4: EVENT-01, EVENT-02, EVENT-03, ASSET-01, ASSET-02
    └── categories.ts    # Phase 4: CAT-01, CAT-02, CAT-03, CAT-04
```

**Pattern:** `registerEventTools(server, client, config)` and `registerCategoryTools(server, client, config)` — exact same signature as previous phases. Both called in `index.ts` before `server.connect()`.

### Pattern 1: registerEventTools() Function

**What:** Registers event read tools and the send-event tool.
**When to use:** Called once in index.ts after server creation.

```typescript
// src/tools/events.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

export function registerEventTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {
  // Register: list_events, get_event, send_event, get_node_asset_record, update_node_asset_record
}
```

```typescript
// src/index.ts — add after registerNodeTools, before server.connect()
import { registerEventTools } from "./tools/events.js";
registerEventTools(server, client, config);
```

### Pattern 2: list_events Tool (v2 API, FIQL filter)

**What:** List events with optional FIQL filter. Default ordered newest-first (v2 EventRestService orders by `eventTime` desc).
**API:** GET `/api/v2/events?limit=N&_s=<fiql>`
**Response envelope:** `{ event: EventDTO[], totalCount: number, count: number, offset: number }` — array key is `"event"` (singular), confirmed from `EventCollectionDTO.java` `@JsonProperty("event")`.
**204 guard:** Required — same as alarms and nodes: v2 returns HTTP 204 No Content when no events match.

```typescript
// Source: opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/EventCollectionDTO.java
// @JsonProperty("event") — singular key confirmed

server.tool(
  "list_events",
  "List OpenNMS events. Optionally filter with a FIQL expression. Examples: 'eventUei==uei.opennms.org/nodes/nodeDown', 'node.id==42', 'eventSeverity==6' (6=CRITICAL). Returns most recent events first. Use limit to control result count.",
  {
    filter: z.string().optional().describe(
      "FIQL filter. Examples: 'eventUei==uei.opennms.org/nodes/nodeDown', 'node.id==42', 'node.label==myserver', 'eventSeverity==6'. Omit for all events. Do NOT URL-encode."
    ),
    limit: z.number().int().min(1).max(1000).default(25).describe(
      "Maximum number of events to return (default 25, max 1000)."
    ),
  },
  async ({ filter, limit }) => {
    try {
      const params: Record<string, string | number> = { limit };
      if (filter) params._s = filter;
      const resp = await client.v2.get("/events", { params });

      // v2 returns HTTP 204 No Content when no events match
      if (resp.status === 204 || !resp.data?.event?.length) {
        return { content: [{ type: "text", text: "No events found matching the given filter." }] };
      }

      const events = resp.data.event as EventDTO[];
      const totalCount: number = resp.data.totalCount ?? events.length;
      const lines = events.map(formatEventSummary);
      const header = `Events: ${events.length} of ${totalCount} total`;
      return { content: [{ type: "text", text: [header, "", ...lines].join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, "list events") }], isError: true };
    }
  }
);
```

### Pattern 3: get_event Tool (v2 API, by ID)

**What:** Get a single event by numeric ID with full details.
**API:** GET `/api/v2/events/{id}`
**Note:** EventDTO `id` field is `@XmlAttribute(name="id")` typed as `Integer` (not string, unlike NodeDTO). Pass as number.

```typescript
// Source: opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/EventDTO.java
// @XmlAttribute(name="id") private Integer id — numeric ID, NOT string

server.tool(
  "get_event",
  "Get full details for a specific OpenNMS event by its numeric ID.",
  {
    id: z.number().int().positive().describe("The numeric ID of the event."),
  },
  async ({ id }) => {
    try {
      const resp = await client.v2.get(`/events/${id}`);
      const event = resp.data as EventDTO;
      return { content: [{ type: "text", text: formatEventDetail(event) }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `event ${id}`) }], isError: true };
    }
  }
);
```

### Pattern 4: send_event Tool (v2 POST, JSON body)

**What:** Send a custom event to the OpenNMS event bus.
**API:** POST `/api/v2/events` with `Content-Type: application/json`
**Response:** HTTP 204 No Content on success — do NOT parse `resp.data`.
**Required fields in body:** `uei` only. Optional: `nodeId`, `interface`, `descr`, `severity`.
**Source:** v2 `EventRestService.create(Event event)` returns `Response.noContent().build()` (204) after calling `sendEvent(event)`. Sets `source="ReST"` and `time=now` automatically if not provided.

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/EventRestService.java
// @POST @Consumes({APPLICATION_JSON, APPLICATION_XML}) — JSON accepted
// Calls sendEvent(event) and returns Response.noContent().build() (204)

server.tool(
  "send_event",
  "Send a custom event to the OpenNMS event bus. Only 'uei' is required. Optional: nodeId (numeric), interface (IP address), description. The source is set to 'ReST' automatically.",
  {
    uei: z.string().describe(
      "Event UEI (Unique Event Identifier). Example: 'uei.opennms.org/generic/traps/SNMP_Warm_Start' or a custom UEI like 'uei.opennms.org/internal/testing/testEvent'."
    ),
    nodeId: z.number().int().positive().optional().describe(
      "Numeric node ID to associate with the event. Optional."
    ),
    ipInterface: z.string().optional().describe(
      "IP interface address to associate with the event. Optional."
    ),
    description: z.string().optional().describe(
      "Event description text. Optional."
    ),
    severity: z.string().optional().describe(
      "Event severity: INDETERMINATE, CLEARED, NORMAL, WARNING, MINOR, MAJOR, or CRITICAL. Optional."
    ),
  },
  async ({ uei, nodeId, ipInterface, description, severity }) => {
    try {
      // Build the event JSON body matching org.opennms.netmgt.xml.event.Event schema
      const body: Record<string, unknown> = { uei };
      if (nodeId != null) body.nodeid = nodeId;          // field name: "nodeid" (lowercase)
      if (ipInterface) body.interface = ipInterface;     // field name: "interface"
      if (description) body.descr = description;         // field name: "descr" (not "description")
      if (severity) body.severity = severity;

      await client.v2.post("/events", body);
      // Returns HTTP 204 No Content on success — do NOT access resp.data
      return { content: [{ type: "text", text: `Event sent: ${uei}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `send event ${uei}`) }], isError: true };
    }
  }
);
```

### Pattern 5: Asset Record Get Tool (v1 REST, node sub-resource)

**What:** Get the full asset record for a node.
**API:** GET `/opennms/rest/nodes/{nodeCriteria}/assetRecord`
**Important:** This is a sub-resource path, rooted under `/opennms/rest/nodes`. The `NodeRestService.getAssetRecordResource()` delegates to `AssetRecordResource.getAssetRecord()`. Accepts numeric ID or foreignSource:foreignId.
**Response:** Single `OnmsAssetRecord` JSON object (not an array).

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/NodeRestService.java
// @Path("{nodeCriteria}/assetRecord") → delegates to AssetRecordResource
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/AssetRecordResource.java
// @GET @Produces({APPLICATION_XML, APPLICATION_JSON}) public OnmsAssetRecord getAssetRecord(...)

server.tool(
  "get_node_asset_record",
  "Get the full asset record for an OpenNMS node. Returns all asset fields (location, hardware, contact info, etc.). Accepts numeric node ID or 'foreignSource:foreignId' format.",
  {
    id: z.string().describe(
      "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
    ),
  },
  async ({ id }) => {
    try {
      const resp = await client.v1.get(`/nodes/${id}/assetRecord`);
      const asset = resp.data as AssetRecordDTO;
      return { content: [{ type: "text", text: formatAssetRecord(asset) }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `asset record for node ${id}`) }], isError: true };
    }
  }
);
```

### Pattern 6: Asset Record Update Tool (v1 REST, form-encoded PUT — field-level merge)

**What:** Update one or more asset fields without clearing others.
**API:** PUT `/opennms/rest/nodes/{nodeCriteria}/assetRecord` with `Content-Type: application/x-www-form-urlencoded`
**Critical finding:** The Java implementation uses Spring `BeanWrapper.setPropertyValue()` to apply ONLY the fields present in the PUT form body. Fields NOT submitted in the body are left unchanged on the server. This means **no GET-merge-PUT is needed** — the server handles partial update natively. Simply PUT only the fields to change.
**Response:** HTTP 204 No Content if any field was modified; HTTP 304 Not Modified if no writable fields were changed. Both are success cases — do not access `resp.data`.

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/AssetRecordResource.java
// BeanWrapper.setPropertyValue() only updates the fields present in MultivaluedMap params
// Non-submitted fields are untouched — partial update is server-side
// Returns: 204 No Content (modified) or 304 Not Modified (no matching writable fields)

server.tool(
  "update_node_asset_record",
  "Update one or more asset fields for an OpenNMS node without clearing other fields. Only the fields you provide will be changed. Accepts numeric node ID or 'foreignSource:foreignId'. Common fields: building, city, country, department, description, manufacturer, modelNumber, operatingSystem, serialNumber, cpu, ram, rack, slot, room, floor.",
  {
    id: z.string().describe(
      "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format."
    ),
    fields: z.record(z.string()).describe(
      "Key-value pairs of asset fields to update. Example: { building: 'HQ', city: 'New York', cpu: 'Intel Xeon' }. Only submitted fields are changed; others are untouched."
    ),
  },
  async ({ id, fields }) => {
    try {
      const body = new URLSearchParams(fields);
      // URLSearchParams causes axios to set Content-Type: application/x-www-form-urlencoded
      // The server applies only the submitted fields via BeanWrapper — no GET-merge-PUT needed
      await client.v1.put(`/nodes/${id}/assetRecord`, body);
      // Returns 204 (modified) or 304 (no change) — both are success; do not read resp.data
      const fieldNames = Object.keys(fields).join(", ");
      return { content: [{ type: "text", text: `Asset record updated for node ${id}. Fields changed: ${fieldNames}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `update asset record for node ${id}`) }], isError: true };
    }
  }
);
```

### Pattern 7: registerCategoryTools() Function

**What:** Registers all category MCP tools.
**When to use:** Called once in index.ts after registerEventTools.

```typescript
// src/tools/categories.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

export function registerCategoryTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {
  // Register: list_categories, get_node_categories, add_category_to_node, remove_category_from_node
}
```

```typescript
// src/index.ts
import { registerCategoryTools } from "./tools/categories.js";
registerCategoryTools(server, client, config);
```

### Pattern 8: list_categories Tool (v1 REST)

**What:** List all categories defined in OpenNMS.
**API:** GET `/opennms/rest/categories`
**Response:** `{ category: CategoryDTO[], totalCount: number, count: number, offset: number }` — array key is `"category"` (singular), confirmed from `OnmsCategoryCollection.java` `@JsonProperty("category")`.

```typescript
// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsCategoryCollection.java
// @JsonProperty("category") — singular key confirmed

server.tool(
  "list_categories",
  "List all categories defined in OpenNMS. Returns each category's ID, name, and description.",
  {},
  async () => {
    try {
      const resp = await client.v1.get("/categories");
      // v1 returns 200 with empty list (not 204) when no categories exist
      const categories = (resp.data?.category ?? []) as CategoryDTO[];
      if (categories.length === 0) {
        return { content: [{ type: "text", text: "No categories defined in OpenNMS." }] };
      }
      const lines = categories.map((c) => `ID: ${c.id}  Name: ${c.name}${c.description ? `  Description: ${c.description}` : ""}`);
      return { content: [{ type: "text", text: [`Categories: ${categories.length} total`, "", ...lines].join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, "list categories") }], isError: true };
    }
  }
);
```

### Pattern 9: get_node_categories Tool (v1 REST, node sub-resource)

**What:** List categories assigned to a specific node.
**API:** GET `/opennms/rest/nodes/{nodeCriteria}/categories`
**Response:** Same `OnmsCategoryCollection` envelope with `"category"` key (singular).
**Note:** Accepts numeric ID or foreignSource:foreignId (same as other v1 node sub-resources; `m_nodeDao.get(nodeCriteria)` handles both).

```typescript
server.tool(
  "get_node_categories",
  "List the categories assigned to a specific OpenNMS node. Accepts numeric node ID or 'foreignSource:foreignId' format.",
  {
    id: z.string().describe(
      "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
    ),
  },
  async ({ id }) => {
    try {
      const resp = await client.v1.get(`/nodes/${id}/categories`);
      const categories = (resp.data?.category ?? []) as CategoryDTO[];
      if (categories.length === 0) {
        return { content: [{ type: "text", text: `No categories assigned to node ${id}.` }] };
      }
      const lines = categories.map((c) => `${c.name}${c.description ? ` — ${c.description}` : ""}`);
      return { content: [{ type: "text", text: [`Categories for node ${id}: ${categories.length}`, "", ...lines].join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `categories for node ${id}`) }], isError: true };
    }
  }
);
```

### Pattern 10: add_category_to_node Tool (v1 REST, POST — NOT PUT)

**What:** Assign an existing category to a node by category name.
**API:** POST `/opennms/rest/nodes/{nodeCriteria}/categories/{categoryName}` — **POST not PUT**
**Response:** HTTP 201 Created on success; HTTP 400 Bad Request if category not found OR if already assigned.
**Critical:** The Java uses `@POST` annotation for this path in `NodeRestService`. The CategoryRestService `@PUT /categories/{name}/nodes/{node}/` also delegates to the same method, but the node-centric POST is the canonical pattern.

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/NodeRestService.java
// @POST @Path("/{nodeCriteria}/categories/{categoryName}")
// Returns 201 Created or 400 Bad Request (category not found OR already added)

server.tool(
  "add_category_to_node",
  "Assign an existing category to an OpenNMS node. The category must already exist in OpenNMS (use list_categories to find available categories). Returns an error if the category is already assigned to the node.",
  {
    nodeId: z.string().describe(
      "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format."
    ),
    categoryName: z.string().describe(
      "Name of the category to assign (e.g. 'Routers', 'Production'). The category must exist."
    ),
  },
  async ({ nodeId, categoryName }) => {
    try {
      await client.v1.post(`/nodes/${nodeId}/categories/${encodeURIComponent(categoryName)}`);
      // Returns 201 Created — no body to parse
      return { content: [{ type: "text", text: `Category '${categoryName}' assigned to node ${nodeId}.` }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `add category '${categoryName}' to node ${nodeId}`) }], isError: true };
    }
  }
);
```

### Pattern 11: remove_category_from_node Tool (v1 REST, DELETE)

**What:** Remove a category assignment from a node.
**API:** DELETE `/opennms/rest/nodes/{nodeCriteria}/categories/{categoryName}`
**Response:** HTTP 204 No Content on success; HTTP 400 if node not found or category not on node.

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/NodeRestService.java
// @DELETE @Path("/{nodeCriteria}/categories/{categoryName}")
// Returns 204 No Content

server.tool(
  "remove_category_from_node",
  "Remove a category from an OpenNMS node. Returns an error if the category is not currently assigned to the node.",
  {
    nodeId: z.string().describe(
      "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format."
    ),
    categoryName: z.string().describe(
      "Name of the category to remove (e.g. 'Routers'). Must currently be assigned to the node."
    ),
  },
  async ({ nodeId, categoryName }) => {
    try {
      await client.v1.delete(`/nodes/${nodeId}/categories/${encodeURIComponent(categoryName)}`);
      // Returns 204 No Content — do not access resp.data
      return { content: [{ type: "text", text: `Category '${categoryName}' removed from node ${nodeId}.` }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `remove category '${categoryName}' from node ${nodeId}`) }], isError: true };
    }
  }
);
```

### Anti-Patterns to Avoid

- **Using PUT for category assignment:** `NodeRestService` uses `@POST` at `/{nodeCriteria}/categories/{categoryName}` for adding a category. Using `client.v1.put()` will hit the `@PUT` method which updates category _fields_ (name/description), not the node membership — wrong behavior.
- **GET-merge-PUT for asset update:** The `AssetRecordResource.updateAssetRecord()` already does field-level partial update via Spring `BeanWrapper`. Only send the fields you want to change in the URLSearchParams. No pre-fetch needed.
- **Using v1 for event reads:** v1 event list has no FIQL support. Use `client.v2.get("/events")` for filtering by node, UEI, or severity.
- **Using v2 for asset/category operations:** Asset record and category endpoints are v1-only. All `AssetRecordResource` and `CategoryRestService` paths are under `/opennms/rest/`.
- **Using `"events"` or `"nodes.event"` as array key:** EventCollectionDTO uses `@JsonProperty("event")` — singular key. Same pattern as alarms, nodes, outages.
- **Not URL-encoding category names:** Category names with spaces or special characters must be URL-encoded in path segments. Use `encodeURIComponent(categoryName)`.
- **Accessing resp.data after send_event POST:** v2 POST `/events` returns HTTP 204 No Content — `resp.data` will be empty. Return a confirmation message based on the UEI sent.
- **Sending event body with wrong field names:** The Event XML schema uses `nodeid` (lowercase, no camelCase), `interface` (not `ipAddress`), `descr` (not `description`). These are from the JAXB `@XmlElement` annotations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Partial asset record update | GET full record, merge in JS, PUT full record | PUT with URLSearchParams containing only changed fields | Server BeanWrapper does partial merge natively — simpler and race-condition free |
| Event FIQL construction | Custom string builder for event filters | Pass user-supplied FIQL string directly | FIQL grammar is complex; v2 API handles it; same pattern as alarms |
| Category name encoding in URL | Manual string replacement | `encodeURIComponent(categoryName)` | Handles spaces, slashes, special chars in category names |
| Category existence check before assign | Pre-fetch GET to verify category exists | Let the server return 400 if not found | Server already validates; extra round trip not needed |
| Asset field enumeration | Hard-code field list in client | Accept `z.record(z.string())` from Claude | Claude knows the field names from context; server rejects unknown fields via BeanWrapper |

**Key insight:** The OpenNMS v1 REST API uses Spring's `BeanWrapper` for generic property setting, which is inherently a partial-update mechanism. Never replicate this with a GET-then-PUT pattern in the client.

---

## Common Pitfalls

### Pitfall 1: Using PUT instead of POST for Category Assignment

**What goes wrong:** `client.v1.put("/nodes/42/categories/Routers")` hits the `@PUT @Path("/{nodeCriteria}/categories/{categoryName}")` method in `NodeRestService`, which updates category _fields_ (name/description) via BeanWrapper — not the node membership. The category does NOT get added to the node, and there is no error response.

**Why it happens:** The REQUIREMENTS.md says "PUT /rest/nodes/{id}/categories/{name}" based on the intent, but the actual Java source uses POST for this path.

**How to avoid:** Use `client.v1.post()` for adding categories to nodes. The method signature in Java: `@POST @Path("/{nodeCriteria}/categories/{categoryName}")`.

**Warning signs:** No HTTP error, but repeated calls to `get_node_categories` show the category was never added.

### Pitfall 2: Asset Record Update Clearing Unset Fields

**What goes wrong:** Developer believes the v1 PUT replaces the entire asset record, so they pre-fetch the current record and merge all fields before sending. This is unnecessary and error-prone.

**Why it happens:** Misunderstanding of REST semantics — PUT is often full-replace, but OpenNMS uses BeanWrapper which is partial-update.

**How to avoid:** Send ONLY the fields to change as URLSearchParams. The Java source at `AssetRecordResource.updateAssetRecord()` proves only submitted keys are applied.

**Warning signs:** (Anti-pitfall): No warning signs if done correctly. Warning if hand-rolling GET-merge-PUT: concurrency issues if two clients update simultaneously.

### Pitfall 3: Wrong Field Names for send_event JSON Body

**What goes wrong:** Sending `{ uei: "...", nodeId: 42, description: "..." }` results in silent failure — the `nodeId` and `description` fields are ignored because the JAXB schema uses different field names.

**Why it happens:** The `Event.java` XML model uses `@XmlElement(name="nodeid")` (lowercase), `@XmlElement(name="interface")`, and `@XmlElement(name="descr")`. When deserializing JSON with `application/json` Content-Type, Jackson uses the same JAXB field names.

**How to avoid:**
- Node ID: `nodeid` (lowercase, no camelCase)
- IP interface: `interface`
- Description: `descr`
- Severity: `severity`
- Source: `source` (auto-set to "ReST" if omitted)

**Warning signs:** Event is received by OpenNMS but has no node association or description despite being set.

### Pitfall 4: Treating 304 Not Modified as Error in Asset Update

**What goes wrong:** `AssetRecordResource.updateAssetRecord()` returns HTTP 304 Not Modified when the PUT body contains no writable property keys (all keys are unrecognized or ignored). Axios may throw on 304 if the axios instance has certain response interceptors or if the caller treats non-2xx as error.

**Why it happens:** HTTP 304 is technically a success in this context (nothing to update), but some HTTP clients treat it as a redirect or error.

**How to avoid:** Wrap the v1.put call in try/catch as usual. If 304 is caught, it means no recognized fields were in the body — return a user-friendly message like "No recognized asset fields were provided." The `buildErrorMessage()` function will show `OpenNMS API error (HTTP 304)` which can be caught and returned as a non-error message.

**Warning signs:** `update_node_asset_record` returns `isError: true` with HTTP 304 when valid but unrecognized field names are submitted.

### Pitfall 5: Event FIQL Field Names — "eventUei" not "uei"

**What goes wrong:** Filtering events with `uei==uei.opennms.org/nodes/nodeDown` returns 0 results even when matching events exist.

**Why it happens:** The FIQL property for event UEI is `eventUei` (the database column mapping from `SearchProperties.EVENT_PROPERTIES`), not `uei`. The `EventDTO.java` has `uei` as a field name but the FIQL search property is `eventUei`.

**How to avoid:** Use `eventUei==value` in FIQL filters, not `uei==value`. Similarly, use `eventSeverity` not `severity`. For node-based filtering use `node.id==42` or `node.label==value`.

**Warning signs:** Zero events returned when filtering by UEI despite events existing with that UEI.

### Pitfall 6: Category Name with Spaces in URL Path

**What goes wrong:** A category named "My Servers" causes a 404 when accessed at `/nodes/42/categories/My Servers` because the space is not encoded.

**Why it happens:** URL path segments must be percent-encoded; spaces become `%20`.

**How to avoid:** Always wrap category names in `encodeURIComponent()` when constructing the URL path: `client.v1.post(\`/nodes/${nodeId}/categories/${encodeURIComponent(categoryName)}\`)`.

**Warning signs:** HTTP 404 for category operations even when the category exists and the node exists.

---

## Code Examples

Verified patterns from official sources:

### Event List (v2, FIQL)

```typescript
// Source: opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/EventCollectionDTO.java
// Source: opennms/ui/src/services/eventService.ts (confirms v2 client, 204 guard, "event" key)
// GET /api/v2/events?limit=25&_s=eventUei==uei.opennms.org/nodes/nodeDown
const resp = await client.v2.get("/events", {
  params: { limit: 25, _s: "eventUei==uei.opennms.org/nodes/nodeDown" }
});
// resp.data: { event: EventDTO[], totalCount: number, count: number, offset: number }
// or HTTP 204 if no matches
if (resp.status === 204 || !resp.data?.event?.length) { /* empty */ }
const events = resp.data.event as EventDTO[];
```

### Event Get by ID (v2)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/api/EventRestApi.java
// GET /api/v2/events/12345
const resp = await client.v2.get("/events/12345");
// resp.data: EventDTO (single object, not wrapped)
const event = resp.data as EventDTO;
```

### Send Event (v2 POST, JSON)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/EventRestService.java
// POST /api/v2/events  Content-Type: application/json
// Returns HTTP 204 No Content on success
await client.v2.post("/events", {
  uei: "uei.opennms.org/generic/traps/SNMP_Warm_Start",
  nodeid: 42,               // lowercase "nodeid" — JAXB @XmlElement(name="nodeid")
  interface: "192.168.1.1", // "interface" — JAXB @XmlElement(name="interface")
  descr: "Test event",      // "descr" — JAXB @XmlElement(name="descr")
  severity: "WARNING",
});
// Returns 204 No Content — do NOT access resp.data
```

### Get Asset Record (v1)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/AssetRecordResource.java
// GET /opennms/rest/nodes/42/assetRecord
const resp = await client.v1.get("/nodes/42/assetRecord");
// resp.data: single OnmsAssetRecord JSON object (not wrapped in array)
const asset = resp.data as AssetRecordDTO;
```

### Update Asset Record (v1 PUT, partial update)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/AssetRecordResource.java
// BeanWrapper applies only submitted fields — server-side partial merge
// PUT /opennms/rest/nodes/42/assetRecord  Content-Type: application/x-www-form-urlencoded
const body = new URLSearchParams({ building: "HQ", city: "New York" });
await client.v1.put("/nodes/42/assetRecord", body);
// Returns 204 No Content (fields changed) or 304 Not Modified (no recognized fields)
// Do NOT access resp.data
```

### List All Categories (v1)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/CategoryRestService.java
// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsCategoryCollection.java
// @JsonProperty("category") — singular key
// GET /opennms/rest/categories
const resp = await client.v1.get("/categories");
// resp.data: { category: CategoryDTO[] } — array key is "category" (singular)
const categories = (resp.data?.category ?? []) as CategoryDTO[];
```

### List Node Categories (v1)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/NodeRestService.java
// GET /opennms/rest/nodes/42/categories
const resp = await client.v1.get("/nodes/42/categories");
const categories = (resp.data?.category ?? []) as CategoryDTO[];
```

### Add Category to Node (v1 POST — NOT PUT)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/NodeRestService.java
// @POST @Path("/{nodeCriteria}/categories/{categoryName}")
// POST /opennms/rest/nodes/42/categories/Routers
// Returns 201 Created or 400 (category not found OR already assigned)
await client.v1.post(`/nodes/42/categories/${encodeURIComponent("Routers")}`);
// No body needed, no resp.data to parse
```

### Remove Category from Node (v1 DELETE)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/NodeRestService.java
// @DELETE @Path("/{nodeCriteria}/categories/{categoryName}")
// DELETE /opennms/rest/nodes/42/categories/Routers
// Returns 204 No Content
await client.v1.delete(`/nodes/42/categories/${encodeURIComponent("Routers")}`);
```

### Minimal TypeScript Interfaces

```typescript
// Source: opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/EventDTO.java
// All @XmlAttribute/@XmlElement names are authoritative
interface EventDTO {
  id?: number;           // @XmlAttribute(name="id") — Integer, NOT string (unlike NodeDTO)
  uei?: string;          // @XmlElement(name="uei")
  label?: string;        // @XmlElement(name="label")
  time?: string;         // @XmlElement(name="time") — Date serialized as ISO-8601 or epoch
  source?: string;       // @XmlElement(name="source")
  severity?: string;     // @XmlAttribute(name="severity")
  nodeId?: number;       // @XmlElement(name="nodeId")
  nodeLabel?: string;    // @XmlElement(name="nodeLabel")
  description?: string;  // @XmlElement(name="description")
  logMessage?: string;   // @XmlElement(name="logMessage")
  ipAddress?: string;    // @XmlElement(name="ipAddress") — InetAddress serialized as string
  location?: string;     // @XmlElement(name="location")
  ifIndex?: number;      // @XmlElement(name="ifIndex")
  createTime?: string;   // @XmlElement(name="createTime")
  ackUser?: string;      // @XmlElement(name="ackUser")
  ackTime?: string;      // @XmlElement(name="ackTime")
  parameters?: EventParameterDTO[]; // @XmlElementWrapper(name="parameters") @XmlElement(name="parameter")
}

interface EventListResponse {
  event: EventDTO[];     // @JsonProperty("event") — singular key
  totalCount: number;
  count: number;
  offset: number;
}

// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsAssetRecord.java
// Key fields from @Column annotations (many more exist — full list in Common Pitfalls)
interface AssetRecordDTO {
  id?: number;
  // Hardware
  manufacturer?: string;
  vendor?: string;
  modelNumber?: string;
  serialNumber?: string;
  operatingSystem?: string;
  cpu?: string;
  ram?: string;
  storagectrl?: string;
  hdd1?: string; hdd2?: string; hdd3?: string; hdd4?: string; hdd5?: string; hdd6?: string;
  numpowersupplies?: string;
  inputpower?: string;
  additionalhardware?: string;
  // Location
  building?: string;
  floor?: string;
  room?: string;
  rack?: string;
  rackunitheight?: string;
  slot?: string;
  port?: string;
  region?: string;
  division?: string;
  department?: string;
  // Contact
  vendorPhone?: string;
  vendorFax?: string;
  vendorAssetNumber?: string;
  supportPhone?: string;
  // Identification
  assetNumber?: string;
  circuitId?: string;
  category?: string;   // "asset category" field (not node category)
  description?: string;
  comment?: string;
  // Maintenance
  dateInstalled?: string;
  lease?: string;
  leaseExpires?: string;
  maintcontract?: string;
  maintContractExpiration?: string;
  // Management
  username?: string;
  password?: string;     // note: stored in plain text in OpenNMS
  enable?: string;
  connection?: string;
  autoenable?: string;
  snmpcommunity?: string;
  admin?: string;
  // Display/management categories
  displayCategory?: string;
  notifyCategory?: string;
  pollerCategory?: string;
  thresholdCategory?: string;
  // Management
  managedObjectType?: string;
  managedObjectInstance?: string;
  // Tracking
  lastModifiedBy?: string;
  lastModifiedDate?: string;
}

// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsCategory.java
interface CategoryDTO {
  id?: number;           // @XmlAttribute(name="id")
  name?: string;         // @XmlAttribute(name="name")
  description?: string;  // @XmlElement(name="description")
}

interface CategoryListResponse {
  category: CategoryDTO[]; // @JsonProperty("category") — singular key
}
```

### FIQL Filter Examples for Events

```
# Filter by UEI (CRITICAL: use "eventUei" not "uei")
eventUei==uei.opennms.org/nodes/nodeDown

# Filter by node ID
node.id==42

# Filter by node label
node.label==myserver

# Filter by severity (integer codes: 1=INDETERMINATE, 2=CLEARED, 3=NORMAL, 4=WARNING, 5=MINOR, 6=MAJOR, 7=CRITICAL)
eventSeverity==7

# Combine (AND)
node.id==42;eventUei==uei.opennms.org/nodes/nodeDown
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| v1 `/opennms/rest/events` for reads | v2 `/api/v2/events` for reads | FIQL support: filter by UEI, node, severity |
| GET-merge-PUT for asset partial update | PUT with only changed fields (BeanWrapper) | No read required before update; server handles merge |
| XML body for send event (v1 POST) | JSON body for send event (v2 POST, `application/json`) | Simpler for MCP tools; no XML serialization needed |
| POST /opennms/rest/events for sending | POST /api/v2/events for sending | v2 is simpler, same semantics; v1 works too |

**API version summary for Phase 4:**
- `list_events`: v2 (FIQL, JSON, 204 guard required)
- `get_event`: v2
- `send_event`: v2 POST (JSON body preferred; v1 also accepts XML/JSON)
- `get_node_asset_record`: v1 (sub-resource of /nodes/{id}/assetRecord)
- `update_node_asset_record`: v1 (form-encoded PUT with partial update)
- `list_categories`: v1
- `get_node_categories`: v1 (sub-resource of /nodes/{id}/categories)
- `add_category_to_node`: v1 POST (NOT PUT)
- `remove_category_from_node`: v1 DELETE

---

## Open Questions

1. **HTTP 204 vs 200 for category list when empty**
   - What we know: The v1 `CategoryRestService.listCategories()` returns `new OnmsCategoryCollection(m_categoryDao.findAll())` — no explicit 204 handling. v1 APIs typically return 200 with an empty list.
   - What's unclear: Whether the response is 200 + empty JSON array or 204 No Content.
   - Recommendation: Guard with `resp.data?.category ?? []` (default to empty array). If categories is undefined/empty, show "No categories defined." The v1 endpoint likely returns 200 with `{ category: [] }` but defensive coding handles both.

2. **Category name URL encoding — does OpenNMS accept %20 in path?**
   - What we know: Standard JAX-RS path params are automatically URL-decoded by the container (CXF). `@PathParam("categoryName") String categoryName` receives the decoded value.
   - What's unclear: Whether CXF has any issues with encoded slashes (`%2F`) in category names.
   - Recommendation: Use `encodeURIComponent()` for all category names. Avoid categories with slashes (they would break path routing even encoded). Document this limitation in the tool description.

3. **send_event response code — does v2 return 204 or 202?**
   - What we know: `EventRestService.create(Event event)` explicitly returns `Response.noContent().build()` (HTTP 204). The `EventRestApi.java` Swagger annotation also says "204: Successful operation".
   - What's unclear: Whether there's any network middleware or proxy that changes this.
   - Recommendation: Treat both 204 and 202 as success. The Java source is definitive: expect 204. The v1 `EventRestService.publishEvent()` returns `Response.accepted().build()` (202).

4. **Asset record response format — is `id` field present?**
   - What we know: `OnmsAssetRecord.java` has `@Id @GeneratedValue private Integer m_id`. Whether JAXB serializes `@Id` fields to JSON is unknown without checking the class-level access type annotation.
   - What's unclear: Whether `id` appears in the JSON response.
   - Recommendation: Define `id` as optional in the TypeScript interface. The asset record is identified by node, not by its own ID, so the presence or absence of `id` doesn't affect functionality.

---

## Sources

### Primary (HIGH confidence)

- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/EventRestService.java` — v2 event service: FIQL, `EventCollectionDTO`, `create()` method returns 204, `sendEvent()` called (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/api/EventRestApi.java` — v2 API interface: GET list, GET by ID, POST create — all paths confirmed (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/EventRestService.java` — v1 event: `@POST @Consumes({APPLICATION_XML, APPLICATION_JSON})` for sending; returns `Response.accepted().build()` (202) (in repo)
- `opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/EventDTO.java` — Authoritative EventDTO field list: `@XmlAttribute(name="id")` as Integer, all field names (in repo)
- `opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/EventCollectionDTO.java` — `@JsonProperty("event")` confirms array key is `"event"` (singular) (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/AssetRecordResource.java` — `@GET @Produces({XML, JSON})`, `@PUT @Consumes(FORM_URLENCODED)` with BeanWrapper partial-update pattern; 204/304 response codes confirmed (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/NodeRestService.java` — Lines 364-368: `assetRecord` sub-resource path; Lines 381-505: category methods with `@GET`, `@POST` (add), `@DELETE` (remove) annotations confirmed (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/CategoryRestService.java` — `@GET /categories` list, `@PUT /categories/{name}` update category fields (NOT add to node), `@DELETE /categories/{name}/nodes/{node}` remove (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsCategoryCollection.java` — `@JsonProperty("category")` confirms singular array key (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsCategory.java` — Fields: `@XmlAttribute(name="id")`, `@XmlAttribute(name="name")`, `@XmlElement(name="description")` (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsAssetRecord.java` — All 50+ asset fields with `@Column` annotations; field names confirmed (in repo)
- `opennms/features/events/api/src/main/java/org/opennms/netmgt/xml/event/Event.java` — Send-event XML schema: `@XmlElement(name="nodeid")`, `@XmlElement(name="interface")`, `@XmlElement(name="descr")`, `@XmlElement(name="uei")` (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/support/SearchProperties.java` — `EVENT_SERVICE_PROPERTIES` composition confirmed; node alias added with `withAliasPrefix(Aliases.node, ...)` = `node.id`, `node.label` FIQL fields; `eventUei` confirmed as FIQL property name (in repo)
- `opennms/docs/modules/development/pages/rest/events.adoc` — Event API doc: GET /events, GET /events/{id}, POST /events (in repo)
- `opennms/docs/modules/development/pages/rest/categories.adoc` — Category API doc: GET /categories, POST /categories/{name}/nodes/{node} for assignment (in repo)
- `opennms/ui/src/services/eventService.ts` — Production UI: uses `v2.get("/events")`, 204 guard, `event` array key confirmed (in repo)

### Secondary (MEDIUM confidence)

- Phase 2 RESEARCH.md — URLSearchParams pattern for form-encoded PUT, 204 response handling, buildErrorMessage() established
- Phase 3 RESEARCH.md — v1 node sub-resource pattern (`/nodes/{id}/assetRecord` and `/nodes/{id}/categories` follow same routing mechanism as `/nodes/{id}/ipinterfaces`)

### Tertiary (LOW confidence)

- HTTP 204 vs 200 behavior for `GET /opennms/rest/categories` on empty list — v1 response behavior not directly verified from Java source; defensive `?? []` guard recommended
- send_event v2 returns 204 vs 202: v2 EventRestService source says 204; v1 returns 202; using v2 endpoint so 204 expected but cannot test without live instance

---

## Metadata

**Confidence breakdown:**
- API endpoints and HTTP methods: HIGH — verified from Java `@Path`, `@GET`, `@POST`, `@PUT`, `@DELETE`, `@Consumes` annotations in repo source
- JSON array keys (events, categories): HIGH — `@JsonProperty` annotations verified from `EventCollectionDTO.java` and `OnmsCategoryCollection.java`
- EventDTO field names: HIGH — verified from `EventDTO.java` `@XmlAttribute`/`@XmlElement` annotations
- Event FIQL property names (eventUei, node.id): HIGH — verified from `SearchProperties.java` EVENT_PROPERTIES and withAliasPrefix usage
- Asset field names: HIGH — `@Column` annotations in `OnmsAssetRecord.java` confirm field names; BeanWrapper uses Java property names (camelCase from getter/setter)
- Category assignment uses POST not PUT: HIGH — `@POST @Path("/{nodeCriteria}/categories/{categoryName}")` in NodeRestService source confirmed
- Asset partial update (no GET needed): HIGH — BeanWrapper pattern in AssetRecordResource Java source confirmed
- send_event field names (nodeid, interface, descr): HIGH — JAXB `@XmlElement` annotations in `Event.java` confirmed
- v1 category list 204 vs 200 on empty: LOW — not directly verified; v1 typically returns 200 with empty list

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (OpenNMS REST APIs are stable; these v1 endpoints have been unchanged for many major versions)
