# Phase 5: Collection Config - Research

**Researched:** 2026-03-03
**Domain:** OpenNMS monitored service REST API (v1), collection/polling enable-disable via status field
**Confidence:** HIGH — primary sources are Java source files in the opennms/ directory of this repo

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COLL-01 | User can list the monitored services on a node's IP interface | v1 GET `/opennms/rest/nodes/{nodeCriteria}/ipinterfaces/{ipAddress}/services` returns `{ service: [...] }` via `OnmsMonitoredServiceList`; array key is `"service"` (singular) |
| COLL-02 | User can enable collection on a node's IP interface service | v1 PUT `/opennms/rest/nodes/{nodeCriteria}/ipinterfaces/{ipAddress}/services/{serviceName}` with form body `status=A`; returns 204 No Content on success |
| COLL-03 | User can disable collection on a node's IP interface service | Same PUT endpoint with form body `status=F` (Forced Unmanaged); returns 204 No Content on success |
</phase_requirements>

---

## Summary

Phase 5 implements three MCP tools — `list_node_services`, `enable_service_collection`, and `disable_service_collection` — using the OpenNMS v1 REST API exclusively. All three endpoints live under the `OnmsMonitoredServiceResource` class, which is mounted as a sub-resource at `/opennms/rest/nodes/{nodeCriteria}/ipinterfaces/{ipAddress}/services`.

The STATE.md blocker ("collection config enable/disable API endpoints were not fully verified") is now resolved. The Java source confirms: there is **no separate "collect" toggle field**. Collection enable/disable is controlled entirely by the service `status` field. Setting `status=A` (Managed) enables polling/collection; setting `status=F` (Forced Unmanaged) disables it. This is done via a v1 PUT with `application/x-www-form-urlencoded` body — the same URLSearchParams pattern used for alarm mutations and node rescan.

The nodeCriteria parameter in the path accepts both numeric IDs and `foreignSource:foreignId` format (the Java code calls `m_nodeDao.get(nodeCriteria)` which handles both). The IP address in the URL path is passed as a plain string — the v1 code uses `node.getIpInterfaceByIpAddress(ipAddress)` with the string directly. The service is identified by name (`{service}` path param, resolved via `iface.getMonitoredServiceByServiceType(serviceName)`).

**Primary recommendation:** Implement all three tools in a single plan file (`05-01-PLAN.md`) in `src/tools/collection.ts`, following the exact pattern of `src/tools/nodes.ts`. The `status` field is the only writable property needed; use `URLSearchParams` with `status=A` or `status=F` for the PUT body.

---

## Standard Stack

### Core (all established in Phase 1 — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.27.1 | `server.tool()` registration | Official MCP SDK; already installed |
| `axios` | 1.13.6 | HTTP client; `client.v1` for all three operations | Already installed; v1 REST pattern established |
| `zod` | ^3.25.0 | Input schema for tool args | Already installed; MCP SDK peer dep |

### No New Dependencies

Phase 5 requires no new npm packages. All three operations use `client.v1` only:
- `client.v1.get()` — list services
- `client.v1.put()` with `URLSearchParams` body — enable/disable

**Installation:** Nothing new to install.

---

## Architecture Patterns

### Recommended File Structure

```
src/
├── index.ts              # Add registerCollectionTools() call
├── config.ts             # Untouched
├── client.ts             # Untouched
└── tools/
    ├── alarms.ts         # Phase 2: existing
    ├── nodes.ts          # Phase 3: existing
    ├── events.ts         # Phase 4: existing (events + assets + categories)
    └── collection.ts     # Phase 5: all 3 collection tools
```

**Pattern:** `registerCollectionTools(server, client, config)` — exact same signature as all prior phases. Called in `index.ts` after existing `registerXxxTools()` calls, before `server.connect()`.

### Pattern 1: registerCollectionTools() Function Signature

```typescript
// src/tools/collection.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

export function registerCollectionTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {
  // Register list_node_services, enable_service_collection, disable_service_collection
}
```

```typescript
// src/index.ts — add after existing registerEventTools() call
import { registerCollectionTools } from "./tools/collection.js";

registerCollectionTools(server, client, config);
```

### Pattern 2: URL Path for All Three Operations

The v1 endpoint path is assembled from three pieces:

```
/nodes/{nodeCriteria}/ipinterfaces/{ipAddress}/services
/nodes/{nodeCriteria}/ipinterfaces/{ipAddress}/services/{serviceName}
```

**Source:** `NodeRestService.java` line 342: `@Path("{nodeCriteria}/ipinterfaces")` delegates to `OnmsIpInterfaceResource`, which at line 255 maps `@Path("{ipAddress}/services")` to `OnmsMonitoredServiceResource`. The resource class has `@GET` (no sub-path = list), `@GET @Path("{service}")` (get one), and `@PUT @Consumes(FORM_URLENCODED) @Path("{service}")` (update).

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OnmsIpInterfaceResource.java line 255
// @Path("{ipAddress}/services")
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OnmsMonitoredServiceResource.java

const servicesPath = `/nodes/${nodeId}/ipinterfaces/${ipAddress}/services`;
const servicePath  = `/nodes/${nodeId}/ipinterfaces/${ipAddress}/services/${serviceName}`;
```

### Pattern 3: list_node_services Tool (v1 GET)

**API:** GET `/opennms/rest/nodes/{nodeCriteria}/ipinterfaces/{ipAddress}/services`
**Response envelope:** `{ service: [...] }` — array key is `"service"` (singular), per `@JsonProperty("service")` in `OnmsMonitoredServiceList.java`.
**No 204 guard needed:** The `OnmsMonitoredServiceResource.getServices()` returns the list directly (no explicit 204 branch); however, apply a defensive empty-array check.

```typescript
// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsMonitoredServiceList.java
// @JsonProperty("service") — array key is "service" (singular)
// @JsonRootName("services") — root object key

server.tool(
  "list_node_services",
  "List monitored services on a specific IP interface of an OpenNMS node. Returns each service name and its collection status (A=enabled, F=disabled/forced-unmanaged).",
  {
    nodeId: z.string().describe(
      "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
    ),
    ipAddress: z.string().describe(
      "IP address of the interface (e.g. '192.168.1.10'). Must match exactly as stored in OpenNMS."
    ),
  },
  async ({ nodeId, ipAddress }) => {
    try {
      const resp = await client.v1.get(`/nodes/${nodeId}/ipinterfaces/${ipAddress}/services`);

      // Array key is "service" (singular) per @JsonProperty("service") in OnmsMonitoredServiceList.java
      const services = resp.data?.service as MonitoredServiceDTO[] | undefined;
      if (!services?.length) {
        return { content: [{ type: "text", text: `No monitored services found on ${ipAddress} for node ${nodeId}.` }] };
      }

      const lines = services.map(formatService);
      const header = `Monitored services on ${ipAddress} (node ${nodeId}): ${services.length} total`;
      return { content: [{ type: "text", text: [header, "", ...lines].join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `services on ${ipAddress} for node ${nodeId}`) }], isError: true };
    }
  }
);
```

### Pattern 4: enable/disable_service_collection Tools (v1 PUT, form-encoded)

**API:** PUT `/opennms/rest/nodes/{nodeCriteria}/ipinterfaces/{ipAddress}/services/{serviceName}`
**Body:** `application/x-www-form-urlencoded` with `status=A` (enable) or `status=F` (disable)
**Success response:** HTTP 204 No Content (when modified) or HTTP 304 Not Modified (if already in target state)
**Error responses:** HTTP 400 Bad Request if node, interface, or service not found

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OnmsMonitoredServiceResource.java
// @PUT @Consumes(MediaType.APPLICATION_FORM_URLENCODED) @Path("{service}")
// Returns Response.noContent().build() (204) when modified
// Returns Response.notModified().build() (304) when already in requested state

// Enable collection: status=A (Managed)
server.tool(
  "enable_service_collection",
  "Enable collection/polling for a monitored service on a node's IP interface. Sets the service status to Active (A). Returns confirmation when enabled.",
  {
    nodeId: z.string().describe("Node identifier: numeric ID or foreignSource:foreignId format."),
    ipAddress: z.string().describe("IP address of the interface (e.g. '192.168.1.10')."),
    serviceName: z.string().describe("Service name exactly as shown in OpenNMS (e.g. 'ICMP', 'SNMP', 'HTTP')."),
  },
  async ({ nodeId, ipAddress, serviceName }) => {
    try {
      const body = new URLSearchParams({ status: "A" });
      await client.v1.put(`/nodes/${nodeId}/ipinterfaces/${ipAddress}/services/${serviceName}`, body);
      // Returns 204 No Content (modified) or 304 Not Modified (already active) — both are success
      return { content: [{ type: "text", text: `Collection enabled for service ${serviceName} on ${ipAddress} (node ${nodeId}). Status set to Active (A).` }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `enable collection for ${serviceName} on ${ipAddress}`) }], isError: true };
    }
  }
);

// Disable collection: status=F (Forced Unmanaged)
server.tool(
  "disable_service_collection",
  "Disable collection/polling for a monitored service on a node's IP interface. Sets the service status to Forced Unmanaged (F). Returns confirmation when disabled.",
  {
    nodeId: z.string().describe("Node identifier: numeric ID or foreignSource:foreignId format."),
    ipAddress: z.string().describe("IP address of the interface (e.g. '192.168.1.10')."),
    serviceName: z.string().describe("Service name exactly as shown in OpenNMS (e.g. 'ICMP', 'SNMP', 'HTTP')."),
  },
  async ({ nodeId, ipAddress, serviceName }) => {
    try {
      const body = new URLSearchParams({ status: "F" });
      await client.v1.put(`/nodes/${nodeId}/ipinterfaces/${ipAddress}/services/${serviceName}`, body);
      // Returns 204 No Content (modified) or 304 Not Modified (already forced-unmanaged)
      return { content: [{ type: "text", text: `Collection disabled for service ${serviceName} on ${ipAddress} (node ${nodeId}). Status set to Forced Unmanaged (F).` }] };
    } catch (err) {
      return { content: [{ type: "text", text: buildErrorMessage(err, `disable collection for ${serviceName} on ${ipAddress}`) }], isError: true };
    }
  }
);
```

### Pattern 5: MonitoredServiceDTO TypeScript Interface

Derived from `OnmsMonitoredService.java` annotations:

```typescript
// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsMonitoredService.java
// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsServiceType.java

interface OnmsServiceType {
  id: number;     // @XmlAttribute(name="id")
  name: string;   // @Column(name="serviceName") — no @XmlAttribute, uses property name
}

interface MonitoredServiceDTO {
  // id: exposed as @JsonProperty("id") from getJsonId() (Integer), and as @XmlID from getXmlId() (String)
  // In JSON, "id" is an integer (from @JsonProperty("id") on getJsonId())
  id?: number;
  status?: string;     // @XmlAttribute — "A"=Managed, "F"=Forced Unmanaged, "U"=Unmanaged, "N"=Not Monitored
  statusLong?: string; // @XmlAttribute (transient) — human-readable: "Managed", "Forced Unmanaged", etc.
  source?: string;     // @XmlAttribute
  notify?: string;     // @Column(name="notify") — no @XmlAttribute in source; may be absent from JSON
  down?: boolean;      // @XmlAttribute(name="down") transient — computed from status and currentOutages
  ipAddress?: string;  // @JsonProperty("ipAddress") from getIpAddressAsString()
  ipInterfaceId?: number; // @JsonProperty("ipInterfaceId")
  nodeId?: number;     // @JsonProperty("nodeId") — transient
  nodeLabel?: string;  // @JsonProperty("nodeLabel") — transient
  serviceType?: OnmsServiceType; // @ManyToOne — nested object
}

// Helper to get the service name from a MonitoredServiceDTO
function getServiceName(svc: MonitoredServiceDTO): string {
  return svc.serviceType?.name ?? "(unknown)";
}

// Format one service entry for display
function formatService(svc: MonitoredServiceDTO): string {
  const name = getServiceName(svc);
  const statusCode = svc.status ?? "?";
  const statusLabel = svc.statusLong ?? statusCode;
  const down = svc.down ? "  [DOWN]" : "";
  return `${name}: ${statusLabel} (${statusCode})${down}`;
}
```

### Anti-Patterns to Avoid

- **Looking for a `collect` field on MonitoredService:** There is no `collect` boolean on `OnmsMonitoredService`. The SnmpInterfaceDTO has a `collect` field (for SNMP interface collection), but that is unrelated. Service-level collection is entirely controlled by `status`. Do not confuse the two.
- **Using `status=S` or `status=R`:** These are legacy "Rescan to Suspend" / "Rescan to Resume" codes. The `updateService()` method normalizes `S` → `F` and `R` → `A` internally, but the canonical values to send are `F` (disable) and `A` (enable).
- **Accessing `resp.data.services`:** The root JSON key is `"service"` (singular), not `"services"`. The `@JsonProperty("service")` annotation on `getObjects()` in `OnmsMonitoredServiceList.java` is the authoritative source.
- **Using client.v2 for these operations:** There is no v2 monitored service endpoint under `/api/v2/nodes/{id}/ipinterfaces/{ip}/services`. The `NodeMonitoredServiceRestService.java` in the v2 package handles `/api/v2/nodes/{id}/ipinterfaces/{ip}/services` reads but it is a separate v2 surface. Use `client.v1` throughout Phase 5 to stay consistent with the established v1-for-writes pattern and avoid path confusion.
- **Treating HTTP 304 as an error:** The `updateService()` method returns `Response.notModified().build()` (304) when no change was made (e.g., enabling a service that is already enabled). Axios does not throw on 304; do not treat it as a failure.
- **URL-encoding the IP address manually:** Pass the IP address string directly. The v1 endpoint accepts it as a `@PathParam("ipAddress") String ipAddress` and passes it to `InetAddressUtils.getInetAddress(ipAddress)`. Axios URL-encodes path segments automatically when built into the URL string — do not call `encodeURIComponent()` to avoid double-encoding.
- **URL-encoding the service name manually:** Same as IP address — pass service name directly (e.g., `"HTTP"`, `"SNMP"`). Axios handles encoding.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Service name lookup by type | Custom iteration over all services | Use service name directly as URL path param — `{service}` is resolved by `iface.getMonitoredServiceByServiceType(name)` | Already done server-side; no client-side lookup needed |
| Collection flag toggle | Custom boolean "collect" field update | PUT `status=A` or `status=F` via URLSearchParams | The model has no `collect` field; status IS the collection control |
| foreignSource:foreignId resolution | Separate GET to resolve to numeric ID | Pass directly — v1 `m_nodeDao.get(nodeCriteria)` accepts both formats | Same server-side resolution as v2 |
| IPv6 address encoding | Custom bracket or percent-encoding | Not needed for Phase 5 scope — IPv4 only; note the limitation in tool description if desired | IPv6 path encoding in JAX-RS is complex; defer to v2 scope |

**Key insight:** The `status` field is the single lever for service collection control. "Enable collection" = `status=A`. "Disable collection" = `status=F`. No other fields need to change.

---

## Common Pitfalls

### Pitfall 1: No `collect` Field — Status IS the Collection Flag

**What goes wrong:** Developer searches `OnmsMonitoredService.java` for a `collect` boolean and doesn't find one, then assumes the API is missing a feature or looks at `OnmsSnmpInterface` instead.

**Why it happens:** The term "collection config" implies a separate `collect` on/off flag. In OpenNMS, monitored service collection is controlled by `status`: `A` = active/collecting, `F` = forced unmanaged/not collecting.

**How to avoid:** Use `status=A` (enable) and `status=F` (disable) in the PUT body. Never reference a `collect` field on `OnmsMonitoredService`.

**Warning signs:** HTTP 400 "Unknown property" or BeanWrapper error in OpenNMS logs; silent no-op on the service.

### Pitfall 2: Wrong JSON Array Key (`"services"` vs `"service"`)

**What goes wrong:** `resp.data.services` is undefined; the service list appears empty even when services exist.

**Why it happens:** `OnmsMonitoredServiceList` uses `@JsonProperty("service")` (singular) on its `getObjects()` method, matching the JAXB pattern used throughout OpenNMS (alarm/event/node/outage lists all use singular keys).

**How to avoid:** Use `resp.data?.service` (singular) to access the array.

**Warning signs:** Zero services returned or `TypeError` even when the node has monitored services.

### Pitfall 3: Service Name Case Sensitivity

**What goes wrong:** PUT to `.../services/icmp` returns HTTP 400 "Monitored Service icmp was not found" even though the service appears as "ICMP" in the list response.

**Why it happens:** `iface.getMonitoredServiceByServiceType(serviceName)` performs a case-sensitive string comparison against the service type name stored in the database. OpenNMS stores service names in their canonical case (e.g., `"ICMP"`, `"SNMP"`, `"HTTP"`).

**How to avoid:** Use the service name exactly as returned by `list_node_services`. Document this in the tool description. Optionally instruct Claude to match the exact service name from the list.

**Warning signs:** HTTP 400 from the PUT endpoint even though the service clearly exists.

### Pitfall 4: HTTP 304 Not Modified Is Not an Error

**What goes wrong:** `axios` does not throw on 304, but a developer might add a check for `resp.status !== 204` and incorrectly treat 304 as failure.

**Why it happens:** `updateService()` returns 304 when the service was already in the requested state (idempotent). This is correct REST behavior.

**How to avoid:** Do not check response status after the PUT. Simply `await client.v1.put(...)` — if no exception is thrown, it succeeded (whether 204 or 304).

**Warning signs:** Enable/disable appears to fail even though the service is in the correct state on the server.

### Pitfall 5: IP Address Not Found If Format Differs From Stored Value

**What goes wrong:** `node.getIpInterfaceByIpAddress("10.0.0.1")` returns null if the address is stored as `"10.0.0.001"` or normalized differently.

**Why it happens:** The v1 method `getIpInterfaceByIpAddress(String)` passes through `InetAddressUtils.getInetAddress(ipAddress)` which normalizes the address. This usually works, but the user must supply the address in a valid format.

**How to avoid:** Instruct users (via tool description) to use the IP address exactly as shown in the list output from `get_node_ip_interfaces`. The normalized format from that tool's response will match what the v1 endpoint expects.

**Warning signs:** HTTP 400 "IP Interface X was not found on node Y" even though the interface exists.

---

## Code Examples

Verified patterns from Java source:

### List Services Request (v1 GET)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OnmsMonitoredServiceResource.java
// @GET @Produces({APPLICATION_XML, APPLICATION_JSON})
// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsMonitoredServiceList.java
// @JsonProperty("service") — array key is "service" (singular)

const resp = await client.v1.get(`/nodes/${nodeId}/ipinterfaces/${ipAddress}/services`);
// resp.data: { service: MonitoredServiceDTO[] }  ← "service" not "services"
const services = resp.data?.service as MonitoredServiceDTO[];
// Each service has: status ("A"/"F"/etc), statusLong, serviceType: { name: "ICMP" }, down, ipAddress
```

### Enable Collection (v1 PUT, status=A)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OnmsMonitoredServiceResource.java
// @PUT @Consumes(MediaType.APPLICATION_FORM_URLENCODED) @Path("{service}")
// BeanWrapper sets "status" property; "A" triggers RESUME_POLLING_SERVICE_EVENT_UEI
// Returns Response.noContent().build() (204) on change; Response.notModified().build() (304) if unchanged

const body = new URLSearchParams({ status: "A" });
await client.v1.put(`/nodes/${nodeId}/ipinterfaces/${ipAddress}/services/${serviceName}`, body);
// 204 = was disabled, now enabled; 304 = was already enabled; both are success
```

### Disable Collection (v1 PUT, status=F)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OnmsMonitoredServiceResource.java
// "F" triggers SUSPEND_POLLING_SERVICE_EVENT_UEI
// Returns 204 on change; 304 if already disabled

const body = new URLSearchParams({ status: "F" });
await client.v1.put(`/nodes/${nodeId}/ipinterfaces/${ipAddress}/services/${serviceName}`, body);
```

### Complete Status Values Reference

```typescript
// Source: opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsMonitoredService.java
// STATUS_MAP static initializer
const STATUS_MAP: Record<string, string> = {
  "A": "Managed",          // ← collection active; use status=A to enable
  "U": "Unmanaged",        // provisioning-set; not writable via REST in normal flow
  "D": "Deleted",          // soft-deleted
  "F": "Forced Unmanaged", // ← collection disabled; use status=F to disable
  "N": "Not Monitored",    // poller-set; not overridden by REST easily
  "R": "Rescan to Resume", // legacy alias for A (normalised to A by updateService)
  "S": "Rescan to Suspend",// legacy alias for F (normalised to F by updateService)
  "X": "Remotely Monitored",
};
// For Phase 5: only send "A" (enable) or "F" (disable). Read any value returned.
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Assumed separate `collect` boolean field | `status` field controls collection: "A"=enabled, "F"=disabled | Correct implementation; no separate field exists |
| Assumed v2 endpoint for service mutations | v1 `OnmsMonitoredServiceResource` for all three operations | v2 has a read-only surface; writes are v1 only |
| Assumed PUT body might be JSON | `@Consumes(APPLICATION_FORM_URLENCODED)` — must use URLSearchParams | Same pattern as alarm mutations (Phase 2) and node rescan (Phase 3) |

**API version summary for Phase 5:**
- `list_node_services`: v1 GET
- `enable_service_collection`: v1 PUT (status=A)
- `disable_service_collection`: v1 PUT (status=F)

---

## Open Questions

1. **Does `serviceType.name` appear in the JSON response from the list endpoint?**
   - What we know: `OnmsMonitoredService.getServiceType()` returns an `OnmsServiceType` object. `OnmsServiceType` has `@XmlRootElement(name="serviceType")` and `@Column(name="serviceName")` on `getName()`. There is no `@JsonIgnore` on the `getServiceType()` getter. Jackson will serialize the nested object.
   - What's unclear: Whether Jackson serializes the nested `serviceType` object fully (with `name`) or elides it in the list context.
   - Recommendation: Treat `serviceType?.name` as the service name field, with fallback to checking `ipAddress` field (also present on each service object). If `serviceType` is null in the response, the `getServiceName()` Transient method on the Java side is `@JsonIgnore`, so the name will only appear inside `serviceType`. Confidence: MEDIUM — inferred from model; verify with live server on first run.

2. **Does the v1 PUT accept `serviceName` with special characters (e.g., spaces)?**
   - What we know: Most OpenNMS service names are plain alphanumeric (ICMP, SNMP, HTTP, HTTPS). Axios will percent-encode path segments automatically.
   - What's unclear: Whether a service named e.g. "JMX-MX4J-Agents" with hyphens causes issues.
   - Recommendation: No special handling needed — hyphens are not percent-encoded and are valid in URLs. Axios handles unusual characters automatically.

---

## Sources

### Primary (HIGH confidence)

- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OnmsMonitoredServiceResource.java` — Definitive source: `@GET` list, `@GET @Path("{service}")` get, `@PUT @Consumes(FORM_URLENCODED) @Path("{service}")` update; status values A/F/S/R behavior; 204/304 responses; `m_nodeDao.get(nodeCriteria)` accepts both ID formats (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/OnmsIpInterfaceResource.java` line 255 — `@Path("{ipAddress}/services")` mounts `OnmsMonitoredServiceResource` (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/NodeRestService.java` line 342 — `@Path("{nodeCriteria}/ipinterfaces")` mounts `OnmsIpInterfaceResource`; confirms full path `/nodes/{nodeCriteria}/ipinterfaces/{ipAddress}/services` (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsMonitoredService.java` — Field annotations: `status` is `@XmlAttribute`; no `collect` field; `STATUS_MAP` confirms A/F/U/D/N/R/S/X values; `serviceType` relation to `OnmsServiceType` (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsMonitoredServiceList.java` — `@JsonProperty("service")` on `getObjects()` — array key is `"service"` (singular); `@JsonRootName("services")` — root object wrapper (in repo)
- `opennms/opennms-model/src/main/java/org/opennms/netmgt/model/OnmsServiceType.java` — `getName()` returns the service name (`"ICMP"`, `"SNMP"`, etc.); `@XmlRootElement(name="serviceType")` (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/IfServicesRestService.java` — Parallel ifservices endpoint confirming status values, SUSPEND/RESUME_POLLING_SERVICE_EVENT_UEI events, and 204/304 response pattern (in repo)

### Secondary (MEDIUM confidence)

- Phase 2 RESEARCH.md — established URLSearchParams + v1 PUT pattern for form-encoded mutations
- Phase 3 RESEARCH.md — established `client.v1` vs `client.v2` selection, nodeCriteria dual-format handling
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v2/NodeMonitoredServiceRestService.java` — v2 surface exists for reads, confirms v2 path is `/api/v2/nodes/{id}/ipinterfaces/{ip}/services`; confirms writes should stay on v1

### Tertiary (LOW confidence)

- `serviceType.name` nested object serialization in list response — inferred from model annotations; no direct JSON response sample available; verify on first live test

---

## Metadata

**Confidence breakdown:**
- API endpoints and HTTP methods: HIGH — verified from Java `@Path`, `@GET`, `@PUT`, `@Consumes` annotations in repo source
- Status field values and semantics: HIGH — `STATUS_MAP` static initializer in `OnmsMonitoredService.java` is definitive
- JSON array key ("service" singular): HIGH — `@JsonProperty("service")` in `OnmsMonitoredServiceList.java` confirmed
- PUT response codes (204/304): HIGH — Java source uses `Response.noContent().build()` and `Response.notModified().build()` explicitly
- `serviceType.name` in JSON response: MEDIUM — inferred from model; no `@JsonIgnore` on `getServiceType()`; verify with live server
- nodeCriteria dual-format (numeric + foreignSource:foreignId): HIGH — `m_nodeDao.get(nodeCriteria)` call confirmed in `OnmsMonitoredServiceResource.java`

**Blocker resolution:** The STATE.md blocker "Collection config enable/disable API endpoints were not fully verified" is now fully resolved. The endpoints are confirmed in Java source. The `collect` field concern is resolved: there is no separate `collect` field; `status=A`/`status=F` is the correct mechanism.

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (v1 REST monitored service API is stable; unchanged across many OpenNMS major versions)
