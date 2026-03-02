import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

// Minimal AlarmDTO interface derived from AlarmDTO.java (v2 JSON response fields)
interface AlarmDTO {
  id: number;
  severity: string;          // INDETERMINATE | CLEARED | NORMAL | WARNING | MINOR | MAJOR | CRITICAL
  nodeId?: number;
  nodeLabel?: string;
  uei?: string;
  description?: string;
  logMessage?: string;
  firstEventTime?: string;   // ISO-8601 or epoch ms
  lastEventTime?: string;    // ISO-8601 or epoch ms
  count?: number;
  ackUser?: string;          // null/undefined when unacknowledged
  ackTime?: string;          // null/undefined when unacknowledged
  reductionKey?: string;
}

interface AlarmListResponse {
  alarm: AlarmDTO[];
  totalCount: number;
  count: number;
  offset: number;
}

// Format ack status for display
function formatAckStatus(alarm: AlarmDTO): string {
  if (alarm.ackUser) {
    const ackTime = alarm.ackTime ? new Date(alarm.ackTime).toISOString() : "unknown time";
    return `Acknowledged by ${alarm.ackUser} at ${ackTime}`;
  }
  return "Unacknowledged";
}

// Format a single alarm as a summary line (used in list_alarms)
function formatAlarmSummary(alarm: AlarmDTO): string {
  const time = alarm.lastEventTime ? new Date(alarm.lastEventTime).toISOString() : "unknown";
  const node = alarm.nodeLabel ?? (alarm.nodeId ? `node ${alarm.nodeId}` : "no node");
  const ack = formatAckStatus(alarm);
  return [
    `ID: ${alarm.id}  Severity: ${alarm.severity}  Node: ${node}`,
    `  Description: ${alarm.logMessage ?? alarm.description ?? "none"}`,
    `  Last event: ${time}  ${ack}`,
  ].join("\n");
}

// Format full alarm detail (used in get_alarm)
function formatAlarmDetail(alarm: AlarmDTO): string {
  const lines: string[] = [
    `Alarm ID: ${alarm.id}`,
    `Severity: ${alarm.severity}`,
    `Node: ${alarm.nodeLabel ?? (alarm.nodeId ? `node ${alarm.nodeId}` : "none")}`,
    `UEI: ${alarm.uei ?? "none"}`,
    `Reduction Key: ${alarm.reductionKey ?? "none"}`,
    `Count: ${alarm.count ?? 1}`,
    `Description: ${alarm.description ?? alarm.logMessage ?? "none"}`,
    `Log Message: ${alarm.logMessage ?? "none"}`,
    `First Event: ${alarm.firstEventTime ? new Date(alarm.firstEventTime).toISOString() : "unknown"}`,
    `Last Event: ${alarm.lastEventTime ? new Date(alarm.lastEventTime).toISOString() : "unknown"}`,
    `Ack Status: ${formatAckStatus(alarm)}`,
  ];
  return lines.join("\n");
}

export function registerAlarmTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {

  // ALARM-01, ALARM-07, ALARM-08: List alarms with optional FIQL filter and configurable limit
  server.tool(
    "list_alarms",
    "List OpenNMS alarms. Optionally filter with a FIQL expression (e.g. 'severity==CRITICAL', 'node.label==myserver', 'alarm.uei==uei.opennms.org/nodes/nodeDown'). Returns ID, severity, node, description, last event time, and ack status for each alarm. FIQL operators: == (equals), != (not equals), =lt= (less than), =gt= (greater than). Combine with ; (AND) or , (OR).",
    {
      filter: z.string().optional().describe(
        "FIQL filter expression. Examples: 'severity==CRITICAL', 'node.label==myserver', 'severity==CRITICAL;node.label==myserver'. Omit for all alarms. Do NOT URL-encode — pass the raw FIQL string."
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
          // Do NOT call encodeURIComponent(filter) — axios handles encoding automatically.
          // Pre-encoding would produce double-encoded sequences (%2528 instead of %28).
        }
        const resp = await client.v2.get("/alarms", { params });

        // v2 API returns HTTP 204 No Content (not 200 + empty array) when no alarms match.
        if (resp.status === 204 || !resp.data?.alarm?.length) {
          return {
            content: [{ type: "text", text: "No alarms found matching the given filter." }],
          };
        }

        const data = resp.data as AlarmListResponse;
        const alarms = data.alarm;
        const totalCount = data.totalCount ?? alarms.length;

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

  // ALARM-02: Get a specific alarm by numeric ID
  server.tool(
    "get_alarm",
    "Get full details for a specific OpenNMS alarm by its numeric ID. Returns all alarm fields including severity, node, UEI, description, event times, and acknowledgement status.",
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

}
