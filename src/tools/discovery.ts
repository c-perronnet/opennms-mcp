import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

export function registerDiscoveryTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig
) {
  // DISC-01: Run a discovery scan on an IP range
  // Uses v2 POST /api/v2/discovery with JSON body.
  // This triggers a one-shot discovery — OpenNMS will ping each IP in the range
  // and create nodes for any that respond.
  server.tool(
    "discover_range",
    "Run a one-shot discovery scan on an IP range. OpenNMS will ping each IP in the range and create nodes for any that respond. " +
    "Provide begin and end IPs (e.g. '192.168.2.1' to '192.168.2.254'). " +
    "Optionally set a foreignSource to group discovered nodes under a requisition.",
    {
      begin: z.string().describe(
        "Start IP address of the range to scan (e.g. '192.168.2.1')."
      ),
      end: z.string().describe(
        "End IP address of the range to scan (e.g. '192.168.2.254')."
      ),
      foreignSource: z.string().optional().describe(
        "Optional foreign source (requisition name) to assign to discovered nodes (e.g. 'discovery'). " +
        "If omitted, nodes are added without a foreign source."
      ),
      location: z.string().optional().default("Default").describe(
        "Monitoring location (default: 'Default')."
      ),
      retries: z.number().int().min(0).optional().default(1).describe(
        "Number of retries for ping (default: 1)."
      ),
      timeout: z.number().int().min(100).optional().default(2000).describe(
        "Ping timeout in milliseconds (default: 2000)."
      ),
    },
    async ({ begin, end, foreignSource, location, retries, timeout }) => {
      try {
        const body: Record<string, unknown> = {
          location: location ?? "Default",
          retries: retries ?? 1,
          timeout: timeout ?? 2000,
          includeRanges: [
            {
              begin,
              end,
              location: location ?? "Default",
              retries: retries ?? 1,
              timeout: timeout ?? 2000,
            },
          ],
        };
        if (foreignSource) {
          body.foreignSource = foreignSource;
          (body.includeRanges as Record<string, unknown>[])[0].foreignSource = foreignSource;
        }

        await client.v2.post("/discovery", body, {
          headers: { "Content-Type": "application/json" },
        });

        const fsText = foreignSource ? ` (foreignSource: ${foreignSource})` : "";
        return {
          content: [{
            type: "text" as const,
            text: `Discovery scan submitted for range ${begin} - ${end}${fsText}. OpenNMS is now scanning.`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: buildErrorMessage(err, `discovery scan ${begin}-${end}`),
          }],
          isError: true,
        };
      }
    }
  );
}
