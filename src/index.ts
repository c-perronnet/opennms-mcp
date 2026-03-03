import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OpenNMSConfig, loadConfig } from "./config.js";
import { createApiClient, buildErrorMessage } from "./client.js";
import { registerAlarmTools } from "./tools/alarms.js";
import { registerNodeTools } from "./tools/nodes.js";
import { registerEventTools } from "./tools/events.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerCollectionTools } from "./tools/collection.js";

// Step 1: Resolve config path (FOUND-03)
// Prefer OPENNMS_CONFIG env var; fall back to positional argument.
const configPath = process.env.OPENNMS_CONFIG ?? process.argv[2];
if (!configPath) {
  console.error(
    "Error: No config file specified.\n" +
    "Set the OPENNMS_CONFIG environment variable or pass the path as the first argument.\n" +
    "Example: OPENNMS_CONFIG=/path/to/opennms.json node dist/index.js"
  );
  process.exit(1);
}

// Step 2: Load and validate config (FOUND-05 — throws with clear message on bad config)
let config: OpenNMSConfig;
try {
  config = loadConfig(configPath);
} catch (err) {
  console.error(String(err));
  process.exit(1);
}

// Step 3: Create HTTP client (FOUND-06, FOUND-07, FOUND-08)
const client = createApiClient(config);

// Step 4: Create MCP server (FOUND-04)
const server = new McpServer({
  name: "opennms-mcp",
  version: "1.0.0",
});

// Step 5: Register alarm tools (Phase 2)
registerAlarmTools(server, client, config);

// Step 6: Register node tools (Phase 3)
registerNodeTools(server, client, config);

// Step 7: Register event and asset tools (Phase 4)
registerEventTools(server, client, config);

// Step 8: Register category tools (Phase 4)
registerCategoryTools(server, client, config);

// Step 9: Register collection config tools (Phase 5)
registerCollectionTools(server, client, config);

// Step 10: Register stub tool — server_info
// This tool verifies connectivity and auth by calling a lightweight v1 endpoint.
// All Phase 2+ tools will follow this same pattern.
server.tool(
  "server_info",
  "Returns information about this OpenNMS MCP server and tests connectivity. Use to verify the server is running and credentials are correct.",
  {},
  async () => {
    try {
      // GET /opennms/rest/info — lightweight, auth-gated, returns OpenNMS version info
      const resp = await client.v1.get("/info");
      const info = resp.data as Record<string, unknown>;
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Connected to OpenNMS at ${config.url}\n` +
              `Version: ${info.version ?? "unknown"}\n` +
              `DisplayVersion: ${info.displayVersion ?? "unknown"}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: buildErrorMessage(err, config.url),
          },
        ],
        isError: true,
      };
    }
  }
);

// Step 11: Connect transport (FOUND-04) — must come AFTER all registerTool calls
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe — stdout is owned by StdioServerTransport
  console.error(`OpenNMS MCP server running on stdio (connected to ${config.url})`);
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
