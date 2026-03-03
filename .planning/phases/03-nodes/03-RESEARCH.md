# Phase 3: Nodes - Research

**Researched:** 2026-03-03
**Domain:** OpenNMS Node REST API (v1 + v2), IP interfaces, SNMP interfaces, outages, rescan
**Confidence:** HIGH — primary sources are Java source in repo, UI TypeScript service in repo, and official REST docs in repo

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NODE-01 | User can list nodes, optionally filtered by label or category | v2 GET `/api/v2/nodes?_s=<fiql>` with FIQL fields `label==value` and `category.name==value`; 204 guard required |
| NODE-02 | User can get a specific node by numeric ID or by `foreignSource:foreignId` format | v2 GET `/api/v2/nodes/{nodeCriteria}` where nodeCriteria is either numeric ID or `foreignSource:foreignId`; confirmed in docs and `NodeDao.get(String)` |
| NODE-03 | User can list IP interfaces for a node | v2 GET `/api/v2/nodes/{id}/ipinterfaces`; returns `{ ipInterface: [...] }` array; 204 guard required |
| NODE-04 | User can list SNMP interfaces for a node | v2 GET `/api/v2/nodes/{id}/snmpinterfaces`; returns `{ snmpInterface: [...] }` array; 204 guard required |
| NODE-05 | User can list outages for a node | v1 GET `/opennms/rest/outages/forNode/{nodeId}`; returns `{ outage: [...] }` array; only accepts numeric node ID |
| NODE-06 | User can trigger a rescan of a node | v2 PUT `/api/v2/nodes/{nodeCriteria}/rescan` with empty body and `Content-Type: application/x-www-form-urlencoded`; returns HTTP 200 OK |
</phase_requirements>

---

## Summary

Phase 3 implements six MCP tools — `list_nodes`, `get_node`, `get_node_ip_interfaces`, `get_node_snmp_interfaces`, `get_node_outages`, and `rescan_node` — that together give Claude full node visibility and the ability to trigger rescans. All read operations use the v2 API (FIQL filtering available), with one exception: node outages use the v1 REST API because there is no v2 outage endpoint for a specific node.

The API split is similar to Phase 2 but with a twist: the rescan mutation is on the **v2** API (not v1), annotated `@PUT @Consumes(MediaType.APPLICATION_FORM_URLENCODED)` at `/api/v2/nodes/{nodeCriteria}/rescan`. This is the inverse of alarms where writes were v1-only. The rescan endpoint does not require a body — it fires an event internally. The `URLSearchParams` pattern still applies to satisfy the `@Consumes(APPLICATION_FORM_URLENCODED)` annotation.

The foreignSource:foreignId lookup format works across both node reads and rescan: the v2 `NodeRestService.doGet()` calls `NodeDao.get(nodeCriteria)` which accepts either a numeric string or `"foreignSource:foreignId"` format. This means `get_node` and `rescan_node` accept either format transparently — no separate lookup is needed.

**Primary recommendation:** Implement in two plans: Plan 01 — four read tools (`list_nodes`, `get_node`, `get_node_ip_interfaces`, `get_node_snmp_interfaces`); Plan 02 — outages and rescan (`get_node_outages` using v1, `rescan_node` using v2 PUT).

---

## Standard Stack

### Core (all established in Phase 1 — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.27.1 | `server.tool()` registration for all node tools | Official MCP SDK; already installed |
| `axios` | 1.13.6 | HTTP client; `client.v2` for all reads and rescan, `client.v1` for outages | Already installed; established pattern |
| `zod` | ^3.25.0 | Input schema for tool args | Already installed; MCP SDK peer dep |

### No New Dependencies

Phase 3 requires no new npm packages. All functionality is implementable with:
- `client.v2.get()` — list nodes, get node by ID, list IP interfaces, list SNMP interfaces
- `client.v1.get()` — list outages for node (v1-only endpoint)
- `client.v2.put()` with `URLSearchParams` body — rescan node (v2 PUT, form-encoded)

**Installation:** Nothing new to install.

---

## Architecture Patterns

### Recommended File Structure

```
src/
├── index.ts          # Phase 1+2: existing; Phase 3: add registerNodeTools() call
├── config.ts         # Phase 1: untouched
├── client.ts         # Phase 1: untouched
└── tools/
    ├── alarms.ts     # Phase 2: existing
    └── nodes.ts      # Phase 3: all 6 node tools registered here
```

**Pattern:** `registerNodeTools(server, client, config)` — exact same signature as `registerAlarmTools`. Called in `index.ts` after the existing `registerAlarmTools()` call, before `server.connect()`.

### Pattern 1: registerNodeTools() Function

**What:** A function that registers all node MCP tools onto the server instance.
**When to use:** Called once in index.ts, before server.connect().

```typescript
// src/tools/nodes.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

export function registerNodeTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {
  // Register list_nodes, get_node, get_node_ip_interfaces,
  // get_node_snmp_interfaces, get_node_outages, rescan_node
}
```

```typescript
// src/index.ts — add after existing registerAlarmTools call
import { registerNodeTools } from "./tools/nodes.js";

registerNodeTools(server, client, config);
```

### Pattern 2: list_nodes Tool (v2 API, FIQL filter)

**What:** List nodes with optional FIQL filter on label or category.
**API:** GET `/api/v2/nodes?limit=N&_s=<fiql>`
**Response envelope:** `{ node: Node[], totalCount: number, count: number, offset: number }` — array key is `"node"` (not `"nodes"`).

```typescript
// Source: opennms/ui/src/services/nodeService.ts (production pattern)
// Source: OnmsNodeList.java: @JsonProperty("node")

server.tool(
  "list_nodes",
  "List OpenNMS nodes. Optionally filter by label or category using FIQL. Examples: 'label==myserver', 'category.name==Routers'. Returns node ID, label, foreignSource, foreignId, and location for each node.",
  {
    filter: z.string().optional().describe(
      "FIQL filter. Examples: 'label==myserver', 'label==my*' (wildcard), 'category.name==Routers', 'foreignSource==MySource'. Omit for all nodes. Do NOT URL-encode."
    ),
    limit: z.number().int().min(1).max(1000).default(25).describe(
      "Maximum number of nodes to return (default 25, max 1000)."
    ),
  },
  async ({ filter, limit }) => {
    try {
      const params: Record<string, string | number> = { limit };
      if (filter) params._s = filter;
      const resp = await client.v2.get("/nodes", { params });

      // v2 returns HTTP 204 No Content when no nodes match filter
      if (resp.status === 204 || !resp.data?.node?.length) {
        return { content: [{ type: "text", text: "No nodes found matching the given filter." }] };
      }

      const nodes = resp.data.node as NodeDTO[];
      const totalCount: number = resp.data.totalCount ?? nodes.length;
      const lines = nodes.map(formatNodeSummary);
      const header = `Nodes: ${nodes.length} of ${totalCount} total`;
      return { content: [{ type: "text", text: [header, "", ...lines].join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, "list nodes") }], isError: true };
    }
  }
);
```

### Pattern 3: get_node Tool (v2 API, numeric ID or foreignSource:foreignId)

**What:** Get a single node by numeric ID or `foreignSource:foreignId` format.
**API:** GET `/api/v2/nodes/{nodeCriteria}`
**Key finding:** The `{nodeCriteria}` path parameter accepts either a numeric string or `"foreignSource:foreignId"` format. The `NodeDao.get(String)` method handles both — no separate endpoint needed.

```typescript
// Source: opennms/docs/modules/development/pages/rest/nodes.adoc:
// "anywhere you use 'id' in the queries below, you can use the foreign source
//  and foreign ID separated by a colon instead (GET /nodes/fs:fid)"

server.tool(
  "get_node",
  "Get full details for a specific OpenNMS node. Accepts either a numeric node ID or 'foreignSource:foreignId' format (e.g. 'MySource:abc123').",
  {
    id: z.string().describe(
      "Node identifier: either a numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
    ),
  },
  async ({ id }) => {
    try {
      const resp = await client.v2.get(`/nodes/${id}`);
      const node = resp.data as NodeDTO;
      return { content: [{ type: "text", text: formatNodeDetail(node) }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `node ${id}`) }], isError: true };
    }
  }
);
```

### Pattern 4: IP and SNMP Interface Tools (v2 API, sub-resources)

**What:** List IP or SNMP interfaces for a node.
**APIs:**
- GET `/api/v2/nodes/{id}/ipinterfaces` — returns `{ ipInterface: [...] }` (key is `"ipInterface"`)
- GET `/api/v2/nodes/{id}/snmpinterfaces` — returns `{ snmpInterface: [...] }` (key is `"snmpInterface"`)

```typescript
// Source: opennms/ui/src/services/nodeService.ts lines 67-115
// Source: opennms/ui/src/types/index.ts:
//   IpInterfaceApiResponse: { ipInterface: IpInterface[] }
//   SnmpInterfaceApiResponse: { snmpInterface: SnmpInterface[] }

// IP interfaces: array key is "ipInterface" (singular)
const resp = await client.v2.get(`/nodes/${id}/ipinterfaces`);
if (resp.status === 204 || !resp.data?.ipInterface?.length) { /* empty */ }
const interfaces = resp.data.ipInterface as IpInterfaceDTO[];

// SNMP interfaces: array key is "snmpInterface" (singular)
const resp = await client.v2.get(`/nodes/${id}/snmpinterfaces`);
if (resp.status === 204 || !resp.data?.snmpInterface?.length) { /* empty */ }
const interfaces = resp.data.snmpInterface as SnmpInterfaceDTO[];
```

### Pattern 5: get_node_outages Tool (v1 REST API)

**What:** List outages for a specific node. Uses v1 only — no v2 outage-by-node endpoint exists.
**API:** GET `/opennms/rest/outages/forNode/{nodeId}`
**Important:** This endpoint accepts **numeric node ID only** — not `foreignSource:foreignId` format. If the caller provides a foreignSource:foreignId string, a `get_node` call first to resolve the numeric ID is required.
**Response envelope:** `{ outage: [...] }` — array key is `"outage"` (singular).
**Active vs. resolved:** A null `ifRegainedService` means the outage is still active.

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OutageRestService.java
// @Path("outages/forNode/{nodeId}")
// Source: opennms/ui/src/services/nodeService.ts line 129:
//   const outagesEndpoint = `/outages/forNode/${id}`
//   const resp = await rest.get(...)  // <-- uses v1/rest client

const resp = await client.v1.get(`/outages/forNode/${nodeId}`);
// resp.data.outage: array of outage objects
// outage.ifRegainedService null = active outage
// outage.ifLostService = when service was lost
```

### Pattern 6: rescan_node Tool (v2 API, PUT)

**What:** Send a rescan event for a node. Uses **v2 API** (not v1).
**API:** PUT `/api/v2/nodes/{nodeCriteria}/rescan`
**Annotation:** `@PUT @Consumes(MediaType.APPLICATION_FORM_URLENCODED)` — requires URLSearchParams body (can be empty).
**Response:** HTTP 200 OK (not 204). The body will be empty.
**Accepts:** Numeric ID or `foreignSource:foreignId` format.

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/NodeRestService.java
// Lines 276-289: @PUT @Consumes(APPLICATION_FORM_URLENCODED) @Path("{nodeCriteria}/rescan")
// Fires EventUtils.createNodeRescanEvent("ReST", node.getId()) and returns Response.ok().build()

const body = new URLSearchParams(); // empty form body satisfies @Consumes(FORM_URLENCODED)
await client.v2.put(`/nodes/${nodeId}/rescan`, body);
// Returns 200 OK — do not parse resp.data
```

### Anti-Patterns to Avoid

- **Using `"nodes"` as the JSON array key:** The v2 node list response uses `"node"` (singular) as the array key, not `"nodes"`. The `@JsonProperty("node")` annotation on `OnmsNodeList.getObjects()` confirms this. Accessing `resp.data.nodes` will be undefined.
- **Using `"ipInterfaces"` or `"snmpInterfaces"` as JSON array keys:** The actual keys are `"ipInterface"` and `"snmpInterface"` (singular), per the UI TypeScript types and JAXB annotations.
- **Using client.v1 for rescan:** The rescan endpoint is at `/api/v2/nodes/{id}/rescan`, not under `/opennms/rest/`. Use `client.v2.put()`.
- **Using client.v2 for outages:** The node outage endpoint is at `/opennms/rest/outages/forNode/{id}` (v1 REST). Use `client.v1.get()`.
- **Passing foreignSource:foreignId to outages endpoint:** The `forNode/{nodeId}` endpoint uses `@PathParam("nodeId")` typed as `int` — it accepts only numeric IDs.
- **Forgetting 204 guard on node reads:** The v2 API returns 204 No Content (not 200 + empty array) when no nodes, IP interfaces, or SNMP interfaces match.
- **Accessing `resp.data` after rescan:** Rescan returns 200 OK with an empty body. Do not access `resp.data`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| foreignSource:foreignId resolution | Custom lookup to resolve fid → numeric ID | Pass the string directly to v2 endpoint | `NodeDao.get(String)` handles both formats natively |
| Node filtering by label/category | Custom filtering in JavaScript after fetching all nodes | FIQL on v2 `?_s=label==value` or `?_s=category.name==value` | Server-side filtering; don't fetch 10,000 nodes to filter 1 |
| Active outage detection | Custom "is this outage active?" logic | Check `outage.ifRegainedService == null` | Already the correct field from Java model |
| Outage time formatting | Custom date parser | `new Date(outage.ifLostService).toISOString()` | Same pattern used for alarm timestamps |

**Key insight:** The foreignSource:foreignId lookup is handled transparently by the v2 NodeRestService. Passing `"MySource:abc123"` as the node ID in any v2 node endpoint works exactly like passing `"42"`.

---

## Common Pitfalls

### Pitfall 1: Wrong JSON Array Key for Node List

**What goes wrong:** `resp.data.nodes` is undefined; code throws `TypeError: Cannot read properties of undefined (reading 'length')`.

**Why it happens:** The `OnmsNodeList` wraps items with `@JsonProperty("node")` — singular. The same pattern applies to `ipInterface` and `snmpInterface`.

**How to avoid:** Use `resp.data.node` (not `nodes`), `resp.data.ipInterface` (not `ipInterfaces`), `resp.data.snmpInterface` (not `snmpInterfaces`).

**Warning signs:** Zero results or TypeError even when nodes exist on the server.

### Pitfall 2: Wrong API Version for Rescan vs. Outages

**What goes wrong:** Calling rescan against v1 (`/opennms/rest/nodes/{id}/rescan`) gets a 404 because the v1 NodeRestService has no `/rescan` endpoint. Calling outages against v2 gets a 404 because v2 OutageRestService has no `forNode` sub-path.

**Why it happens:** The API split is inverted from alarms: the rescan write is on v2, and the outage read is on v1.

**How to avoid:**
- Rescan: `client.v2.put("/nodes/{id}/rescan", new URLSearchParams())`
- Outages: `client.v1.get("/outages/forNode/{id}")`

**Warning signs:** HTTP 404 from either endpoint.

### Pitfall 3: Passing foreignSource:foreignId to Outages Endpoint

**What goes wrong:** `client.v1.get("/outages/forNode/MySource:server-001")` returns a 400 or 500 because the Java parameter is `@PathParam("nodeId") final int nodeId` — it cannot parse a non-numeric string.

**Why it happens:** The `forNode` endpoint was designed for numeric node IDs only. The v2 node endpoint's flexible `nodeCriteria` parameter does not apply to v1 outages.

**How to avoid:** If the user provides a `foreignSource:foreignId` string for outages, first call `get_node` to resolve the numeric ID, then use that ID for the outages call. Document this in the tool description.

**Warning signs:** `NumberFormatException` in server logs; HTTP 400 or 500 response from the outages endpoint.

### Pitfall 4: Rescan Returns 200, Not 204

**What goes wrong:** Code checking `if (resp.status === 204)` to confirm success misses the actual success response (200 OK).

**Why it happens:** The rescan endpoint uses `Response.ok().build()` (200) while mutations like alarm ack use `Response.noContent().build()` (204).

**How to avoid:** Do not check response status after `client.v2.put("/nodes/{id}/rescan", body)`. Simply await the call and return a confirmation message. If it throws, `buildErrorMessage()` handles it.

**Warning signs:** Tool reports an error even though the rescan was triggered; or the success case is never reached.

### Pitfall 5: FIQL Category Filter Field Name

**What goes wrong:** Using `category==Routers` in a FIQL filter returns 0 results or a 400 error.

**Why it happens:** The category is a related entity accessed through an alias join. The correct FIQL field is `category.name==Routers` (alias prefix `category`, property `name`), not `category==Routers`.

**How to avoid:** Use `category.name==MyCategory` for filtering by category name. The `SearchProperties.java` confirms: `CATEGORY_PROPERTIES` has `name` as a property, and `NODE_SERVICE_PROPERTIES.addAll(withAliasPrefix(Aliases.category, ...))` adds the alias prefix `category.`.

**Warning signs:** 0 results when filtering by category, or 400 Bad Request from the v2 API.

### Pitfall 6: Node ID Field is a String, Not an Integer

**What goes wrong:** Treating `node.id` as a number fails because `OnmsNode.getNodeId()` returns a `String` (the JAXB `@XmlID` type). In JSON, `node.id` is serialized as a string (`"42"`, not `42`).

**Why it happens:** JAXB `@XmlID` requires a String type. The `getNodeId()` method converts the internal `Integer` to `String` for serialization.

**How to avoid:** Define `NodeDTO.id` as `string` in the TypeScript interface, not `number`. When passing node ID to outages or other endpoints, use `parseInt(node.id)` if a numeric ID is needed.

**Warning signs:** TypeScript type errors when comparing `node.id === 42` or passing `node.id` to a function expecting `number`.

---

## Code Examples

Verified patterns from official sources:

### Node List Request (v2, FIQL)

```typescript
// Source: opennms/ui/src/services/nodeService.ts (production pattern)
// Source: opennms/docs/modules/development/pages/rest/nodes.adoc
// GET /api/v2/nodes?limit=25&_s=label==myserver
const resp = await client.v2.get("/nodes", { params: { limit: 25, _s: "label==myserver" } });
// resp.data: { node: NodeDTO[], totalCount: number, count: number, offset: number }
// or HTTP 204 if no matches
```

### Node Get by ID or foreignSource:foreignId

```typescript
// Source: opennms/docs/modules/development/pages/rest/nodes.adoc
// "you can use the foreign source and foreign ID separated by a colon instead (GET /nodes/fs:fid)"
// Numeric ID:
const resp1 = await client.v2.get("/nodes/42");
// foreignSource:foreignId format:
const resp2 = await client.v2.get("/nodes/MySource:server-001");
// Both return a single NodeDTO object
```

### IP Interfaces for Node

```typescript
// Source: opennms/ui/src/services/nodeService.ts lines 92-115
// Source: opennms/ui/src/types/index.ts: IpInterfaceApiResponse
// GET /api/v2/nodes/42/ipinterfaces
const resp = await client.v2.get("/nodes/42/ipinterfaces");
// resp.data: { ipInterface: IpInterfaceDTO[], totalCount: number, count: number, offset: number }
// or HTTP 204 if no interfaces
const interfaces = resp.data.ipInterface as IpInterfaceDTO[];
```

### SNMP Interfaces for Node

```typescript
// Source: opennms/ui/src/services/nodeService.ts lines 67-90
// Source: opennms/ui/src/types/index.ts: SnmpInterfaceApiResponse
// GET /api/v2/nodes/42/snmpinterfaces
const resp = await client.v2.get("/nodes/42/snmpinterfaces");
// resp.data: { snmpInterface: SnmpInterfaceDTO[], totalCount: number, count: number, offset: number }
const interfaces = resp.data.snmpInterface as SnmpInterfaceDTO[];
```

### Outages for Node (v1 REST)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OutageRestService.java
// Source: opennms/ui/src/services/nodeService.ts lines 128-142
// GET /opennms/rest/outages/forNode/42  (numeric ID ONLY)
const resp = await client.v1.get("/outages/forNode/42");
// resp.data: { outage: OutageDTO[] }
// outage.ifRegainedService === null means active outage
```

### Rescan Node (v2 PUT, form-encoded)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/NodeRestService.java
// @PUT @Consumes(APPLICATION_FORM_URLENCODED) @Path("{nodeCriteria}/rescan")
// PUT /api/v2/nodes/42/rescan  (or /api/v2/nodes/MySource:server-001/rescan)
const body = new URLSearchParams(); // empty body — URLSearchParams sets correct Content-Type
await client.v2.put("/nodes/42/rescan", body);
// Returns HTTP 200 OK — no response body to parse
// Fires uei.opennms.org/internal/capsd/forceRescan event internally
```

### Minimal TypeScript Interfaces

```typescript
// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsNode.java
// Source: opennms/ui/src/types/index.ts (Node interface)
interface NodeDTO {
  id: string;               // @XmlID — serialized as string even though internally Integer
  label: string;            // @XmlAttribute(name="label")
  type?: string;            // @XmlAttribute(name="type") — "A"=active, "D"=deleted
  foreignSource?: string;   // @XmlAttribute(name="foreignSource")
  foreignId?: string;       // @XmlAttribute(name="foreignId")
  location?: string;        // @XmlElement(name="location") — monitoring location name
  sysName?: string;         // @XmlElement(name="sysName")
  sysDescription?: string;  // @XmlElement(name="sysDescription")
  sysObjectId?: string;     // @XmlElement(name="sysObjectId")
  sysLocation?: string;     // @XmlElement(name="sysLocation")
  sysContact?: string;      // @XmlElement(name="sysContact")
  createTime?: number;      // @XmlElement(name="createTime") — epoch ms
  lastCapsdPoll?: string;   // @XmlElement(name="lastCapsdPoll")
}

interface NodeListResponse {
  node: NodeDTO[];          // @JsonProperty("node") — singular key
  totalCount: number;
  count: number;
  offset: number;
}

// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsIpInterface.java
// Source: opennms/ui/src/types/index.ts (IpInterface)
interface IpInterfaceDTO {
  id: string;               // @XmlAttribute(name="id") — string from @XmlID
  ipAddress: string;        // @XmlElement(name="ipAddress")
  hostName?: string;        // @XmlElement(name="hostName") (getter: getIpHostName)
  isManaged?: string;       // @XmlAttribute(name="isManaged") — "M"=managed, "U"=unmanaged
  snmpPrimary?: string;     // @XmlAttribute(name="snmpPrimary") — "P"=primary, "S"=secondary, "N"=not eligible
  ifIndex?: number;         // @XmlAttribute(name="ifIndex") — from linked snmpInterface
  isDown?: boolean;         // @XmlAttribute(name="isDown")
  nodeId?: number;          // @XmlElement(name="nodeId")
  lastCapsdPoll?: number;   // @XmlElement(name="lastCapsdPoll")
}

// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsSnmpInterface.java
// Source: opennms/ui/src/types/index.ts (SnmpInterface)
interface SnmpInterfaceDTO {
  id: number;               // @XmlAttribute(name="id")
  ifIndex?: number;         // @XmlAttribute(name="ifIndex")
  ifDescr?: string;         // getter: getIfDescr — no @XmlAttribute; uses property name
  ifName?: string;          // getter: getIfName
  ifAlias?: string;         // getter: getIfAlias
  ifSpeed?: number;         // getter: getIfSpeed
  ifAdminStatus?: number;   // getter: getIfAdminStatus — 1=up, 2=down, 3=testing
  ifOperStatus?: number;    // getter: getIfOperStatus — 1=up, 2=down
  ifType?: number;          // getter: getIfType
  physAddr?: string;        // getter: getPhysAddr
  collectFlag?: string;     // @XmlAttribute(name="collectFlag")
  collect?: boolean;        // @XmlAttribute(name="collect")
  poll?: boolean;           // @XmlAttribute(name="poll")
}

// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsOutage.java
// Source: opennms/ui/src/types/index.ts (Outage)
interface OutageDTO {
  id?: number;              // @XmlAttribute(name="id") on the outage entity
  nodeId?: number;          // @XmlElement(name="nodeId") — transient computed field
  nodeLabel?: string;       // @XmlElement(name="nodeLabel") — transient computed field
  ipAddress?: string;       // @XmlElement(name="ipAddress") — transient computed field
  ifLostService?: number;   // epoch ms — when service went down
  ifRegainedService?: number; // epoch ms — null if outage is still active
  locationName?: string;    // @XmlElement(name="locationName") — transient
  foreignSource?: string;   // @XmlElement(name="foreignSource") — transient
  foreignId?: string;       // @XmlElement(name="foreignId") — transient
}
```

### FIQL Filter Examples for Nodes

```
# Filter by label (exact)
label==myserver

# Filter by label (wildcard — use * as glob)
label==web*

# Filter by category name
category.name==Routers

# Filter by foreignSource
foreignSource==MyImportSource

# Combine (AND)
category.name==Routers;foreignSource==MySource
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| v1 `/opennms/rest/nodes` for reads | v2 `/api/v2/nodes` for reads | FIQL filtering; `label==value`, `category.name==X` supported |
| Separate endpoint for foreignSource:foreignId | Same v2 endpoint accepts both formats | `get_node("MySource:id")` just works |
| `/opennms/rest/nodes/{id}/rescan` (v1) | `/api/v2/nodes/{id}/rescan` (v2 PUT) | v2 handles both numeric ID and foreignSource:foreignId |

**API version summary for Phase 3:**
- `list_nodes`: v2 (FIQL)
- `get_node`: v2 (accepts both ID formats)
- `get_node_ip_interfaces`: v2
- `get_node_snmp_interfaces`: v2
- `get_node_outages`: **v1** (only available endpoint for per-node outages)
- `rescan_node`: **v2** (PUT, not v1)

---

## Open Questions

1. **Does `list_nodes` return 204 consistently for empty filter matches?**
   - What we know: The OpenNMS UI `nodeService.ts` checks `resp.status === 204` and returns `{ node: [], totalCount: 0 }` defensively.
   - What's unclear: Whether the v2 nodes endpoint consistently returns 204 vs 200 with empty array.
   - Recommendation: Apply the same dual guard as alarms: `if (resp.status === 204 || !resp.data?.node?.length)`. Already confirmed pattern from Phase 2.

2. **Outage `ifLostService` field type in JSON — epoch ms vs ISO-8601 string?**
   - What we know: Java field is `Date`, serialized by JAXB/Jackson. The UI `Outage` interface types it as `number`. Other date fields on nodes are typed as `number` (epoch ms) in UI types.
   - What's unclear: Exact serialization format for outage dates.
   - Recommendation: Use `new Date(outage.ifLostService).toISOString()` — handles both epoch ms and ISO string formats transparently.

3. **SnmpInterface field names without @XmlAttribute annotations**
   - What we know: `ifDescr`, `ifName`, `ifAlias`, `ifSpeed`, `ifAdminStatus`, `ifOperStatus`, `ifType`, `physAddr` have `@Column` but no `@XmlAttribute`/`@XmlElement` annotations in the source read. JAXB default with `@XmlAccessorType(XmlAccessType.NONE)` means only annotated fields are included.
   - What's unclear: Whether these fields appear in the JSON response.
   - Recommendation: The UI `SnmpInterface` TypeScript type includes these fields (e.g., `ifDescr`, `ifName`, `ifAlias`), which is the strongest available evidence they appear in the JSON response. However, mark confidence LOW and be defensive in TypeScript interface (all optional).

---

## Sources

### Primary (HIGH confidence)

- `opennms/docs/modules/development/pages/rest/nodes.adoc` — Nodes API endpoints, foreignSource:foreignId format, rescan POST note (in repo)
- `opennms/docs/modules/development/pages/rest/ipinterfaces.adoc` — IP interfaces v2-only note, FIQL examples (in repo)
- `opennms/docs/modules/development/pages/rest/snmpinterfaces.adoc` — SNMP interfaces v2-only note (in repo)
- `opennms/docs/modules/development/pages/rest/outages.adoc` — forNode/{nodeId} endpoint confirmed (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/NodeRestService.java` — Rescan endpoint: `@PUT @Consumes(APPLICATION_FORM_URLENCODED) @Path("{nodeCriteria}/rescan")`; returns `Response.ok().build()` (200); confirmed v2 (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OutageRestService.java` — `@Path("outages/forNode/{nodeId}")` with `@PathParam("nodeId") final int nodeId`; numeric-only confirmed (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsNodeList.java` — `@JsonProperty("node")` confirms array key is `"node"` not `"nodes"` (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsNode.java` — Field annotations: `id` is `@XmlID` (string), `label` is `@XmlAttribute`, `foreignSource`/`foreignId` are `@XmlAttribute` (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsIpInterface.java` — Field annotations: `ipAddress` is `@XmlElement(name="ipAddress")`, `hostName` is `@XmlElement(name="hostName")`, `isManaged`/`snmpPrimary` are `@XmlAttribute` (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsOutage.java` — Transient computed fields: `nodeId`, `nodeLabel`, `ipAddress`, `foreignSource`, `foreignId`, `locationName` (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsOutageCollection.java` — `@JsonProperty("outage")` confirms array key is `"outage"` (in repo)
- `opennms/ui/src/services/nodeService.ts` — Production patterns: v2 for nodes/ipinterfaces/snmpinterfaces; v1 (rest) for outages; 204 guards confirmed (in repo)
- `opennms/ui/src/types/index.ts` — Authoritative TypeScript field names for `Node`, `IpInterface`, `SnmpInterface`, `Outage` (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/support/SearchProperties.java` — FIQL property `label` on `OnmsNode.class`; `CATEGORY_PROPERTIES` with `name`; `NODE_SERVICE_PROPERTIES.addAll(withAliasPrefix(Aliases.category, ...))` = `category.name` FIQL field (in repo)

### Secondary (MEDIUM confidence)

- Phase 2 RESEARCH.md — established patterns: 204 guard, URLSearchParams, v1 vs v2 client selection, `buildErrorMessage()` usage

### Tertiary (LOW confidence)

- SnmpInterface field presence in JSON response (ifDescr, ifName, etc.) — inferred from UI `SnmpInterface` TypeScript type; no @XmlAttribute annotations found on these fields in Java source; UI types are the best available evidence

---

## Metadata

**Confidence breakdown:**
- API endpoints and HTTP methods: HIGH — verified from Java source `@Path`, `@GET`, `@PUT`, `@Consumes` annotations and official REST docs
- JSON field names (Node, IpInterface, Outage): HIGH — verified from Java JAXB annotations and UI TypeScript types
- JSON field names (SnmpInterface non-annotated fields): LOW — inferred from UI TypeScript type; no direct @XmlAttribute evidence in source
- FIQL filter fields (label, category.name): HIGH — verified from SearchProperties.java
- 204 response guard: MEDIUM — confirmed by UI defensive coding; pattern same as Phase 2 alarms
- Rescan response code (200 vs 204): HIGH — Java source uses `Response.ok().build()` confirmed

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (OpenNMS Node REST API is stable; node API unchanged for several major versions)
