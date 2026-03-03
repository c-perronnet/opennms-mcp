import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

// Source: opennms/opennms-model/.../OnmsServiceType.java
interface OnmsServiceType {
  id?: number;
  name?: string;   // @Column(name="serviceName") — MEDIUM confidence in JSON; use defensive fallback
}

// Source: opennms/opennms-model/.../OnmsMonitoredService.java
// JSON response fields from @XmlAttribute and @JsonProperty annotations
interface MonitoredServiceDTO {
  id?: number;
  status?: string;       // "A"=Managed/collecting, "F"=Forced Unmanaged/not collecting, "U"/"N"/"D" others
  statusLong?: string;   // Human-readable: "Managed", "Forced Unmanaged", etc.
  down?: boolean;        // true when service is currently down
  ipAddress?: string;
  ipInterfaceId?: number;
  nodeId?: number;
  nodeLabel?: string;
  serviceType?: OnmsServiceType;  // nested object; name MEDIUM confidence — use fallback
}

// Get service name from DTO — serviceType.name is MEDIUM confidence; fall back to "(unknown)"
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

export function registerCollectionTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {

  // COLL-01: List monitored services on a node IP interface
  server.tool(
    "list_node_services",
    "List monitored services on a specific IP interface of an OpenNMS node. Returns each service name and its collection status (A=Active/collecting, F=Forced Unmanaged/not collecting). Use the IP address exactly as shown by get_node_ip_interfaces — the value must match what OpenNMS has stored.",
    {
      nodeId: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
      ipAddress: z.string().describe(
        "IP address of the interface (e.g. '192.168.1.10'). Use the exact value from get_node_ip_interfaces output."
      ),
    },
    async ({ nodeId, ipAddress }) => {
      try {
        const encodedIp = encodeURIComponent(ipAddress);
        const resp = await client.v1.get(`/nodes/${nodeId}/ipinterfaces/${encodedIp}/services`);

        // Array key is "service" (singular) — @JsonProperty("service") in OnmsMonitoredServiceList.java
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

  // COLL-02: Enable collection — PUT status=A (Managed)
  // Source: OnmsMonitoredServiceResource.java @PUT @Consumes(FORM_URLENCODED)
  // Returns 204 No Content (changed) or 304 Not Modified (already active) — both are success; do NOT access resp.data
  server.tool(
    "enable_service_collection",
    "Enable collection/polling for a monitored service on a node's IP interface. Sets the service status to Active (A=Managed). Use the service name exactly as shown by list_node_services — the name is case-sensitive (e.g. 'ICMP', 'SNMP', 'HTTP').",
    {
      nodeId: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
      ipAddress: z.string().describe(
        "IP address of the interface (e.g. '192.168.1.10'). Use the exact value from get_node_ip_interfaces output."
      ),
      serviceName: z.string().describe(
        "Service name exactly as shown in list_node_services output (case-sensitive, e.g. 'ICMP', 'SNMP', 'HTTP')."
      ),
    },
    async ({ nodeId, ipAddress, serviceName }) => {
      try {
        const encodedIp = encodeURIComponent(ipAddress);
        const encodedSvc = encodeURIComponent(serviceName);
        // URLSearchParams body — axios auto-sets Content-Type: application/x-www-form-urlencoded
        // Required: v1 endpoint is @Consumes(APPLICATION_FORM_URLENCODED); JSON body returns HTTP 415
        const body = new URLSearchParams({ status: "A" });
        await client.v1.put(`/nodes/${nodeId}/ipinterfaces/${encodedIp}/services/${encodedSvc}`, body);
        // 204 = was disabled, now enabled; 304 = was already enabled — both are success; no resp.data
        return { content: [{ type: "text", text: `Collection enabled for service ${serviceName} on ${ipAddress} (node ${nodeId}). Status set to Active (A).` }] };
      } catch (err) {
        return { content: [{ type: "text", text: buildErrorMessage(err, `enable collection for ${serviceName} on ${ipAddress} (node ${nodeId})`) }], isError: true };
      }
    }
  );

  // COLL-03: Disable collection — PUT status=F (Forced Unmanaged)
  // Returns 204 (changed) or 304 (already forced-unmanaged) — both are success; do NOT access resp.data
  server.tool(
    "disable_service_collection",
    "Disable collection/polling for a monitored service on a node's IP interface. Sets the service status to Forced Unmanaged (F). Use the service name exactly as shown by list_node_services — the name is case-sensitive (e.g. 'ICMP', 'SNMP', 'HTTP').",
    {
      nodeId: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
      ipAddress: z.string().describe(
        "IP address of the interface (e.g. '192.168.1.10'). Use the exact value from get_node_ip_interfaces output."
      ),
      serviceName: z.string().describe(
        "Service name exactly as shown in list_node_services output (case-sensitive, e.g. 'ICMP', 'SNMP', 'HTTP')."
      ),
    },
    async ({ nodeId, ipAddress, serviceName }) => {
      try {
        const encodedIp = encodeURIComponent(ipAddress);
        const encodedSvc = encodeURIComponent(serviceName);
        const body = new URLSearchParams({ status: "F" });
        await client.v1.put(`/nodes/${nodeId}/ipinterfaces/${encodedIp}/services/${encodedSvc}`, body);
        // 204 = was enabled, now disabled; 304 = was already forced-unmanaged — both success; no resp.data
        return { content: [{ type: "text", text: `Collection disabled for service ${serviceName} on ${ipAddress} (node ${nodeId}). Status set to Forced Unmanaged (F).` }] };
      } catch (err) {
        return { content: [{ type: "text", text: buildErrorMessage(err, `disable collection for ${serviceName} on ${ipAddress} (node ${nodeId})`) }], isError: true };
      }
    }
  );

} // end registerCollectionTools
