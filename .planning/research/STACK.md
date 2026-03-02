# Technology Stack

**Project:** OpenNMS MCP Server
**Researched:** 2026-03-02
**Overall confidence:** HIGH (core choices), MEDIUM (exact version pins — verify against npm before locking)

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | `^1.0.0` | MCP server runtime, stdio transport, tool registration | Official Anthropic SDK. Only viable choice — community alternatives do not exist at production quality. Claude CLI communicates exclusively with servers using this SDK's JSON-RPC framing. Verify exact version at https://www.npmjs.com/package/@modelcontextprotocol/sdk before pinning. |
| TypeScript | `~5.4.x` | Type safety, compile-time validation of tool inputs and API response shapes | Aligned with OpenNMS UI tooling in this repo (`typescript: "~5.4.5"` in `opennms/ui/package.json`). Avoid 5.5+ until ecosystem tooling catches up. |
| Node.js | `>=20 LTS` | Runtime | Node 20 is the active LTS ("Iron"). Node 18 reached EOL in April 2025 — do not target it. Node 20 ships stable `fetch` without experimental flags. |

### HTTP Client

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Native `fetch` (Node built-in) | built-in (Node 20+) | All OpenNMS REST API calls | Zero dependency. Node 20 `fetch` is stable and W3C-compliant. The OpenNMS REST API is a plain request/response HTTP API — no streaming, no advanced retry logic, no interceptor chains are needed. Adding `axios` is unnecessary complexity for this scope. |

**On axios:** The existing ARCHITECTURE.md references axios because the OpenNMS UI uses it. That UI runs in browsers and was written before Node 20's fetch stabilized. For a Node-only MCP server, native fetch avoids a transitive dependency tree (~100KB) with no benefit. A 30-line fetch wrapper handles auth headers, JSON parsing, and error classification without axios.

**On `got`:** Same reasoning. No streaming, no retry backoff needed. Native fetch suffices.

### Schema Validation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `zod` | `^3.22.0` | Tool input schema definition and validation | The `@modelcontextprotocol/sdk` accepts Zod schemas directly for tool parameter definitions, auto-generating the JSON Schema that Claude reads when deciding how to invoke a tool. Zod also validates Claude's runtime inputs before they hit the OpenNMS API, surfacing errors early with useful messages. Do not manually write JSON Schema — Zod is the idiomatic integration. |

### Build Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `tsc` (TypeScript compiler) | included with `typescript` | Type checking, compilation to `dist/` | Sufficient for a server-side Node project with no bundling requirement. `tsup` adds value for publishing to npm as a single-file binary; for in-repo use, `tsc` is simpler. |
| `tsx` | `^4.0.0` | Development-time TypeScript execution | `tsx` runs `.ts` files directly using esbuild's transform — startup is fast (~50ms), ESM interop is clean. Use for `npm run dev`. Do NOT use `ts-node` — it is slow (2-5s startup), has persistent ESM/CJS issues in Node 20, and is not actively maintained at the same pace. |

**On bundlers (`tsup`, `esbuild`, `webpack`):** A bundler is only needed if distributing via `npx` as a zero-install binary. If users are expected to clone + build + point `claude mcp add` at the built file, `tsc` alone is sufficient. If npm distribution becomes a goal, add `tsup` at that point. Premature bundler setup adds friction with no current benefit.

### Testing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `vitest` | `^2.0.0` | Unit and integration tests | Aligned with this repo (`vitest: "^4.0.15"` in `opennms/ui/package.json`). Vitest is ESM-native, has TypeScript support without transform config, and runs significantly faster than Jest. Jest is NOT recommended — ESM interop with the MCP SDK and `"type": "module"` projects requires complex transform configuration. |

### Package Manager

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `pnpm` | `^10.x` | Dependency management | Aligned with the OpenNMS ecosystem in this repo (`packageManager: "pnpm@10.24.0"`). Consistent tooling avoids developer context switching. |

---

## Project Structure

```
src/
  index.ts          # Entry point: load config, create OpenNMS client, register tools, start stdio transport
  config.ts         # Config file loading and Zod validation
  client.ts         # OpenNMS HTTP client: fetch wrapper with auth injection, v1/v2 URL routing, error classification
  tools/
    alarms.ts       # Alarm tools: list, get, acknowledge, unacknowledge, clear, escalate
    events.ts       # Event tools: list, get, send
    nodes.ts        # Node tools: list, get, IP interfaces, SNMP interfaces, rescan
    categories.ts   # Category tools: list, get node categories, assign, remove
    assets.ts       # Asset tools: get, update
    collection.ts   # Collection config tools: list services on interface, enable/disable
  types/
    opennms.ts      # TypeScript types for OpenNMS API responses (Alarm, Node, Event, etc.)
dist/               # Compiled output (gitignored)
package.json
tsconfig.json
.gitignore
```

Each `tools/*.ts` file exports a single `registerXxxTools(client: OpenNMSClient, server: Server): void` function. `index.ts` calls all of them after building the server instance. This pattern keeps the entry point lean and makes each domain independently testable.

---

## Stdio Transport: Critical Implementation Details

The MCP SDK's `StdioServerTransport` reads from `process.stdin` and writes to `process.stdout` using JSON-RPC 2.0 framing. Claude CLI expects this protocol — any non-JSON-RPC bytes on stdout corrupt the stream.

**Rule: Never write to stdout.** Every `console.log()` call goes to stdout and will corrupt the MCP connection. All diagnostic output (startup messages, errors, debug logs) must go to `process.stderr` or `console.error()`. This is the single most common cause of "MCP server not connecting" bugs.

Minimal entry point:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { OpenNMSClient } from "./client.js";
import { registerAlarmTools } from "./tools/alarms.js";
// ... other tool imports

const configPath = process.env.OPENNMS_CONFIG ?? process.argv[2];
if (!configPath) {
  console.error("Usage: opennms-mcp <config.json> or set OPENNMS_CONFIG");
  process.exit(1);
}

const config = loadConfig(configPath); // throws with useful message if invalid
const client = new OpenNMSClient(config);

const server = new Server(
  { name: "opennms-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

registerAlarmTools(client, server);
// ... register other domains

const transport = new StdioServerTransport();
await server.connect(transport);
// Process stays alive. Claude CLI communicates via stdin/stdout.
```

Note the `.js` extensions on relative imports — required when `package.json` has `"type": "module"`. TypeScript will emit `.js` imports as-is; they resolve correctly at runtime.

---

## Stdio Transport Configuration for Claude CLI

Users configure the server with `claude mcp add` or by editing `~/.claude/mcp_servers.json` (global) or `.claude/mcp_servers.json` (project-local):

```json
{
  "opennms": {
    "command": "node",
    "args": ["/path/to/opennms-mcp/dist/index.js", "/path/to/opennms-config.json"],
    "env": {}
  }
}
```

Or using the environment variable form:

```json
{
  "opennms": {
    "command": "node",
    "args": ["/path/to/opennms-mcp/dist/index.js"],
    "env": { "OPENNMS_CONFIG": "/path/to/opennms-config.json" }
  }
}
```

Claude CLI spawns the server process once and keeps it alive for the session. The server must handle `SIGTERM` gracefully (default Node.js behavior handles this).

---

## Config File Loading

Zod-validated config with union type for basic auth vs token auth:

```typescript
// src/config.ts
import { z } from "zod";
import { readFileSync } from "fs";

const ConfigSchema = z.union([
  z.object({
    url: z.string().url(),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  z.object({
    url: z.string().url(),
    token: z.string().min(1),
  }),
]);

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    throw new Error(`Cannot read config file at ${path}: ${(e as Error).message}`);
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid config at ${path}: ${result.error.issues.map(i => i.message).join(", ")}`
    );
  }
  return result.data;
}
```

---

## OpenNMS HTTP Client

Key design decisions:

1. **`Accept: application/json` on every request.** OpenNMS defaults to XML. Without this header, responses are XML and JSON parsing fails silently or throws.
2. **Auth header derived at construction time**, injected into every request. Never derive it per-call.
3. **v1 vs v2 base URL:** v2 (`/api/v2/`) is a different base path from v1 (`/opennms/rest/`). The client holds both and routes based on a flag.
4. **Human-readable errors:** Map HTTP status codes to messages Claude can surface as tool errors, not raw stack traces.

```typescript
// src/client.ts
import type { Config } from "./config.js";

export class OpenNMSError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export class OpenNMSClient {
  private readonly v1Base: string;
  private readonly v2Base: string;
  private readonly authHeader: string;

  constructor(config: Config) {
    const base = config.url.replace(/\/$/, "");
    this.v1Base = `${base}/opennms/rest`;
    this.v2Base = `${base}/api/v2`;
    this.authHeader =
      "token" in config
        ? `Bearer ${config.token}`
        : `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          Authorization: this.authHeader,
          ...options.headers,
        },
      });
    } catch (e) {
      throw new OpenNMSError(0, `Could not reach OpenNMS at ${this.v1Base}. Is it running?`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new OpenNMSError(res.status, `Authentication failed (${res.status}). Check credentials in config file.`);
      }
      if (res.status === 404) {
        throw new OpenNMSError(404, `Resource not found (404): ${url}`);
      }
      throw new OpenNMSError(res.status, `OpenNMS error ${res.status}: ${body}`);
    }
    if (res.status === 204) return undefined as T; // No Content (DELETE, some PUTs)
    return res.json() as Promise<T>;
  }

  async get<T>(path: string, v2 = false): Promise<T> {
    const base = v2 ? this.v2Base : this.v1Base;
    return this.request<T>(`${base}${path}`);
  }

  async put(path: string, params: Record<string, string> = {}, v2 = false): Promise<void> {
    const base = v2 ? this.v2Base : this.v1Base;
    const body = new URLSearchParams(params);
    await this.request<void>(`${base}${path}`, {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  async post<T>(path: string, body: unknown, contentType = "application/json"): Promise<T> {
    return this.request<T>(`${this.v1Base}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": contentType },
    });
  }
}
```

**Note on PUT requests:** OpenNMS v1 PUT endpoints use `application/x-www-form-urlencoded`, not JSON. This is documented in the OpenNMS REST API docs (`PUT requires form data using application/x-www-form-urlencoded`). The client must send form-encoded bodies for alarm acknowledgement, clearing, and escalation.

---

## Tool Registration Pattern

```typescript
// src/tools/alarms.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import type { OpenNMSClient } from "../client.js";

export function registerAlarmTools(client: OpenNMSClient, server: Server): void {
  server.tool(
    "list_alarms",
    "List active alarms from OpenNMS, optionally filtered using FIQL syntax",
    {
      filter: z.string().optional().describe("FIQL filter expression (e.g. alarm.severity==MAJOR)"),
      limit: z.number().int().min(1).max(1000).optional().default(25).describe("Max results to return"),
    },
    async ({ filter, limit }) => {
      const params = new URLSearchParams();
      if (filter) params.set("_s", filter);
      if (limit !== undefined) params.set("limit", String(limit));
      const query = params.toString() ? `?${params}` : "";
      const result = await client.get(`/alarms${query}`, true); // v2
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "acknowledge_alarm",
    "Acknowledge an alarm by ID",
    { id: z.number().int().describe("Alarm ID") },
    async ({ id }) => {
      await client.put(`/alarms/${id}`, { ack: "true" }); // v1
      return { content: [{ type: "text", text: `Alarm ${id} acknowledged.` }] };
    }
  );

  // ... clear_alarm, escalate_alarm, unacknowledge_alarm, get_alarm
}
```

---

## v1 vs v2 API Routing Reference

| Domain | Read Endpoint | Write Endpoint | API Version Notes |
|--------|--------------|----------------|-------------------|
| Alarms (read) | `GET /api/v2/alarms` | — | v2: FIQL `_s=` parameter |
| Alarms (write) | — | `PUT /opennms/rest/alarms/{id}` | v1: form data, params ack/clear/escalate |
| Events (read) | `GET /opennms/rest/events` | — | v1 (check if v2 events endpoint is stable) |
| Events (send) | — | `POST /opennms/rest/events` | v1: JSON or XML body |
| Nodes | `GET /opennms/rest/nodes` | `POST /opennms/rest/nodes/{id}/rescan` | v1 |
| IP Interfaces | `GET /api/v2/ipinterfaces` | — | v2: FIQL available |
| SNMP Interfaces | `GET /opennms/rest/nodes/{id}/snmpinterfaces` | — | v1 |
| Categories | `GET /opennms/rest/categories` | `POST /DELETE /opennms/rest/nodes/{id}/categories/{name}` | v1 |
| Assets | `GET /opennms/rest/nodes/{id}/assetRecord` | `PUT /opennms/rest/nodes/{id}/assetRecord` | v1 |
| IF Services | `GET /opennms/rest/ifservices` | `PUT /opennms/rest/ifservices` | v1: status=A (active) or status=F (forced unmanaged) |

---

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Use `module: "NodeNext"` and `moduleResolution: "NodeNext"` for Node 20 ESM projects. This requires `.js` extensions on relative imports in TypeScript source (they resolve correctly at runtime). This is the correct configuration for 2025 Node.js TypeScript projects — not `"bundler"` (that's for bundler-processed output).

---

## package.json Key Fields

```json
{
  "name": "opennms-mcp",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "opennms-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  }
}
```

`"type": "module"` makes all `.js` files in the package treated as ESM. The `@modelcontextprotocol/sdk` is an ESM package; this avoids interop complexity.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP client | Native `fetch` | `axios` | Unnecessary 100KB dependency; Node 20 fetch is stable and sufficient for plain REST |
| HTTP client | Native `fetch` | `got` | Same reasoning — no streaming or advanced retry needed |
| Dev runner | `tsx` | `ts-node` | Slow startup (2-5s vs ~50ms), ESM interop issues in Node 20, less maintained |
| Dev runner | `tsx` | `bun` | Excellent runtime but not what users have; Node 20 is the safe baseline |
| Build | `tsc` | `tsup` | `tsup` warranted only for npm distribution as a single-file binary; not needed for clone-and-run |
| Testing | `vitest` | `jest` | Jest requires complex ESM transform config; vitest is ESM-native |
| Validation | `zod` | Manual JSON Schema | Zod integrates directly with MCP SDK; manual schemas lose type inference |
| Transport | stdio | HTTP/SSE | Claude CLI requires stdio; HTTP transport is for web-based MCP clients |
| Package manager | `pnpm` | `npm` | Matches this repo's tooling (`pnpm@10.24.0`); consistent developer experience |
| Language | TypeScript | Python | MCP TypeScript SDK is the primary/better-documented SDK; pip-install distribution is harder |

---

## Installation

```bash
# In the opennms-mcp project root
pnpm init

# Core runtime dependencies
pnpm add @modelcontextprotocol/sdk zod

# Development dependencies
pnpm add -D typescript tsx vitest @types/node

# Build
pnpm build     # runs tsc

# Dev (no compile step)
pnpm dev       # runs tsx src/index.ts
```

Verify Node version before starting:
```bash
node --version  # must be v20.x or v22.x
```

---

## What NOT to Use

**`console.log()` anywhere in the codebase.** The stdio transport shares stdout with Claude CLI's JSON-RPC stream. Any `console.log()` output corrupts the stream and silently breaks tool calls. Replace all logging with `console.error()` or write to `process.stderr`. This is non-negotiable.

**`express`, `fastify`, or any HTTP framework.** The server runs over stdio, not HTTP. These frameworks are irrelevant and add complexity.

**`ts-node`.** Replaced by `tsx` in 2023-2024. Slower, ESM-incompatible, not maintained at the same pace.

**`node-fetch`.** Node 20+ built-in `fetch` is stable and spec-compliant. This package is a compatibility shim for old Node versions.

**`dotenv`.** Configuration comes from a JSON file, not `.env` files. `process.env` handles the `OPENNMS_CONFIG` path variable without a library.

**`commander` or `yargs`.** The CLI surface is one optional flag (`--config` or positional arg). Parse it with `process.argv.slice(2)[0]`. A full CLI framework is over-engineering.

**`winston` or other logging libraries.** `console.error()` and `process.stderr.write()` are sufficient. A structured logging library would add complexity without benefit in a single-process stdio MCP server.

---

## Confidence Assessment

| Component | Confidence | Source |
|-----------|------------|--------|
| `@modelcontextprotocol/sdk` as the SDK | HIGH | Explicitly named in PROJECT.md; official Anthropic package |
| stdio transport for Claude CLI | HIGH | Documented requirement in PROJECT.md and widely confirmed |
| TypeScript | HIGH | Project constraint in PROJECT.md |
| Node.js 20+ | HIGH | Node 18 EOL April 2025; Node 20 is current LTS |
| Native `fetch` over axios | HIGH | Node 20 stable fetch confirmed; REST API scope is straightforward |
| `zod` for validation | HIGH | Standard MCP SDK integration; documented in MCP examples |
| `tsx` over `ts-node` | HIGH | Community consensus since 2023; performance difference is large |
| `vitest` for testing | HIGH | Matches this repo's OpenNMS UI tooling |
| `pnpm` as package manager | HIGH | Matches `pnpm@10.24.0` already used in this repo |
| OpenNMS v1 PUT uses form data | HIGH | Verified in REST API docs (`alarms.adoc`, `ifservices.adoc`) |
| MCP SDK exact version | MEDIUM | Version `^1.0.0` is reasonable but verify at https://www.npmjs.com/package/@modelcontextprotocol/sdk before pinning |
| `tsc` sufficient (no bundler) | MEDIUM | Correct for clone-and-run; re-evaluate if npm distribution becomes a goal |

---

## Sources

- `/home/c_perronnet/git/opennms-mcp/.planning/PROJECT.md` — project constraints (TypeScript, Node.js, `@modelcontextprotocol/sdk`, stdio, JSON config) — HIGH confidence
- `/home/c_perronnet/git/opennms-mcp/opennms/ui/package.json` — OpenNMS ecosystem tooling versions (TypeScript 5.4.x, vitest 4.x, pnpm 10.24.0, Node >=18) — HIGH confidence for tooling alignment
- `/home/c_perronnet/git/opennms-mcp/opennms/docs/modules/development/pages/rest/rest-api.adoc` — REST API authentication, response format, HTTP return codes — HIGH confidence
- `/home/c_perronnet/git/opennms-mcp/opennms/docs/modules/development/pages/rest/alarms.adoc` — v2 FIQL alarm queries, v1 alarm mutation endpoints — HIGH confidence
- `/home/c_perronnet/git/opennms-mcp/opennms/docs/modules/development/pages/rest/ifservices.adoc` — collection config via ifservices status field — HIGH confidence
- `/home/c_perronnet/git/opennms-mcp/opennms/docs/modules/development/pages/rest/nodes.adoc` — node endpoints, rescan, IP interfaces, SNMP interfaces, categories, assets — HIGH confidence
- Claude training data (up to August 2025) — MCP SDK patterns, `tsx` vs `ts-node`, `moduleResolution: "NodeNext"`, `zod` integration with MCP, stdio stdout constraint — MEDIUM confidence; MCP SDK patterns are well-established but verify version before pinning
