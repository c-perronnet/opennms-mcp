# Phase 2: Alarms - Research

**Researched:** 2026-03-02
**Domain:** OpenNMS Alarm REST API (v1 + v2), MCP tool handler patterns
**Confidence:** HIGH — primary sources are OpenNMS Java source (in repo), official REST docs (in repo), and Phase 1 established patterns

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ALARM-01 | User can list alarms, optionally filtered by FIQL expression (e.g. severity, node label, UEI) | v2 GET `/api/v2/alarms?_s=<fiql>` with optional `limit` and `offset` params; `list_alarms` tool pattern documented |
| ALARM-02 | User can get a specific alarm by ID | v2 GET `/api/v2/alarms/{id}`; returns full AlarmDTO JSON; `get_alarm` tool pattern documented |
| ALARM-03 | User can acknowledge an alarm by ID | v1 PUT `/opennms/rest/alarms/{id}` with form body `ack=true`; `Content-Type: application/x-www-form-urlencoded` confirmed from Java source |
| ALARM-04 | User can unacknowledge an alarm by ID | Same v1 PUT endpoint with form body `ack=false` |
| ALARM-05 | User can clear an alarm by ID | v1 PUT with form body `clear=true` |
| ALARM-06 | User can escalate an alarm by ID | v1 PUT with form body `escalate=true` |
| ALARM-07 | Alarm list results include: ID, severity, node label, description, time, ack status | AlarmDTO fields confirmed: `id`, `severity`, `nodeLabel`, `description`, `lastEventTime`, `ackUser` (null = unacked); formatting pattern documented |
| ALARM-08 | User can control result limit (default 25) when listing alarms | `limit` query parameter on v2 API; Zod input schema with `.default(25)` documented |
</phase_requirements>

---

## Summary

Phase 2 implements four MCP tools — `list_alarms`, `get_alarm`, `acknowledge_alarm`, and a combined `modify_alarm` — that together give Claude full alarm visibility and triage capability. The API split established in Phase 1 applies here exactly: **v2 API for reads** (GET list and by-ID, both support FIQL and JSON), **v1 API for writes** (acknowledge, unacknowledge, clear, escalate via form-encoded PUT).

The highest-risk item in this phase is the `Content-Type` mismatch for mutation calls. The v1 REST API `PUT /opennms/rest/alarms/{id}` is annotated `@Consumes(MediaType.APPLICATION_FORM_URLENCODED)` in Java source, meaning the body MUST be `application/x-www-form-urlencoded`, not JSON. The axios v1 instance currently sets `Content-Type: application/json` globally, so mutation calls must override this header per-request. The correct pattern is to send a URLSearchParams body (which causes axios to set the correct Content-Type automatically) or use an explicit header override.

The second important finding is that the v1 PUT mutation returns HTTP 204 No Content on success — not a JSON body. Tool handlers must check for 204 and return a confirmation message based on the action taken, not parse response data.

**Primary recommendation:** Implement in two plans: Plan 01 — read tools (`list_alarms`, `get_alarm`); Plan 02 — mutation tools (`acknowledge_alarm`, and a single `modify_alarm` tool for unack/clear/escalate). Use URLSearchParams for all v1 PUT bodies to avoid Content-Type conflict.

---

## Standard Stack

### Core (all established in Phase 1 — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.27.1 | `server.tool()` registration for all alarm tools | Official MCP SDK; already installed |
| `axios` | 1.13.6 | HTTP client; `client.v2` for reads, `client.v1` for writes | Already installed; Phase 1 established pattern |
| `zod` | ^3.25.0 | Input schema for tool args (limit, filter, alarmId) | Already installed; MCP SDK peer dep |

### No New Dependencies

Phase 2 requires no new npm packages. All alarm functionality is implementable with:
- `URLSearchParams` — built-in Node.js global; used for form-encoded PUT body
- `client.v2.get()` — for list and get-by-id (FIQL, JSON response)
- `client.v1.put()` — for ack/unack/clear/escalate (form body, 204 response)

**Installation:** Nothing new to install.

---

## Architecture Patterns

### Recommended File Structure

```
src/
├── index.ts          # Phase 1: wire server + transport; Phase 2: import and call registerAlarmTools()
├── config.ts         # Phase 1: config loading (untouched)
├── client.ts         # Phase 1: createApiClient() (untouched)
└── tools/
    └── alarms.ts     # Phase 2: all 4 alarm tools registered here
```

**Why a separate tools/alarms.ts file:** Keeps index.ts clean; each domain gets its own file in subsequent phases (tools/nodes.ts, tools/events.ts). The pattern is `registerAlarmTools(server, client, config)` — all tools receive the same dependencies injected from index.ts.

### Pattern 1: registerAlarmTools() Function

**What:** A function that registers all alarm MCP tools onto the server instance.
**When to use:** Called once in index.ts after server creation, before server.connect().

```typescript
// src/tools/alarms.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

export function registerAlarmTools(
  server: McpServer,
  client: ApiClient,
  config: OpenNMSConfig,
): void {
  // Register list_alarms, get_alarm, acknowledge_alarm, modify_alarm
}
```

```typescript
// src/index.ts — after Step 4 (create server), before Step 6 (connect transport)
import { registerAlarmTools } from "./tools/alarms.js";

registerAlarmTools(server, client, config);
```

### Pattern 2: list_alarms Tool (v2 API, FIQL + limit)

**What:** List alarms with optional FIQL filter and configurable limit. Returns formatted summary per alarm.
**API:** GET `/api/v2/alarms?limit=N&_s=<fiql>`

```typescript
// Source: opennms/docs/modules/development/pages/rest/alarms.adoc (in repo)
// Source: opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/AlarmCollectionDTO.java

server.tool(
  "list_alarms",
  "List OpenNMS alarms. Optionally filter with a FIQL expression (e.g. 'severity==CRITICAL', 'node.label==myserver'). Returns ID, severity, node, description, time, and ack status for each alarm.",
  {
    filter: z.string().optional().describe(
      "FIQL filter expression. Examples: 'severity==CRITICAL', 'node.label==myserver', 'alarm.uei==uei.opennms.org/nodes/nodeDown'. Omit for all alarms."
    ),
    limit: z.number().int().min(1).max(1000).default(25).describe(
      "Maximum number of alarms to return (default 25, max 1000)."
    ),
  },
  async ({ filter, limit }) => {
    try {
      const params: Record<string, string | number> = { limit };
      if (filter) {
        params._s = filter;
      }
      const resp = await client.v2.get("/alarms", { params });

      // v2 returns { alarm: [...], totalCount: N, count: N, offset: N }
      // If no alarms: HTTP 204 No Content (resp.data is empty)
      if (resp.status === 204 || !resp.data?.alarm?.length) {
        return {
          content: [{ type: "text", text: "No alarms found matching the given filter." }],
        };
      }

      const alarms = resp.data.alarm as AlarmDTO[];
      const totalCount: number = resp.data.totalCount ?? alarms.length;

      const lines = alarms.map((a) => formatAlarmSummary(a));
      const header = `Alarms: ${alarms.length} of ${totalCount} total`;
      const text = [header, "", ...lines].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: buildErrorMessage(err, "list alarms") }],
        isError: true,
      };
    }
  }
);
```

### Pattern 3: get_alarm Tool (v2 API by ID)

**What:** Retrieve a single alarm by numeric ID with full details.
**API:** GET `/api/v2/alarms/{id}`

```typescript
// Source: opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/AlarmDTO.java

server.tool(
  "get_alarm",
  "Get full details for a specific OpenNMS alarm by its numeric ID.",
  {
    id: z.number().int().positive().describe("The numeric ID of the alarm."),
  },
  async ({ id }) => {
    try {
      const resp = await client.v2.get(`/alarms/${id}`);
      const alarm = resp.data as AlarmDTO;
      return {
        content: [{ type: "text", text: formatAlarmDetail(alarm) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: buildErrorMessage(err, `alarm ${id}`) }],
        isError: true,
      };
    }
  }
);
```

### Pattern 4: Alarm Mutations — Form-Encoded PUT to v1

**What:** Acknowledge, unacknowledge, clear, or escalate an alarm via v1 REST API.
**API:** PUT `/opennms/rest/alarms/{id}` with `Content-Type: application/x-www-form-urlencoded`
**Critical:** The Java source annotates this endpoint `@Consumes(MediaType.APPLICATION_FORM_URLENCODED)`. Sending JSON body results in 415 Unsupported Media Type.
**Response:** HTTP 204 No Content on success (no body to parse).

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/AlarmRestService.java

// Helper: send a form-encoded PUT to v1 alarms endpoint
async function putAlarmAction(
  client: ApiClient,
  alarmId: number,
  action: "ack" | "unack" | "clear" | "escalate"
): Promise<void> {
  // Build form body: ack=true, ack=false, clear=true, escalate=true
  const body = new URLSearchParams();
  if (action === "ack") body.set("ack", "true");
  else if (action === "unack") body.set("ack", "false");
  else if (action === "clear") body.set("clear", "true");
  else if (action === "escalate") body.set("escalate", "true");

  // URLSearchParams body causes axios to auto-set Content-Type: application/x-www-form-urlencoded
  // This overrides the global Content-Type: application/json set on the v1 instance
  await client.v1.put(`/alarms/${alarmId}`, body);
  // Returns 204 No Content — no response body to parse
}

server.tool(
  "acknowledge_alarm",
  "Acknowledge an OpenNMS alarm by ID. The alarm will be marked as acknowledged by the current user.",
  {
    id: z.number().int().positive().describe("The numeric ID of the alarm to acknowledge."),
  },
  async ({ id }) => {
    try {
      await putAlarmAction(client, id, "ack");
      return {
        content: [{ type: "text", text: `Alarm ${id} acknowledged.` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: buildErrorMessage(err, `acknowledge alarm ${id}`) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "modify_alarm",
  "Modify an OpenNMS alarm by ID. Actions: 'unacknowledge' removes the ack, 'clear' resolves the alarm, 'escalate' raises severity.",
  {
    id: z.number().int().positive().describe("The numeric ID of the alarm to modify."),
    action: z.enum(["unacknowledge", "clear", "escalate"]).describe(
      "Action to perform: 'unacknowledge' removes acknowledgement, 'clear' resolves the alarm, 'escalate' raises its severity."
    ),
  },
  async ({ id, action }) => {
    try {
      const apiAction = action === "unacknowledge" ? "unack" : action as "clear" | "escalate";
      await putAlarmAction(client, id, apiAction);
      const actionLabel = action === "unacknowledge" ? "unacknowledged" : action === "clear" ? "cleared" : "escalated";
      return {
        content: [{ type: "text", text: `Alarm ${id} ${actionLabel}.` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: buildErrorMessage(err, `${action} alarm ${id}`) }],
        isError: true,
      };
    }
  }
);
```

### Pattern 5: Alarm Field Formatting Helpers

**What:** Format AlarmDTO fields for human-readable MCP responses.
**When to use:** In `list_alarms` (summary) and `get_alarm` (detail).

Key fields from `AlarmDTO.java` (authoritative — Java XML serialization drives JSON field names):
- `id` — integer, alarm database ID
- `severity` — string: INDETERMINATE, CLEARED, NORMAL, WARNING, MINOR, MAJOR, CRITICAL
- `nodeLabel` — string, node name (null if no node association)
- `nodeId` — integer
- `description` — string, full description (may contain HTML)
- `logMessage` — string, shorter human-friendly message
- `lastEventTime` — Date (serialized as ISO-8601 or epoch ms in JSON)
- `firstEventTime` — Date
- `uei` — string, event UEI
- `count` — integer, event deduplication count
- `ackUser` — string, null if unacknowledged
- `ackTime` — Date, null if unacknowledged
- `reductionKey` — string

```typescript
// Ack status: ackUser is null when unacknowledged, populated when acknowledged
function formatAckStatus(alarm: AlarmDTO): string {
  if (alarm.ackUser) {
    const ackTime = alarm.ackTime ? new Date(alarm.ackTime).toISOString() : "unknown time";
    return `Acknowledged by ${alarm.ackUser} at ${ackTime}`;
  }
  return "Unacknowledged";
}

function formatAlarmSummary(alarm: AlarmDTO): string {
  const time = alarm.lastEventTime ? new Date(alarm.lastEventTime).toISOString() : "unknown";
  const node = alarm.nodeLabel ?? `node ${alarm.nodeId}` ?? "no node";
  const ack = formatAckStatus(alarm);
  return [
    `ID: ${alarm.id}  Severity: ${alarm.severity}  Node: ${node}`,
    `  Description: ${alarm.logMessage ?? alarm.description ?? "none"}`,
    `  Last event: ${time}  ${ack}`,
  ].join("\n");
}

function formatAlarmDetail(alarm: AlarmDTO): string {
  // Full detail view for get_alarm
  return JSON.stringify(alarm, null, 2);
  // Or a structured multi-field text format
}
```

### Anti-Patterns to Avoid

- **Sending JSON body to v1 PUT:** The v1 alarm mutation endpoint `@Consumes(APPLICATION_FORM_URLENCODED)` — sending `Content-Type: application/json` returns 415. Use `URLSearchParams` body.
- **Parsing response body after PUT mutations:** PUT `/opennms/rest/alarms/{id}` returns HTTP 204 No Content. `resp.data` will be empty/null. Return a confirmation message based on the action, not the response.
- **Using v1 API for reads:** v1 list alarms does not support FIQL. Use `client.v2.get("/alarms")` for all read operations.
- **Using v2 API for writes:** v2 alarms endpoint does not support acknowledge/clear/escalate. These mutations only exist on v1.
- **Ignoring HTTP 204 from list endpoint:** When there are no matching alarms, the v2 API MAY return 204 No Content instead of `{ alarm: [] }`. Check `resp.status === 204` before accessing `resp.data.alarm`.
- **Double-encoding FIQL special characters:** The docs note that FIQL reserved characters (comma, semicolon) in values must be double-percent-encoded (`%252C`). Axios handles the first encoding; users/Claude must know to double-encode. Do NOT URL-encode the FIQL expression before passing to axios params — axios handles the outer encoding.
- **Forgetting `.js` extension on import:** `import { registerAlarmTools } from "./tools/alarms.js"` — not `.ts`. Phase 1 ESM requirement applies.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form-encoded HTTP body | Custom string concatenation `"ack=true&escalate=false"` | `new URLSearchParams()` | URLSearchParams handles encoding edge cases; axios detects the type and sets Content-Type automatically |
| FIQL query construction | String template literals concatenating conditions | Pass user-supplied FIQL string directly (or build with simple `==` comparisons) | FIQL is a complex grammar; complex builder out of scope for v1 |
| Alarm field normalization | Custom date parsing or severity mapping | Use raw API values; just format for display | OpenNMS severity strings and ISO dates are already human-readable |
| Response 404 detection | Custom HTTP status checking | `buildErrorMessage()` from Phase 1 already handles 404 | Already implemented and tested |

**Key insight:** URLSearchParams is the correct way to produce `application/x-www-form-urlencoded` bodies in Node.js. When passed as the axios request body, axios automatically sets the correct Content-Type header, overriding any default set on the instance.

---

## Common Pitfalls

### Pitfall 1: Content-Type Conflict on v1 PUT Mutations

**What goes wrong:** The v1 axios instance has `Content-Type: application/json` set globally (Phase 1 client.ts). When a tool handler calls `client.v1.put('/alarms/42', { ack: 'true' })` with a plain JS object, axios sends `application/json`. The Java endpoint annotated `@Consumes(APPLICATION_FORM_URLENCODED)` rejects this with HTTP 415 Unsupported Media Type.

**Why it happens:** The per-instance Content-Type override is easy to miss when the same instance is used for JSON reads elsewhere.

**How to avoid:** Always use `new URLSearchParams()` as the PUT body for alarm mutations. Axios automatically detects this type and sets `Content-Type: application/x-www-form-urlencoded`, overriding the instance default for that specific request.

**Warning signs:** `buildErrorMessage()` returns `OpenNMS API error (HTTP 415)` when attempting to acknowledge/clear/escalate an alarm.

### Pitfall 2: Treating 204 as an Error on Read

**What goes wrong:** `GET /api/v2/alarms?_s=severity==CRITICAL` when no alarms match returns HTTP 204 No Content. If the handler tries `resp.data.alarm.length`, it throws a TypeError because `resp.data` is undefined or empty string.

**Why it happens:** Developers assume the API always returns a JSON body.

**How to avoid:** Check `if (resp.status === 204 || !resp.data?.alarm?.length)` before accessing alarm array. Return "No alarms found" text content.

**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'alarm')` in the tool handler.

### Pitfall 3: URL-Encoding the FIQL Filter Before Passing to Axios

**What goes wrong:** Doing `params._s = encodeURIComponent(filter)` causes double-encoding. Axios encodes query parameters automatically; pre-encoding produces `%2528` instead of `%28`.

**Why it happens:** Defensive coding habit when unfamiliar with axios param serialization.

**How to avoid:** Pass the raw FIQL string as `params._s = filter`. Axios handles encoding the entire `?_s=...` query string.

**Warning signs:** The server returns 0 results or a 400 error even when alarms exist matching the intended filter. The actual HTTP request URL shows `%25` sequences.

### Pitfall 4: FIQL Reserved Characters in Values

**What goes wrong:** A FIQL filter like `alarm.reductionKey==uei.opennms.org/nodes/nodeLostService::*:HTTP,8080` contains a comma — a FIQL reserved character. The API interprets it as an OR operator, breaking the query.

**Why it happens:** FIQL uses commas for OR and semicolons for AND. These are reserved characters in FIQL expressions.

**How to avoid:** Per the official docs, double percent-encode reserved characters in FIQL values: comma → `%252C`, semicolon → `%253B`. This applies to commas in service names, reduction keys, or UEIs that contain commas.

**Warning signs:** Unexpected alarm counts when filtering by reduction key or service name containing special characters.

### Pitfall 5: TypeScript Type Annotation on AlarmDTO Response

**What goes wrong:** `const alarms = resp.data.alarm` has type `any`. TypeScript allows accessing undefined fields without warning.

**Why it happens:** Axios response data is typed as `any` by default.

**How to avoid:** Define a minimal `AlarmDTO` interface in `tools/alarms.ts` and cast: `const alarms = resp.data.alarm as AlarmDTO[]`. This catches field name typos at compile time.

**Warning signs:** Alarm fields like `logMessage` are silently undefined at runtime despite TypeScript not complaining.

---

## Code Examples

Verified patterns from official sources:

### v2 API List Request (with FIQL)

```typescript
// Source: opennms/docs/modules/development/pages/rest/alarms.adoc
// GET /api/v2/alarms?_s=severity==CRITICAL&limit=25
const resp = await client.v2.get("/alarms", {
  params: { limit: 25, _s: "severity==CRITICAL" }
});
// resp.data: { alarm: AlarmDTO[], totalCount: number, count: number, offset: number }
// or HTTP 204 if no matches
```

### v2 API Get by ID

```typescript
// GET /api/v2/alarms/42
const resp = await client.v2.get("/alarms/42");
// resp.data: AlarmDTO
// throws AxiosError with status 404 if not found — handled by buildErrorMessage()
```

### v1 API Acknowledge (URLSearchParams body)

```typescript
// Source: opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/AlarmRestService.java
// PUT /opennms/rest/alarms/42
// Body: ack=true  (application/x-www-form-urlencoded)
// Response: 204 No Content

const body = new URLSearchParams({ ack: "true" });
await client.v1.put("/alarms/42", body);
// axios detects URLSearchParams, sets Content-Type: application/x-www-form-urlencoded automatically
// Do NOT check resp.data — it will be empty on 204
```

### v1 API Unacknowledge

```typescript
const body = new URLSearchParams({ ack: "false" });
await client.v1.put("/alarms/42", body);
```

### v1 API Clear

```typescript
const body = new URLSearchParams({ clear: "true" });
await client.v1.put("/alarms/42", body);
```

### v1 API Escalate

```typescript
const body = new URLSearchParams({ escalate: "true" });
await client.v1.put("/alarms/42", body);
```

### FIQL Examples (from official docs)

```
# Filter by severity
severity==CRITICAL

# Filter by node label
node.label==myserver

# Filter by UEI
alarm.uei==uei.opennms.org/nodes/nodeDown

# Filter by IP address
alarm.ipAddr==192.168.1.1

# Filter by reduction key prefix
alarm.reductionKey==uei.opennms.org/nodes/nodeDown::*

# Combine with ; (AND)
severity==CRITICAL;node.label==myserver
```

### Minimal AlarmDTO TypeScript Interface

```typescript
// Define in src/tools/alarms.ts
interface AlarmDTO {
  id: number;
  severity: string;          // INDETERMINATE | CLEARED | NORMAL | WARNING | MINOR | MAJOR | CRITICAL
  nodeId?: number;
  nodeLabel?: string;
  uei?: string;
  description?: string;
  logMessage?: string;
  firstEventTime?: string;   // ISO-8601 date
  lastEventTime?: string;    // ISO-8601 date
  count?: number;
  ackUser?: string;          // null/undefined if unacknowledged
  ackTime?: string;          // null/undefined if unacknowledged
  reductionKey?: string;
}

interface AlarmListResponse {
  alarm: AlarmDTO[];
  totalCount: number;
  count: number;
  offset: number;
}
```

---

## Tool Design Decisions

### How Many Tools?

**Decision: 3 tools** — `list_alarms`, `get_alarm`, `acknowledge_alarm` + `modify_alarm`.

Splitting acknowledge into its own tool (vs a single generic mutation tool) is intentional:
- Acknowledging is the most common alarm operation — natural language "acknowledge alarm 42" maps cleanly to one tool
- Unacknowledge, clear, and escalate are rarer and grouped into `modify_alarm` with an `action` enum
- This matches ALARM-03 requirement specifically calling out acknowledge as distinct

Alternative considered: single `manage_alarm` tool with all four actions. Rejected because acknowledging is so common that giving it a dedicated tool improves Claude's ability to identify intent.

### Output Format

**Decision: Structured text, not JSON** — for list/get responses.

Raw JSON dumps are verbose and hard for Claude to reason about. Format as readable text:
```
ID: 42  Severity: CRITICAL  Node: myserver
  Description: Node myserver is down
  Last event: 2026-03-02T18:00:00Z  Unacknowledged
```

For `get_alarm` (full detail), JSON is acceptable since users requesting a specific alarm likely want complete data.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| v1 API for reads (no FIQL) | v2 API for reads with FIQL support | Natural language filtering — "show me CRITICAL alarms on server X" maps to FIQL |
| POST /rest/acks (acknowledgements endpoint) | PUT /rest/alarms/{id}?ack=true | Both work; PUT is simpler (one endpoint, query param); OpenNMS UI uses PUT pattern |
| `application/json` Content-Type for all requests | `application/x-www-form-urlencoded` for v1 PUT mutations | Enforced by Java `@Consumes` annotation; must use URLSearchParams |

**Deprecated/outdated:**
- POST `/opennms/rest/acks` with `alarmId=42&action=ack`: Works but requires knowing the `/acks` endpoint. The PUT pattern on `/rest/alarms/{id}` is cleaner and what the OpenNMS UI uses (per `alarmService.ts`).

---

## Open Questions

1. **HTTP 204 behavior on empty v2 alarm list**
   - What we know: The OpenNMS UI service handles `resp.status === 204` returning `{ alarm: [], totalCount: 0, count: 0, offset: 0 }` (per `alarmService.ts` line 41)
   - What's unclear: Whether v2 API consistently returns 204 (vs 200 with empty array) when no alarms match FIQL
   - Recommendation: Check both — `resp.status === 204` OR `!resp.data?.alarm?.length` before accessing the array. The UI handles both defensively.

2. **Date format in v2 JSON response**
   - What we know: `AlarmDTO.java` uses `Date` fields; Jackson/JSON serialization typically outputs epoch milliseconds or ISO-8601 strings
   - What's unclear: Whether OpenNMS returns dates as ISO-8601 strings or epoch milliseconds in the v2 JSON response
   - Recommendation: Use `new Date(alarm.lastEventTime).toISOString()` which handles both formats (ISO string → passes through; epoch number → converts). If string is null/undefined, display "unknown".

3. **FIQL field name prefix for alarms**
   - What we know: Official docs show both `alarm.severity==CRITICAL` and `severity==CRITICAL` (without prefix)
   - What's unclear: Whether the prefix is optional or required
   - Recommendation: Document both forms in the tool description. Testing with a live instance would confirm, but both forms appear in the official examples.

---

## Sources

### Primary (HIGH confidence)

- `opennms/docs/modules/development/pages/rest/alarms.adoc` — REST API endpoints, PUT semantics, FIQL examples, Content-Type requirement (in repo)
- `opennms/docs/modules/development/pages/rest/acknowledgements.adoc` — POST /acks alternative (in repo)
- `opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/AlarmDTO.java` — Authoritative field list for v2 alarm JSON response (in repo)
- `opennms/features/rest/model/src/main/java/org/opennms/web/rest/model/v2/AlarmCollectionDTO.java` — v2 list response structure: `alarm` array with `totalCount`, `count`, `offset` (in repo)
- `opennms/opennms-webapp-rest/src/main/java/org/opennms/web/rest/v1/AlarmRestService.java` — `@Consumes(APPLICATION_FORM_URLENCODED)` annotation confirmed; ack/unack/clear/escalate param names confirmed (in repo)
- `opennms/ui/src/services/alarmService.ts` — Production TypeScript using `rest.put(url, '')` for mutations; `v2.get` for reads (in repo)
- `opennms/ui/src/types/index.ts` — `AlarmQueryParameters`, `AlarmApiResponse`, `QueryParameters._s` field (in repo)

### Secondary (MEDIUM confidence)

- Phase 1 RESEARCH.md and SUMMARY files — established patterns for `createApiClient()`, `buildErrorMessage()`, `server.tool()`, error handling
- Phase 1 STATE.md — decision: "v2 API for reads, v1 for writes"; "Axios over native fetch"

### Tertiary (LOW confidence)

- HTTP 204 behavior for empty v2 alarm list — inferred from OpenNMS UI defensive coding; not verified against live instance
- Date serialization format (ISO-8601 vs epoch ms) — not verified from Java source without reading Jackson config

---

## Metadata

**Confidence breakdown:**
- API endpoints and methods: HIGH — verified from Java source `@Path`, `@GET`, `@PUT`, `@Consumes` annotations
- Field names in AlarmDTO: HIGH — verified from Java `AlarmDTO.java` with `@XmlElement(name=...)` annotations
- Content-Type requirement for PUT: HIGH — `@Consumes(MediaType.APPLICATION_FORM_URLENCODED)` in Java source
- 204 response on empty list: MEDIUM — inferred from UI defensive code; unverified against live instance
- FIQL field prefix optionality: MEDIUM — official docs show both forms; not formally documented

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (OpenNMS REST API is stable; alarm API unchanged since Horizon 20.1.0 for v2 reads)
