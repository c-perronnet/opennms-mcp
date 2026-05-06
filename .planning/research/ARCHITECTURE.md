# Architecture Patterns

**Domain:** MCP server wrapping a REST API (OpenNMS network monitoring)
**Researched:** 2026-03-02
**Confidence:** HIGH — based on official MCP specification, official TypeScript SDK documentation with verified code examples from modelcontextprotocol.io, and OpenNMS source code in the repo

---

## Recommended Architecture

An MCP server that wraps a REST API has four distinct components that communicate in a strict one-way chain:

```
Claude CLI (MCP Host)
    |  stdio (JSON-RPC 2.0)
    v
MCP Server (McpServer instance)
    |  tool handler dispatch
    v
Tool Handlers (per domain: alarms, nodes, events, ...)
    |  calls
    v
API Client (axios instances with auth headers)
    |  HTTP
    v
OpenNMS REST API (v2 preferred, v1 fallback)
```

The Config Loader is a side-input that feeds the API Client at startup — it does not participate in the per-request path.

```
Config File (JSON on disk)
    |  fs.readFileSync at startup
    v
Config Loader
    |  validated config object
    v
API Client (sets baseURL + auth headers once at startup)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With | File(s) |
|-----------|---------------|-------------------|---------|
| **Entry point** | Wire everything together; create McpServer; register all tool modules; connect StdioServerTransport | McpServer, Config Loader, all tool files | `src/index.ts` |
| **Config Loader** | Read config file path from env/CLI arg; parse JSON; validate shape (url + basic or token); throw descriptive errors on bad config | Entry point only | `src/config.ts` |
| **API Client** | Hold axios instances for v2 and v1; inject auth headers (Basic or Bearer) at instance creation; set base URL; provide error utilities | Tool Handlers | `src/client.ts` |
| **Tool Handlers** | Define tool schema (Zod); implement handler function; call API Client; format results as MCP content; catch errors and return `isError: true` | API Client | `src/tools/*.ts` |
| **McpServer** | Accept tool registrations; handle JSON-RPC 2.0 lifecycle; route `tools/call` to registered handlers; respond to `tools/list` | Claude CLI via StdioServerTransport | `@modelcontextprotocol/sdk` (library) |
| **StdioServerTransport** | Read from `process.stdin`; write to `process.stdout`; frame JSON-RPC 2.0 messages | McpServer | `@modelcontextprotocol/sdk` (library) |

**Key boundary rule:** Tool handlers and all application code must never write to `process.stdout` or call `console.log()`. The StdioServerTransport owns stdout. All server-side logging goes to `console.error()` (stderr), which Claude CLI ignores.

---

## How Tool Registration Works with the MCP SDK

The `McpServer` class (from `@modelcontextprotocol/sdk/server/mcp.js`) exposes `registerTool(name, config, handler)`. Call it once per tool at startup, before connecting the transport.

Verified pattern from the official MCP TypeScript quickstart:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Step 1: Create server
const server = new McpServer({
  name: "opennms",
  version: "1.0.0",
});

// Step 2: Register tools (before connect)
server.registerTool(
  "alarm_list",                             // unique name: alphanumeric + _-.
  {
    description: "List alarms from OpenNMS, optionally filtered with FIQL (REST API v2)",
    inputSchema: {
      filter: z.string().optional().describe(
        "FIQL filter, e.g. 'alarm.severity==MAJOR'"
      ),
      limit: z.number().int().min(0).optional().describe(
        "Max results (0 = no limit, default 10)"
      ),
      offset: z.number().int().min(0).optional().describe(
        "Offset for pagination"
      ),
    },
  },
  async ({ filter, limit, offset }) => {
    // handler receives already-validated, typed arguments
    // must return { content: [...] } or { content: [...], isError: true }
    return {
      content: [{ type: "text", text: "..." }],
    };
  }
);

// Step 3: Connect transport (after all tools registered)
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenNMS MCP server running on stdio"); // stderr is safe
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

**Tool registration facts (HIGH confidence, from official spec + quickstart):**
- `name`: unique within server, 1-128 chars, allowed: `A-Za-z0-9_-.`, no spaces
- `inputSchema`: Zod object passed directly; SDK converts to JSON Schema for `tools/list` responses
- Handler receives already-validated, Zod-coerced arguments — no manual validation needed
- Handler must return `{ content: [{ type: "text", text: "..." }] }` on success
- Handler must return `{ content: [...], isError: true }` for API/business logic errors
- All `registerTool()` calls must happen before `server.connect()` — tools registered after are invisible to clients

---

## How to Handle Auth (Basic vs Token, Auto-Detection)

The config file supports two mutually exclusive auth modes detected by field presence:

```typescript
// src/config.ts

export interface BasicAuthConfig {
  url: string;       // e.g. "http://opennms:8980"
  username: string;
  password: string;
}

export interface TokenAuthConfig {
  url: string;
  token: string;
}

export type OpenNMSConfig = BasicAuthConfig | TokenAuthConfig;

export function isTokenAuth(config: OpenNMSConfig): config is TokenAuthConfig {
  return "token" in config && typeof (config as TokenAuthConfig).token === "string";
}

export function loadConfig(filePath: string): OpenNMSConfig {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  // Validate: url required; either (username+password) or token required
  if (!raw.url) throw new Error("Config missing 'url' field");
  if (!isTokenAuth(raw) && (!raw.username || !raw.password)) {
    throw new Error("Config must have either 'token' or both 'username' and 'password'");
  }
  // Strip trailing slash from URL
  raw.url = raw.url.replace(/\/$/, "");
  return raw as OpenNMSConfig;
}
```

Auth header injection in the API Client (built once at startup):

```typescript
// src/client.ts

function buildAuthHeaders(config: OpenNMSConfig): Record<string, string> {
  if (isTokenAuth(config)) {
    return { Authorization: `Bearer ${config.token}` };
  }
  const credentials = Buffer.from(
    `${config.username}:${config.password}`
  ).toString("base64");
  return { Authorization: `Basic ${credentials}` };
}

export function createApiClient(config: OpenNMSConfig) {
  const commonHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...buildAuthHeaders(config),  // injected once, inherited by all requests
  };

  // v2 API: FIQL queries, preferred for alarms, nodes, ip interfaces, events
  const v2 = axios.create({
    baseURL: `${config.url}/api/v2`,
    headers: commonHeaders,
    timeout: 30000,
  });

  // v1 API: form-encoded writes, categories, assets, collection, events POST
  const v1 = axios.create({
    baseURL: `${config.url}/opennms/rest`,
    headers: commonHeaders,
    timeout: 30000,
  });

  return { v2, v1 };
}

export type ApiClient = ReturnType<typeof createApiClient>;
```

**Auth detection rules:**
- `token` field present → Bearer token auth
- `username` + `password` present → HTTP Basic auth (most common default for OpenNMS)
- Config Loader validates exactly one mode; throws descriptive error if neither or both

---

## How stdio Transport Is Set Up

The stdio transport is two lines of code, following the official quickstart exactly:

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

`StdioServerTransport` reads JSON-RPC 2.0 messages from `process.stdin` and writes responses to `process.stdout`. The `connect()` call is async and returns once the handshake completes. The process stays alive waiting for messages — no explicit event loop management needed.

**Startup sequence:**

```
1. Load config (readFileSync)
2. Create API client (axios instances)
3. Create McpServer
4. registerTool() × N (all domains)
5. new StdioServerTransport()
6. await server.connect(transport)   ← process blocks here, listening on stdin
```

**Critical rule (HIGH confidence, official docs):** `console.log()` and `process.stdout.write()` anywhere in server code will corrupt the JSON-RPC byte stream and break all communication with Claude. Use `console.error()` exclusively for server-side output.

---

## How to Handle API Errors (the isError Pattern)

MCP defines two distinct error mechanisms (from the official spec):

1. **Protocol errors** — JavaScript exceptions thrown from the handler; the SDK converts these to JSON-RPC error responses. Use only for: unknown tool names, malformed requests (the SDK handles these automatically). Do not throw exceptions for API failures.

2. **Tool execution errors** — returned as `{ content: [...], isError: true }`. Use for: API call failed, OpenNMS unreachable, auth failure, 404, invalid parameters. Claude can read the content text and self-correct or report to the user.

Standard error handler pattern:

```typescript
// src/client.ts — reusable error formatter

export function buildErrorMessage(err: unknown, context: string): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      // Network error — OpenNMS not reachable
      return `Could not reach OpenNMS at ${context}. Is the server running? (${err.message})`;
    }
    const status = err.response.status;
    if (status === 401 || status === 403) {
      return `Authentication failed (HTTP ${status}). Check your credentials in the config file.`;
    }
    if (status === 404) {
      return `Not found (HTTP 404): ${context}`;
    }
    return `OpenNMS API error (HTTP ${status}): ${JSON.stringify(err.response.data)}`;
  }
  return `Unexpected error: ${String(err)}`;
}
```

Usage in every tool handler:

```typescript
server.registerTool("node_get", { ... }, async ({ nodeId }) => {
  try {
    const resp = await client.v2.get(`/nodes/${nodeId}`);
    return {
      content: [{ type: "text", text: JSON.stringify(resp.data, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: buildErrorMessage(err, `node ${nodeId}`) }],
      isError: true,
    };
  }
});
```

This produces messages Claude can report directly: "Could not reach OpenNMS at http://opennms:8980. Is the server running?" rather than raw stack traces.

---

## v1 vs v2 API Routing Per Tool

Decision is made at authoring time per tool — not dynamic. Document in each tool's description string.

| Domain | Operation | Endpoint | API Version | Rationale |
|--------|-----------|----------|-------------|-----------|
| Alarms | List | `/api/v2/alarms?_s=<FIQL>` | v2 | FIQL filtering available |
| Alarms | Get by ID | `/api/v2/alarms/{id}` | v2 | v2 exists and is preferred |
| Alarms | Acknowledge/Unacknowledge | `/opennms/rest/alarms/{id}?ack=true` | v1 | Mutation via PUT query param |
| Alarms | Clear | `/opennms/rest/alarms/{id}?clear=true` | v1 | v1 only |
| Alarms | Escalate | `/opennms/rest/alarms/{id}?escalate=true` | v1 | v1 only |
| Events | List | `/opennms/rest/events` | v1 | No v2 events endpoint in docs |
| Events | Get by ID | `/opennms/rest/events/{id}` | v1 | v1 only |
| Events | Send | `/opennms/rest/events` POST JSON | v1 | v1 POST accepts JSON body |
| Nodes | List | `/api/v2/nodes` | v2 | FIQL filtering available |
| Nodes | Get by ID | `/api/v2/nodes/{id}` | v2 | v2 preferred |
| Nodes | IP interfaces | `/api/v2/nodes/{id}/ipinterfaces` | v2 | v2 preferred |
| Nodes | SNMP interfaces | `/opennms/rest/nodes/{id}/snmpinterfaces` | v1 | UI uses v1 for this |
| Nodes | Rescan | `/opennms/rest/nodes/{id}/rescan` POST | v1 | v1 only |
| Categories | List | `/opennms/rest/categories` | v1 | v1 only |
| Categories | Assign to node | `/opennms/rest/nodes/{id}/categories` POST | v1 | v1 only |
| Categories | Remove from node | `/opennms/rest/nodes/{id}/categories/{name}` DELETE | v1 | v1 only |
| Assets | Get | `/opennms/rest/nodes/{id}/assetRecord` | v1 | v1 only |
| Assets | Update | `/opennms/rest/nodes/{id}/assetRecord` PUT | v1 | v1 only |
| Collection | List services | `/opennms/rest/ifservices?node.id={id}` | v1 | v1 query by node |
| Collection | Enable/Disable | `/opennms/rest/ifservices` PUT `status=A/F` | v1 | v1 form-encoded PUT |

---

## File/Directory Structure Recommendation

```
opennms-mcp/
├── src/
│   ├── index.ts              # Entry point: create server, load config, create client,
│   │                         #   import and call registerXxxTools(), connect transport
│   ├── config.ts             # loadConfig(): read JSON file, validate shape, return typed config
│   ├── client.ts             # createApiClient(): axios v2 + v1 instances; buildErrorMessage()
│   └── tools/
│       ├── alarms.ts         # registerAlarmTools(): alarm_list, alarm_get,
│       │                     #   alarm_acknowledge, alarm_unacknowledge, alarm_clear, alarm_escalate
│       ├── events.ts         # registerEventTools(): event_list, event_get, event_send
│       ├── nodes.ts          # registerNodeTools(): node_list, node_get, node_ip_interfaces,
│       │                     #   node_snmp_interfaces, node_rescan
│       ├── categories.ts     # registerCategoryTools(): category_list, node_category_assign,
│       │                     #   node_category_remove
│       ├── assets.ts         # registerAssetTools(): node_asset_get, node_asset_update
│       └── collection.ts     # registerCollectionTools(): collection_services_list,
│                             #   collection_enable, collection_disable
├── dist/                     # tsc output (gitignored)
├── package.json
├── tsconfig.json
└── opennms.example.json      # Example config for users to copy
```

**Dependency direction (no circular imports):**

```
index.ts
  imports config.ts       (reads config file)
  imports client.ts       (creates API client from config)
  imports tools/alarms.ts (passes server + client to registerAlarmTools)
  imports tools/events.ts
  ... etc.

tools/*.ts
  imports client.ts       (uses ApiClient type)
  does NOT import index.ts or other tool files
```

---

## Suggested Build Order

Build in this order to minimize blocked work and catch integration issues early.

### Step 1: Scaffold (required before anything else)
Everything else depends on this. Goal: a real MCP server that Claude can connect to.
- `tsconfig.json`, `package.json` with `"type": "module"` and build script
- `src/config.ts`: `loadConfig()` — read file, validate, return typed config
- `src/client.ts`: `createApiClient()` — axios instances, auth headers, `buildErrorMessage()`
- `src/index.ts`: create `McpServer`, load config, create client, register one stub `ping` tool, connect `StdioServerTransport`
- Verify: `npm run build && npx @modelcontextprotocol/inspector node dist/index.js` — confirm tool appears and responds

### Step 2: Alarms (highest value, validates v2 FIQL pattern)
Alarms are the most common OpenNMS use case. Completing all alarm tools proves the v2 API client and v1 mutation pattern work against a real OpenNMS.
- `alarm_list` — GET v2 with FIQL `_s=` param; tests FIQL query building
- `alarm_get` — GET v2 by ID; tests single-resource fetch
- `alarm_acknowledge`, `alarm_unacknowledge` — PUT v1 with `?ack=true/false`; tests v1 mutations
- `alarm_clear`, `alarm_escalate` — PUT v1; tests remaining alarm mutations

### Step 3: Events (independent of nodes)
Simpler domain. Send custom event is useful for testing end-to-end against OpenNMS.
- `event_list`, `event_get` — GET v1
- `event_send` — POST v1 JSON body; tests write-through to OpenNMS event bus

### Step 4: Nodes (required by categories, assets, collection)
Core entity. List and get are straightforward; sub-resource endpoints exercise nested URL patterns.
- `node_list`, `node_get` — GET v2
- `node_ip_interfaces`, `node_snmp_interfaces` — GET v2/v1 sub-resources
- `node_rescan` — POST v1; tests async operations (202 Accepted response)

### Step 5: Categories and Assets (depend on nodes being proven)
- `category_list`, `node_category_assign`, `node_category_remove` — v1 CRUD
- `node_asset_get`, `node_asset_update` — v1 GET/PUT on `assetRecord`

### Step 6: Collection Config (most complex, depends on nodes + ifservices)
The `ifservices` endpoint is unusual (bulk status update with query params). Requires understanding service status codes (`A` = active, `F` = forced unmanaged).
- `collection_services_list` — GET v1 `/ifservices?node.id={id}`
- `collection_enable` — PUT v1 with `status=A&services=<name>`
- `collection_disable` — PUT v1 with `status=F&services=<name>`

---

## Patterns to Follow

### Pattern 1: Domain Module Registers Its Own Tools

Each tool file exports a `registerXxxTools` function that takes the server and client. This is the only coupling between index.ts and tool files.

```typescript
// src/tools/alarms.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "../client.js";

export function registerAlarmTools(server: McpServer, client: ApiClient): void {
  server.registerTool("alarm_list", { ... }, async (args) => { ... });
  server.registerTool("alarm_get", { ... }, async (args) => { ... });
  // etc.
}
```

```typescript
// src/index.ts — import and call each domain module
import { registerAlarmTools } from "./tools/alarms.js";
import { registerEventTools } from "./tools/events.js";
// ...

registerAlarmTools(server, client);
registerEventTools(server, client);
```

Adding a new domain: create one file, add two lines in `index.ts`.

### Pattern 2: v2 First, v1 for Mutations and Missing Endpoints

Decide at authoring time; document in the tool description:

```typescript
server.registerTool(
  "alarm_list",
  {
    description: "List alarms from OpenNMS with optional FIQL filtering (REST API v2)",
    inputSchema: { ... },
  },
  async ({ filter, limit, offset }) => {
    const params: Record<string, string | number> = {};
    if (filter) params["_s"] = filter;
    if (limit !== undefined) params["limit"] = limit;
    if (offset !== undefined) params["offset"] = offset;
    const resp = await client.v2.get("/alarms", { params });
    ...
  }
);
```

Never attempt dynamic fallback between v1 and v2 — it adds error handling complexity without benefit.

### Pattern 3: Zod Schemas as Single Source of Truth

Define Zod schemas inline in `registerTool`. The SDK converts them to JSON Schema for `tools/list`. TypeScript infers handler argument types automatically.

```typescript
server.registerTool(
  "alarm_acknowledge",
  {
    description: "Acknowledge an alarm by ID",
    inputSchema: {
      alarmId: z.number().int().positive().describe("Alarm database ID"),
      ackUser: z.string().optional().describe(
        "Acknowledge as this user (requires admin role; defaults to config user)"
      ),
    },
  },
  async ({ alarmId, ackUser }) => {
    // TypeScript knows: alarmId is number, ackUser is string|undefined
    const params: Record<string, string> = { ack: "true" };
    if (ackUser) params["ackUser"] = ackUser;
    await client.v1.put(`/alarms/${alarmId}`, null, { params });
    return {
      content: [{ type: "text", text: `Alarm ${alarmId} acknowledged.` }],
    };
  }
);
```

### Pattern 4: Human-Readable Structured Text Responses

Format responses for Claude to read and reason about. Return context-rich text, not raw API dumps.

```typescript
// For lists: include count context
const alarms = resp.data.alarm ?? [];
const total = resp.data.totalCount ?? alarms.length;
return {
  content: [{
    type: "text",
    text: `Found ${alarms.length} of ${total} total alarms:\n\n${JSON.stringify(alarms, null, 2)}`,
  }],
};

// For single items: clean JSON with indentation
return {
  content: [{
    type: "text",
    text: JSON.stringify(resp.data, null, 2),
  }],
};

// For mutations (ack, clear, etc.): confirmation message
return {
  content: [{ type: "text", text: `Alarm ${alarmId} acknowledged.` }],
};
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Writing to stdout

**What goes wrong:** `console.log()` anywhere in server code corrupts the JSON-RPC stream and silently breaks all Claude communication.

**Prevention:** Use `console.error()` exclusively. Consider adding ESLint rule `"no-console": ["error", { "allow": ["error"] }]` to enforce this.

### Anti-Pattern 2: Throwing Exceptions for API Failures

**What goes wrong:** An uncaught exception from a tool handler produces a JSON-RPC protocol error — Claude sees a server bug, not an actionable message. Claude cannot self-correct from protocol errors.

**Prevention:** Every tool handler has a try/catch. Catch blocks return `{ content: [...], isError: true }` with a descriptive message. Only genuine programming errors (null pointer, etc.) should propagate as exceptions.

### Anti-Pattern 3: Registering Tools After server.connect()

**What goes wrong:** `tools/list` is computed from tools registered at connect time. Tools added after connect are invisible to Claude.

**Prevention:** The structural pattern `registerXxxTools(server, client); ...; await server.connect(transport)` enforces correct ordering. The entry point has all registrations before `connect`.

### Anti-Pattern 4: One Monolithic Tool File

**What goes wrong:** With 20+ tools across 6 domains, a single file is unmaintainable and prevents independent testing of domains.

**Prevention:** One file per OpenNMS domain. Each file has a `registerXxxTools` function as its public surface. Files are independently importable and testable.

### Anti-Pattern 5: Recomputing Auth Headers Per Request

**What goes wrong:** Computing the Authorization header on every request is wasteful and adds a code path where credentials could be misread.

**Prevention:** Build axios instances at startup with auth headers in `defaults.headers`. All requests inherit them automatically with zero per-request cost.

### Anti-Pattern 6: Dynamic v1/v2 Fallback

**What goes wrong:** Attempting v2, catching 404, retrying v1 adds silent complexity and makes behavior unpredictable. It also masks real 404 errors.

**Prevention:** Per-tool API version decided at authoring time; documented in the tool description. `client.v2` vs `client.v1` is explicit at each call site.

---

## Data Flow

**Successful tool invocation:**

```
Claude CLI
  → stdin JSON-RPC: {"method":"tools/call","params":{"name":"alarm_list","arguments":{...}}}
  → StdioServerTransport reads, parses
  → McpServer dispatches to registered alarm_list handler
  → handler: client.v2.get("/alarms", { params: { _s: "alarm.severity==MAJOR" } })
  → axios: GET http://opennms:8980/api/v2/alarms?_s=alarm.severity%3D%3DMAJOR
           Authorization: Basic YWRtaW46YWRtaW4=
           Accept: application/json
  → OpenNMS: 200 OK, JSON body
  → axios: parses JSON, returns resp.data
  → handler: formats as text, returns { content: [{ type: "text", text: "..." }] }
  → McpServer: wraps in JSON-RPC response
  → StdioServerTransport: writes to stdout
  → Claude CLI: reads result, uses in response
```

**Error path:**

```
OpenNMS: 401 Unauthorized
  → axios throws AxiosError (err.response.status === 401)
  → handler catch block
  → buildErrorMessage(): "Authentication failed (HTTP 401). Check your credentials in the config file."
  → returns { content: [{ type: "text", text: "..." }], isError: true }
  → Claude reads message: "Authentication failed..." → reports to user
```

**Config loading (startup, not per-request):**

```
process.env.OPENNMS_CONFIG or process.argv[2]
  → loadConfig(filePath)
  → fs.readFileSync + JSON.parse
  → validate: url present? auth mode consistent?
  → return typed OpenNMSConfig
  → createApiClient(config): builds v2 + v1 axios instances with auth headers
```

---

## Sources

- MCP Architecture Overview — https://modelcontextprotocol.io/docs/learn/architecture.md (HIGH confidence — official docs, fetched 2026-03-02)
- MCP Server Concepts — https://modelcontextprotocol.io/docs/learn/server-concepts.md (HIGH confidence — official docs, fetched 2026-03-02)
- Build an MCP Server (TypeScript quickstart) — https://modelcontextprotocol.io/docs/develop/build-server.md (HIGH confidence — official quickstart with complete, runnable TypeScript code, fetched 2026-03-02)
- MCP Tools Specification — https://modelcontextprotocol.io/specification/2025-11-25/server/tools.md (HIGH confidence — protocol spec, fetched 2026-03-02)
- OpenNMS REST API reference — `opennms/docs/modules/development/pages/rest/` (HIGH confidence — authoritative source in repo, covers alarms, nodes, events, categories, ifservices)
- OpenNMS UI TypeScript services — `opennms/ui/src/services/` (HIGH confidence — existing production client code showing actual API call patterns, v1/v2 routing, and response shapes)
