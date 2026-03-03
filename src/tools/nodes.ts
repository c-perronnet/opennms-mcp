import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

// NodeDTO derived from OnmsNode.java JAXB annotations and UI types/index.ts
// CRITICAL: node.id is serialized as string (@XmlID), not number
interface NodeDTO {
  id: string;               // @XmlID — string even though internally Integer
  label: string;
  type?: string;            // "A"=active, "D"=deleted
  foreignSource?: string;
  foreignId?: string;
  location?: string;
  sysName?: string;
  sysDescription?: string;
  sysObjectId?: string;
  sysLocation?: string;
  sysContact?: string;
  createTime?: number;      // epoch ms
  lastCapsdPoll?: string;
}

// IpInterfaceDTO derived from OnmsIpInterface.java and UI types/index.ts
interface IpInterfaceDTO {
  id: string;               // @XmlID — string
  ipAddress: string;
  hostName?: string;
  isManaged?: string;       // "M"=managed, "U"=unmanaged
  snmpPrimary?: string;     // "P"=primary, "S"=secondary, "N"=not eligible
  ifIndex?: number;
  isDown?: boolean;
  nodeId?: number;
  lastCapsdPoll?: number;
}

// SnmpInterfaceDTO derived from OnmsSnmpInterface.java and UI types/index.ts
// NOTE: ifDescr, ifName, etc. lack @XmlAttribute annotations in Java source;
// presence in JSON is inferred from UI TypeScript types — all fields marked optional.
interface SnmpInterfaceDTO {
  id: number;
  ifIndex?: number;
  ifDescr?: string;
  ifName?: string;
  ifAlias?: string;
  ifSpeed?: number;
  ifAdminStatus?: number;   // 1=up, 2=down, 3=testing
  ifOperStatus?: number;    // 1=up, 2=down
  ifType?: number;
  physAddr?: string;
  collectFlag?: string;
  collect?: boolean;
  poll?: boolean;
}

// Format a node as a one-entry summary block (used in list_nodes)
function formatNodeSummary(node: NodeDTO): string {
  const fs = node.foreignSource && node.foreignId
    ? `  ForeignSource: ${node.foreignSource}  ForeignId: ${node.foreignId}`
    : "";
  const loc = node.location ? `  Location: ${node.location}` : "";
  return [
    `ID: ${node.id}  Label: ${node.label}${loc}`,
    fs,
  ].filter(Boolean).join("\n");
}

// Format full node detail (used in get_node)
function formatNodeDetail(node: NodeDTO): string {
  const lines: string[] = [
    `Node ID: ${node.id}`,
    `Label: ${node.label}`,
    `Type: ${node.type ?? "unknown"}`,
    `Foreign Source: ${node.foreignSource ?? "none"}`,
    `Foreign ID: ${node.foreignId ?? "none"}`,
    `Location: ${node.location ?? "none"}`,
    `SysName: ${node.sysName ?? "none"}`,
    `SysDescription: ${node.sysDescription ?? "none"}`,
    `SysObjectId: ${node.sysObjectId ?? "none"}`,
    `SysLocation: ${node.sysLocation ?? "none"}`,
    `SysContact: ${node.sysContact ?? "none"}`,
    `Created: ${node.createTime ? new Date(node.createTime).toISOString() : "unknown"}`,
    `Last Poll: ${node.lastCapsdPoll ?? "unknown"}`,
  ];
  return lines.join("\n");
}

// Format a single IP interface as a summary line
function formatIpInterface(iface: IpInterfaceDTO): string {
  const managed = iface.isManaged === "M" ? "managed" : iface.isManaged === "U" ? "unmanaged" : iface.isManaged ?? "unknown";
  const primary = iface.snmpPrimary === "P" ? "SNMP primary" : iface.snmpPrimary === "S" ? "SNMP secondary" : "";
  const down = iface.isDown ? "  [DOWN]" : "";
  const parts = [
    `IP: ${iface.ipAddress}`,
    iface.hostName ? `Host: ${iface.hostName}` : null,
    `Managed: ${managed}`,
    primary || null,
    iface.ifIndex ? `ifIndex: ${iface.ifIndex}` : null,
  ].filter(Boolean);
  return parts.join("  ") + down;
}

// Format a single SNMP interface as a summary line
function formatSnmpInterface(iface: SnmpInterfaceDTO): string {
  const adminStatus = iface.ifAdminStatus === 1 ? "admin:up" : iface.ifAdminStatus === 2 ? "admin:down" : `admin:${iface.ifAdminStatus ?? "?"}`;
  const operStatus = iface.ifOperStatus === 1 ? "oper:up" : iface.ifOperStatus === 2 ? "oper:down" : `oper:${iface.ifOperStatus ?? "?"}`;
  const parts = [
    iface.ifIndex != null ? `ifIndex: ${iface.ifIndex}` : null,
    iface.ifName ? `Name: ${iface.ifName}` : null,
    iface.ifDescr ? `Descr: ${iface.ifDescr}` : null,
    iface.ifAlias ? `Alias: ${iface.ifAlias}` : null,
    adminStatus,
    operStatus,
    iface.physAddr ? `MAC: ${iface.physAddr}` : null,
  ].filter(Boolean);
  return parts.join("  ");
}

export function registerNodeTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {

  // NODE-01: List nodes with optional FIQL filter by label or category
  server.tool(
    "list_nodes",
    "List OpenNMS nodes. Optionally filter by label or category using FIQL. Examples: 'label==myserver', 'label==web*' (wildcard), 'category.name==Routers', 'foreignSource==MySource'. IMPORTANT: use 'category.name==X' not 'category==X'. Returns node ID, label, foreignSource, foreignId, and location for each node.",
    {
      filter: z.string().optional().describe(
        "FIQL filter. Examples: 'label==myserver', 'label==web*' (wildcard), 'category.name==Routers', 'foreignSource==MyImportSource'. Omit for all nodes. Do NOT URL-encode."
      ),
      limit: z.number().int().min(1).max(1000).default(25).describe(
        "Maximum number of nodes to return (default 25, max 1000)."
      ),
    },
    async ({ filter, limit }) => {
      try {
        const params: Record<string, string | number> = { limit };
        if (filter) params._s = filter;
        // Do NOT call encodeURIComponent — axios encodes automatically; pre-encoding doubles it.
        const resp = await client.v2.get("/nodes", { params });

        // v2 returns HTTP 204 No Content (not 200 + empty array) when no nodes match.
        if (resp.status === 204 || !resp.data?.node?.length) {
          return { content: [{ type: "text", text: "No nodes found matching the given filter." }] };
        }

        // CRITICAL: array key is "node" (singular), not "nodes" — @JsonProperty("node") in OnmsNodeList.java
        const nodes = resp.data.node as NodeDTO[];
        const totalCount: number = resp.data.totalCount ?? nodes.length;
        const lines = nodes.map(formatNodeSummary);
        const header = `Nodes: ${nodes.length} of ${totalCount} total`;
        return { content: [{ type: "text", text: [header, "", ...lines].join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: buildErrorMessage(err, "list nodes") }], isError: true };
      }
    }
  );

  // NODE-02: Get a specific node by numeric ID or foreignSource:foreignId
  server.tool(
    "get_node",
    "Get full details for a specific OpenNMS node. Accepts either a numeric node ID (e.g. '42') or 'foreignSource:foreignId' format (e.g. 'MySource:server-001'). The v2 API resolves both formats transparently — no separate lookup needed.",
    {
      id: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
    },
    async ({ id }) => {
      try {
        const resp = await client.v2.get(`/nodes/${id}`);
        const node = resp.data as NodeDTO;
        return { content: [{ type: "text", text: formatNodeDetail(node) }] };
      } catch (err) {
        return { content: [{ type: "text", text: buildErrorMessage(err, `node ${id}`) }], isError: true };
      }
    }
  );

  // NODE-03: List IP interfaces for a node
  server.tool(
    "get_node_ip_interfaces",
    "List IP interfaces for an OpenNMS node. Accepts numeric node ID or 'foreignSource:foreignId' format. Returns IP address, hostname, managed status, SNMP primary flag, and ifIndex for each interface.",
    {
      id: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
    },
    async ({ id }) => {
      try {
        const resp = await client.v2.get(`/nodes/${id}/ipinterfaces`);

        // CRITICAL: array key is "ipInterface" (singular), not "ipInterfaces"
        if (resp.status === 204 || !resp.data?.ipInterface?.length) {
          return { content: [{ type: "text", text: `No IP interfaces found for node ${id}.` }] };
        }

        const interfaces = resp.data.ipInterface as IpInterfaceDTO[];
        const totalCount: number = resp.data.totalCount ?? interfaces.length;
        const lines = interfaces.map(formatIpInterface);
        const header = `IP Interfaces for node ${id}: ${interfaces.length} of ${totalCount} total`;
        return { content: [{ type: "text", text: [header, "", ...lines].join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: buildErrorMessage(err, `IP interfaces for node ${id}`) }], isError: true };
      }
    }
  );

  // NODE-04: List SNMP interfaces for a node
  server.tool(
    "get_node_snmp_interfaces",
    "List SNMP interfaces for an OpenNMS node. Accepts numeric node ID or 'foreignSource:foreignId' format. Returns ifIndex, ifName, ifDescr, ifAlias, admin/oper status, and MAC address for each interface.",
    {
      id: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
    },
    async ({ id }) => {
      try {
        const resp = await client.v2.get(`/nodes/${id}/snmpinterfaces`);

        // CRITICAL: array key is "snmpInterface" (singular), not "snmpInterfaces"
        if (resp.status === 204 || !resp.data?.snmpInterface?.length) {
          return { content: [{ type: "text", text: `No SNMP interfaces found for node ${id}.` }] };
        }

        const interfaces = resp.data.snmpInterface as SnmpInterfaceDTO[];
        const totalCount: number = resp.data.totalCount ?? interfaces.length;
        const lines = interfaces.map(formatSnmpInterface);
        const header = `SNMP Interfaces for node ${id}: ${interfaces.length} of ${totalCount} total`;
        return { content: [{ type: "text", text: [header, "", ...lines].join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: buildErrorMessage(err, `SNMP interfaces for node ${id}`) }], isError: true };
      }
    }
  );

}
