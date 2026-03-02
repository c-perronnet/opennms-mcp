# Architecture Research: OpenNMS MCP Server

## Component Overview

```
Claude CLI (stdio)
      │
      ▼
┌─────────────────────────────────────────┐
│           MCP Server (index.ts)          │
│  - Creates Server instance               │
│  - Registers all tools                   │
│  - Starts StdioServerTransport           │
└────────────────┬────────────────────────┘
                 │ calls
                 ▼
┌─────────────────────────────────────────┐
│         Tool Handlers (tools/*.ts)       │
│  - alarms.ts  - events.ts               │
│  - nodes.ts   - assets.ts               │
│  - categories.ts  - collection.ts        │
│  Each file exports registerXxxTools(client, server)  │
└────────────────┬────────────────────────┘
                 │ calls
                 ▼
┌─────────────────────────────────────────┐
│         OpenNMS Client (client.ts)       │
│  - axios instance with base URL          │
│  - Auth interceptor (basic or token)     │
│  - Helper methods: get(), put(), post()  │
│  - v1/v2 URL routing                     │
└────────────────┬────────────────────────┘
                 │ reads
                 ▼
┌─────────────────────────────────────────┐
│         Config Loader (config.ts)        │
│  - Read JSON from OPENNMS_CONFIG env     │
│  - Auto-detect auth: basic vs token      │
│  - Validate required fields              │
└─────────────────────────────────────────┘
```

## Key Patterns

### Tool Registration
```typescript
// In each tools/*.ts file
export function registerAlarmTools(client: OpenNMSClient, server: Server) {
  server.tool(
    "list_alarms",
    { filter: z.string().optional(), limit: z.number().optional() },
    async ({ filter, limit }) => {
      const alarms = await client.get("/api/v2/alarms", { _s: filter, limit });
      return { content: [{ type: "text", text: JSON.stringify(alarms) }] };
    }
  );
  // ... more tools
}
```

### Auth Auto-Detection
```typescript
// In config.ts
type Config =
  | { url: string; username: string; password: string }
  | { url: string; token: string };

function getAuthHeader(config: Config): string {
  if ('token' in config) return `Bearer ${config.token}`;
  const b64 = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  return `Basic ${b64}`;
}
```

### Stdio Transport Setup
```typescript
// In index.ts
const server = new Server({ name: "opennms-mcp", version: "1.0.0" });
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Data Flow

1. Claude sends tool call via stdin (JSON-RPC)
2. MCP SDK routes to registered handler
3. Handler calls `client.get/put/post(path, params)`
4. Client adds auth header, sends HTTP request to OpenNMS
5. Response JSON parsed, returned as text content
6. MCP SDK sends result back via stdout

## v1 vs v2 Routing

| Domain | Endpoint | API Version |
|--------|----------|-------------|
| Alarms (read) | `/api/v2/alarms` | v2 (FIQL) |
| Alarms (write) | `/opennms/rest/alarms/{id}` | v1 (form data) |
| Nodes | `/opennms/rest/nodes` | v1 |
| IP Interfaces | `/api/v2/ipinterfaces` | v2 |
| SNMP Interfaces | `/opennms/rest/nodes/{id}/snmpinterfaces` | v1 |
| Events (read) | `/api/v2/events` | v2 |
| Events (send) | `/opennms/rest/events` | v1 |
| Categories | `/opennms/rest/categories` | v1 |
| Assets | `/opennms/rest/nodes/{id}/assetRecord` | v1 |

## Build Order (Dependencies)

1. **Config + Client** — foundation everything else calls
2. **Alarms** — most common use case, validates the scaffold
3. **Nodes** — required for Assets, Categories, Collection
4. **Events** — independent, pair with Alarms
5. **Assets + Categories** — depend on Nodes
6. **Collection config** — depends on Nodes + IP Interfaces

## Error Handling Strategy

- Wrap all client calls in try/catch
- Return human-readable error messages (not raw HTTP 401/404 stack traces)
- For auth failures: "Could not authenticate to OpenNMS at {url}. Check your config file."
- For not found: "Node {id} not found in OpenNMS."
- For network errors: "Could not reach OpenNMS at {url}. Is it running?"
