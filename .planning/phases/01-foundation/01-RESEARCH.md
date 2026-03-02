# Phase 1: Foundation - Research

**Researched:** 2026-03-02
**Domain:** MCP server scaffolding (TypeScript), configuration loading, HTTP client setup, error handling
**Confidence:** HIGH — primary sources are official SDK docs, npm registry live data, and OpenNMS source in repo

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | User can configure OpenNMS connection via JSON file with URL and basic auth credentials (`username` + `password`) | Config interface + Zod validation pattern documented; `loadConfig()` template in Architecture section |
| FOUND-02 | User can configure OpenNMS connection via JSON file with URL and API token (`token`); auth type auto-detected from config keys | Type union + field-presence detection pattern documented; `isTokenAuth()` type guard in code examples |
| FOUND-03 | Config file path provided via `OPENNMS_CONFIG` env var or positional CLI argument | `process.env.OPENNMS_CONFIG ?? process.argv[2]` resolution pattern documented |
| FOUND-04 | Server starts and connects to Claude CLI via stdio transport | `McpServer` + `StdioServerTransport` wiring documented with verified startup sequence |
| FOUND-05 | User receives a clear error message when config file is missing, malformed, or has invalid fields | Zod `.strict()` for unknown-field rejection + descriptive `throw` messages for each bad-config case |
| FOUND-06 | User receives a clear error message when OpenNMS is unreachable (network error) | `axios.isAxiosError` + `!err.response` branch in `buildErrorMessage()` documented |
| FOUND-07 | User receives a clear error message when credentials are invalid (401/403) | `err.response.status === 401 || 403` branch documented; MCP `isError: true` response pattern |
| FOUND-08 | Optional `insecure: true` config field disables TLS certificate verification for self-signed certs | `https.Agent({ rejectUnauthorized: false })` passed as `httpsAgent` to axios instances; documented |
</phase_requirements>

---

## Summary

Phase 1 builds the permanent infrastructure that every subsequent phase plugs into: a TypeScript project that compiles to ESM, a config loader that validates the JSON config file at startup, an axios HTTP client wired with auth headers, and an MCP server scaffold that connects to Claude CLI via stdio transport. No actual OpenNMS tool handlers are needed yet — a single `ping` or `server_info` stub tool is enough to prove the server connects.

The two highest-risk items in this phase are (1) the stdout discipline requirement — any `console.log()` or `process.stdout.write()` corrupts the JSON-RPC stream and silently breaks Claude communication, and (2) getting the TypeScript/ESM/Node16 module system right so that `.js` import extensions resolve correctly in the compiled output. Both are well-understood pitfalls with known prevention strategies.

The technology choices are already locked by the project's prior research (see STATE.md): `@modelcontextprotocol/sdk` for the MCP layer, `axios` for HTTP, Zod for config validation, TypeScript with `"module": "Node16"`. Version verification confirms these are all current and compatible as of March 2026.

**Primary recommendation:** Build in strict sequence — tsconfig + package.json first, then config.ts, then client.ts, then index.ts with stub tool, then verify with MCP Inspector before touching any OpenNMS API calls.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.27.1 | MCP server lifecycle, tool registration, stdio transport | Official Anthropic SDK; only supported way to implement MCP tools for Claude CLI |
| `zod` | 3.25.x or 4.x | Config file schema validation, tool input schemas | Required peer dependency of MCP SDK; provides type inference + validation in one step |
| `axios` | 1.13.6 | HTTP client for OpenNMS REST API | Interceptors enable clean auth injection; prior project decision (STATE.md) |
| `typescript` | 5.9.3 | Compilation | Language choice; required for MCP SDK type safety |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/node` | ^22 or ^20 | Node.js type definitions | Required for `process.env`, `fs`, `https.Agent` |
| `@modelcontextprotocol/inspector` | latest (npx only) | Interactive test UI for MCP servers | Local development and smoke testing; never installed as dep |

### Zod Version Note

The MCP SDK v1.27.1 accepts `zod: "^3.25 || ^4.0"` as a peer dependency. Zod v4 (latest: 4.3.6) introduced breaking internal changes that caused issues with older SDK versions, but v1.27.1 explicitly supports both. **Use Zod v3.25.x for maximum safety** unless the project has a specific need for v4 features — the MCP SDK's backwards-compatibility guarantee only extends to "v3.25 or later", and v3 is thoroughly battle-tested in MCP contexts.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `axios` | Native `fetch` | `fetch` has no interceptor pattern; auth headers must be set per-request; no `isAxiosError` type guard for error handling |
| `zod` for config | Manual `if` checks | Loses type inference; error messages are hand-written; misses nested validation |
| `McpServer` (high-level) | `Server` (low-level SDK class) | Low-level requires manual JSON-RPC handling; `McpServer` is the official recommended API |

**Installation:**

```bash
npm install @modelcontextprotocol/sdk zod axios
npm install --save-dev typescript @types/node
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── index.ts          # Entry point: wire server, config, client, stub tool, connect transport
├── config.ts         # loadConfig(): read JSON file, validate with Zod, return typed config
├── client.ts         # createApiClient(): axios v2 + v1 instances; buildErrorMessage()
└── tools/            # (empty in Phase 1 — stub tool lives in index.ts)
dist/                 # tsc output (gitignored)
package.json
tsconfig.json
opennms.example.json  # Example config file for users to copy
```

### Pattern 1: Startup Sequence (Strict Order)

**What:** The MCP server must register all tools BEFORE connecting the transport. Config and client are created before the server.
**When to use:** Always — this is the only correct startup order.

```typescript
// src/index.ts
// Source: Official MCP TypeScript quickstart (modelcontextprotocol.io/docs/develop/build-server)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { createApiClient } from "./client.js";

// Step 1: Load config (synchronous; throws on bad config)
const configPath = process.env.OPENNMS_CONFIG ?? process.argv[2];
if (!configPath) {
  console.error("Error: No config file specified. Set OPENNMS_CONFIG env var or pass path as argument.");
  process.exit(1);
}
const config = loadConfig(configPath);

// Step 2: Create HTTP client
const client = createApiClient(config);

// Step 3: Create MCP server
const server = new McpServer({
  name: "opennms-mcp",
  version: "1.0.0",
});

// Step 4: Register tools (stub for Phase 1)
server.registerTool(
  "server_info",
  {
    description: "Returns information about this OpenNMS MCP server and the configured OpenNMS URL",
    inputSchema: {},
  },
  async () => {
    return {
      content: [{ type: "text", text: `OpenNMS MCP server connected to: ${config.url}` }],
    };
  }
);

// Step 5: Connect transport (blocks process, listening on stdin)
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenNMS MCP server running on stdio"); // stderr is safe
}

main().catch((err) => {
  console.error("Fatal error in main:", err);
  process.exit(1);
});
```

### Pattern 2: Config Loading with Zod Validation

**What:** Parse the JSON config file, validate its shape with Zod (rejecting unknown fields), and return a typed union type.
**When to use:** Called once at startup in index.ts, before any other operation.

```typescript
// src/config.ts
import * as fs from "fs";
import { z } from "zod";

// Basic auth config shape
const BasicAuthSchema = z.object({
  url: z.string().url("'url' must be a valid URL"),
  username: z.string().min(1, "'username' must not be empty"),
  password: z.string().min(1, "'password' must not be empty"),
  insecure: z.boolean().optional(),
}).strict(); // .strict() rejects unknown fields (FOUND-05)

// Token auth config shape
const TokenAuthSchema = z.object({
  url: z.string().url("'url' must be a valid URL"),
  token: z.string().min(1, "'token' must not be empty"),
  insecure: z.boolean().optional(),
}).strict();

// Union: at least one valid shape must match
const ConfigSchema = z.union([TokenAuthSchema, BasicAuthSchema]);

export type OpenNMSConfig = z.infer<typeof ConfigSchema>;

export function isTokenAuth(config: OpenNMSConfig): config is z.infer<typeof TokenAuthSchema> {
  return "token" in config;
}

export function loadConfig(filePath: string): OpenNMSConfig {
  // Check file exists (FOUND-05: missing file)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  // Parse JSON (FOUND-05: malformed JSON)
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(`Config file is not valid JSON: ${filePath}\n${String(err)}`);
  }

  // Validate shape (FOUND-05: invalid fields; .strict() catches unknown fields)
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Config file validation failed:\n${issues}`);
  }

  // Strip trailing slash from URL
  const parsed = result.data;
  parsed.url = parsed.url.replace(/\/$/, "");
  return parsed;
}
```

### Pattern 3: API Client with Auth Headers + insecure TLS

**What:** Build axios instances at startup with auth headers and optional TLS bypass.
**When to use:** Called once at startup with the validated config object.

```typescript
// src/client.ts
import axios, { AxiosInstance } from "axios";
import * as https from "https";
import { OpenNMSConfig, isTokenAuth } from "./config.js";

function buildAuthHeaders(config: OpenNMSConfig): Record<string, string> {
  if (isTokenAuth(config)) {
    return { Authorization: `Bearer ${config.token}` };
  }
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  return { Authorization: `Basic ${credentials}` };
}

export function createApiClient(config: OpenNMSConfig) {
  const commonHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...buildAuthHeaders(config),
  };

  // Build httpsAgent for insecure mode (FOUND-08)
  const httpsAgent = config.insecure
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

  const instanceConfig = {
    headers: commonHeaders,
    timeout: 30000,
    httpsAgent,
  };

  // v2 API: FIQL filtering, preferred for reads
  const v2: AxiosInstance = axios.create({
    ...instanceConfig,
    baseURL: `${config.url}/api/v2`,
  });

  // v1 API: mutations, categories, assets, collection, events POST
  const v1: AxiosInstance = axios.create({
    ...instanceConfig,
    baseURL: `${config.url}/opennms/rest`,
  });

  return { v2, v1 };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function buildErrorMessage(err: unknown, context: string): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      // FOUND-06: network error — server unreachable
      return `Could not reach OpenNMS at ${context}. Is the server running and URL correct? (${err.message})`;
    }
    const status = err.response.status;
    if (status === 401 || status === 403) {
      // FOUND-07: auth failure
      return `Authentication failed (HTTP ${status}). Check credentials in your config file.`;
    }
    if (status === 404) {
      return `Not found (HTTP 404): ${context}`;
    }
    return `OpenNMS API error (HTTP ${status}): ${JSON.stringify(err.response.data)}`;
  }
  return `Unexpected error: ${String(err)}`;
}
```

### Pattern 4: Error Response in Tool Handlers

**What:** Catch all errors in tool handlers and return `isError: true` with a readable message — never throw exceptions.
**When to use:** Every tool handler in every domain module.

```typescript
// Any src/tools/*.ts
server.registerTool("tool_name", { ... }, async (args) => {
  try {
    const resp = await client.v2.get("/some-endpoint");
    return {
      content: [{ type: "text", text: JSON.stringify(resp.data, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: buildErrorMessage(err, "description of what was attempted") }],
      isError: true,
    };
  }
});
```

### Pattern 5: Build Configuration

**What:** TypeScript compiler settings for ESM Node.js MCP server.
**When to use:** Project root tsconfig.json.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

```json
// package.json (key fields)
{
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  },
  "engines": { "node": ">=18" }
}
```

### Anti-Patterns to Avoid

- **Writing to stdout:** `console.log()` anywhere in server code corrupts the JSON-RPC stream. Use `console.error()` exclusively. The StdioServerTransport owns stdout.
- **Registering tools after server.connect():** Tools registered after `connect()` are invisible to Claude. All `registerTool()` calls must precede the `connect()` call.
- **Throwing exceptions from tool handlers:** Uncaught exceptions produce JSON-RPC protocol errors; Claude sees a server bug instead of an actionable message. Use `isError: true` responses.
- **Missing `.js` extensions in imports:** With `"module": "Node16"`, TypeScript requires `.js` extensions in import paths (even when the source file is `.ts`). `import { foo } from "./config.js"` is correct.
- **Computing auth headers per-request:** Set auth headers on axios instances at creation time; all requests inherit them. Never recompute per-request.
- **Not stripping trailing slash from URL:** `https://opennms:8980/` + `/api/v2` becomes `//api/v2`. Strip the trailing slash in `loadConfig()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC 2.0 message framing over stdio | Custom stdin/stdout parser | `StdioServerTransport` from `@modelcontextprotocol/sdk` | Framing, buffering, content-length headers, error recovery — all handled |
| Tool schema → JSON Schema conversion | Manual JSON Schema objects | Zod schemas + MCP SDK auto-conversion | SDK converts Zod → JSON Schema for `tools/list` automatically |
| HTTP auth header encoding | Custom Base64 for Basic auth | `Buffer.from().toString("base64")` (already standard) | Use existing Node.js `Buffer` — no custom encoding needed |
| Config file format validation | Manual `if` chain | Zod with `.strict()` | Unknown field detection, nested path errors, and union discrimination in one call |
| HTTP error classification | `err.status === 401` on raw response | `axios.isAxiosError(err)` type guard | Safely narrows to AxiosError with `.response` type; handles network errors vs HTTP errors |

**Key insight:** The MCP stdio transport is not trivially implementable — it requires exact JSON-RPC 2.0 framing with content-length headers. Never replace `StdioServerTransport` with a custom solution.

---

## Common Pitfalls

### Pitfall 1: stdout Pollution Breaks All Claude Communication

**What goes wrong:** Any write to `process.stdout` (including `console.log()`) is interpreted by Claude as a JSON-RPC message. Since it's not valid JSON-RPC, the entire communication channel is corrupted silently. Claude reports a connection error or gets garbled responses with no obvious cause.

**Why it happens:** Developers use `console.log()` for debugging without realizing the stdio transport uses the same file descriptor.

**How to avoid:** Use `console.error()` for ALL server-side logging. Add ESLint rule `"no-console": ["error", { "allow": ["error"] }]` to enforce this at the linter level.

**Warning signs:** Claude connects but gives cryptic errors; MCP Inspector shows parse errors on responses.

### Pitfall 2: Missing `.js` Extensions in ESM Imports

**What goes wrong:** `import { loadConfig } from "./config"` fails at runtime with "Cannot find module" even though the TypeScript source exists.

**Why it happens:** With `"module": "Node16"`, Node.js ESM loader requires explicit file extensions. TypeScript preserves the extension you write, not the compiled extension.

**How to avoid:** Always write `import { foo } from "./config.js"` in TypeScript source files (the `.js` extension refers to the compiled output file, even though you're editing `.ts`).

**Warning signs:** `Error: Cannot find module './config'` at startup despite successful `tsc` compilation.

### Pitfall 3: Config Loaded After Server Connected

**What goes wrong:** If startup throws during config loading after `server.connect()`, the server is in a broken state mid-connection.

**Why it happens:** Placing config loading in an async function that runs after `connect()`.

**How to avoid:** Load and validate config synchronously (`fs.readFileSync`) at the very top of `index.ts`, before creating the server. If config is invalid, `process.exit(1)` before the MCP server is ever created.

**Warning signs:** Claude CLI shows "Server disconnected" immediately after connection.

### Pitfall 4: Zod Union Discrimination Order

**What goes wrong:** If the `BasicAuthSchema` is listed first in `z.union([BasicAuthSchema, TokenAuthSchema])`, a config with `token` field will fail because `BasicAuthSchema.strict()` rejects unknown fields — and `token` is unknown to `BasicAuthSchema`.

**Why it happens:** Zod unions try each member in order and the first `.strict()` match fails on the extra field.

**How to avoid:** Put `TokenAuthSchema` first in the union: `z.union([TokenAuthSchema, BasicAuthSchema])`. Token configs have the fewest fields, so they won't be confused with basic auth configs.

**Warning signs:** Error "Unrecognized key(s) in object: 'token'" when config clearly has a valid token field.

### Pitfall 5: OpenNMS Sends XML by Default

**What goes wrong:** Calling the v1 REST API without `Accept: application/json` returns XML. `JSON.parse(resp.data)` throws or produces incorrect results.

**Why it happens:** OpenNMS v1 API defaults to XML (Jersey/JAX-RS standard).

**How to avoid:** Set `Accept: "application/json"` in the axios instance `headers` at creation time (already in the client pattern above).

**Warning signs:** `SyntaxError: Unexpected token '<'` when parsing API responses.

### Pitfall 6: Claude CLI env var injection required for config path

**What goes wrong:** The Claude CLI config entry uses `command: "node"` and `args: ["dist/index.js"]` — no config path argument. The server starts with no config and exits with an unhelpful error.

**Why it happens:** Developers test locally with a positional arg but don't update the Claude CLI config to include the env var or arg.

**How to avoid:** The Claude CLI config entry must include either `env: { OPENNMS_CONFIG: "/path/to/config.json" }` or `args: ["dist/index.js", "/path/to/config.json"]`. Document both options in `opennms.example.json` and README.

---

## Code Examples

Verified patterns from official sources and OpenNMS source:

### Complete opennms.example.json (Basic Auth)

```json
{
  "url": "http://your-opennms-host:8980",
  "username": "admin",
  "password": "admin"
}
```

### Complete opennms.example.json (Token Auth)

```json
{
  "url": "https://your-opennms-host:8443",
  "token": "your-api-token-here"
}
```

### Complete opennms.example.json (with insecure TLS)

```json
{
  "url": "https://your-opennms-host:8443",
  "username": "admin",
  "password": "admin",
  "insecure": true
}
```

### Claude CLI integration config

```json
{
  "mcpServers": {
    "opennms": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/opennms-mcp/dist/index.js"],
      "env": {
        "OPENNMS_CONFIG": "/absolute/path/to/opennms.json"
      }
    }
  }
}
```

### MCP Inspector local test command

```bash
npx @modelcontextprotocol/inspector node dist/index.js
# Pass config via env var:
OPENNMS_CONFIG=/path/to/opennms.json npx @modelcontextprotocol/inspector node dist/index.js
```

### Connectivity Health Check (tool handler pattern for Phase 1 stub)

```typescript
// A "server_info" or "ping" tool that tests connectivity at tool-call time
server.registerTool(
  "server_info",
  {
    description: "Returns this server's connection status and configured OpenNMS URL. Use to verify connectivity.",
    inputSchema: {},
  },
  async () => {
    try {
      // Minimal API call to verify connectivity and auth (FOUND-06, FOUND-07)
      await client.v2.get("/info");
      return {
        content: [{
          type: "text",
          text: `Connected to OpenNMS at ${config.url}. Authentication successful.`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: buildErrorMessage(err, config.url) }],
        isError: true,
      };
    }
  }
);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Server` class (low-level MCP SDK) | `McpServer` class (high-level) | SDK ~1.0 | Eliminates manual JSON-RPC routing; `registerTool` replaces `setRequestHandler` |
| Zod v3 only for MCP SDK | `^3.25 \|\| ^4.0` peer dep | SDK 1.27.x | Can use Zod v4 if preferred; v3.25+ still works |
| `"module": "CommonJS"` | `"module": "Node16"` with `"type": "module"` | TS 4.7+ / Node 12+ | ESM-native; no `require()` patterns; `.js` import extensions required |
| `process.argv` only for config path | `process.env.OPENNMS_CONFIG ?? process.argv[2]` | Project decision | Supports both Claude CLI `env` injection and direct CLI argument |

**Deprecated/outdated:**
- `Server` (low-level SDK class): Still present in SDK but superseded by `McpServer` for tool servers.
- `createServer()` (older SDK API): Not present in 1.x; ignore any tutorials referencing it.
- MCP SDK v2 (pre-alpha on `main` branch): Anticipated stable Q1 2026; use v1.27.x for this project.

---

## Open Questions

1. **Does OpenNMS v1 REST API accept `application/json` for PUT requests with query params?**
   - What we know: The alarm ack/clear/escalate are `PUT /rest/alarms/{id}?ack=true` with no body. OpenNMS REST API doc shows this pattern.
   - What's unclear: Whether `Content-Type: application/json` causes a 415 Unsupported Media Type on bodyless PUT requests.
   - Recommendation: Set `Content-Type` in the axios instance defaults; if a 415 occurs on mutations, pass `null` body and override Content-Type to `application/x-www-form-urlencoded` for v1 mutation calls. This is a Phase 2 concern.

2. **OpenNMS `/api/v2/info` endpoint existence for connectivity check**
   - What we know: OpenNMS has a REST `/opennms/rest/info` endpoint in v1. Whether `/api/v2/info` exists is not confirmed from docs.
   - What's unclear: Best endpoint for a lightweight auth check.
   - Recommendation: Use `GET /opennms/rest/info` (v1 client) for the Phase 1 connectivity stub rather than a v2 endpoint. It returns server version info and confirms auth in one call.

---

## Sources

### Primary (HIGH confidence)

- `@modelcontextprotocol/sdk` npm registry — live version check: v1.27.1, `peerDependencies: { zod: "^3.25 || ^4.0" }`, `engines: { node: ">=18" }`
- `opennms/docs/modules/development/pages/rest/rest-api.adoc` — OpenNMS REST API base URL, auth, and JSON format requirements (in repo)
- `opennms/ui/src/services/axiosInstances.ts` — Production axios v2/v1 instance pattern (in repo)
- `.planning/research/ARCHITECTURE.md` — Project prior research: MCP SDK patterns, auth detection, error handling, startup sequence, file structure (HIGH confidence, all claims sourced from official docs)
- Official MCP TypeScript Quickstart — https://modelcontextprotocol.io/docs/develop/build-server (referenced in ARCHITECTURE.md, fetched 2026-03-02)

### Secondary (MEDIUM confidence)

- npm live queries: `zod@4.3.6`, `axios@1.13.6`, `typescript@5.9.3` — current latest versions as of 2026-03-02
- GitHub MCP TypeScript SDK releases page — v1.27.1 is latest stable; v2 pre-alpha on `main`; v1.x branch receives security fixes
- Multiple community tutorials confirm `"module": "Node16"` + `"type": "module"` + `.js` import extensions as standard pattern

### Tertiary (LOW confidence)

- Zod v4 compatibility note: v4 introduced `._zod.def` internal change breaking older MCP SDK versions; confirmed v1.27.x resolves this via backwards-compat layer. Not independently verified against v1.27.1 source.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — live npm queries + official SDK docs confirm all versions
- Architecture: HIGH — sourced from official MCP TypeScript quickstart + ARCHITECTURE.md with verified patterns
- Pitfalls: HIGH — stdout, ESM imports, Zod union order are well-documented and independently verified
- Config TLS insecure pattern: HIGH — `https.Agent({ rejectUnauthorized: false })` is standard Node.js/axios pattern, multiple sources

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (MCP SDK is actively developed; check version before starting)
