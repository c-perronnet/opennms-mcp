import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

// EventDTO derived from EventDTO.java @XmlAttribute/@XmlElement annotations (v2 JSON response)
// CRITICAL: id is Integer (NOT string) — unlike NodeDTO which uses @XmlID (string)
interface EventDTO {
  id?: number;           // @XmlAttribute(name="id") — Integer, NOT string
  uei?: string;          // @XmlElement(name="uei")
  label?: string;        // @XmlElement(name="label")
  time?: string;         // @XmlElement(name="time") — Date as ISO-8601 or epoch
  source?: string;       // @XmlElement(name="source")
  severity?: string;     // @XmlAttribute(name="severity")
  nodeId?: number;       // @XmlElement(name="nodeId")
  nodeLabel?: string;    // @XmlElement(name="nodeLabel")
  description?: string;  // @XmlElement(name="description")
  logMessage?: string;   // @XmlElement(name="logMessage")
  ipAddress?: string;    // @XmlElement(name="ipAddress")
  location?: string;     // @XmlElement(name="location")
  createTime?: string;   // @XmlElement(name="createTime")
}

interface EventListResponse {
  event: EventDTO[];     // @JsonProperty("event") — singular key from EventCollectionDTO.java
  totalCount: number;
  count: number;
  offset: number;
}

// AssetRecordDTO key fields from OnmsAssetRecord.java @Column annotations
// Field names are Java property names (camelCase from getter/setter for BeanWrapper)
interface AssetRecordDTO {
  id?: number;
  // Hardware
  manufacturer?: string;
  vendor?: string;
  modelNumber?: string;
  serialNumber?: string;
  operatingSystem?: string;
  cpu?: string;
  ram?: string;
  storagectrl?: string;
  hdd1?: string; hdd2?: string; hdd3?: string; hdd4?: string; hdd5?: string; hdd6?: string;
  numpowersupplies?: string;
  inputpower?: string;
  additionalhardware?: string;
  // Location
  building?: string;
  floor?: string;
  room?: string;
  rack?: string;
  rackunitheight?: string;
  slot?: string;
  port?: string;
  region?: string;
  division?: string;
  department?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  // Contact
  vendorPhone?: string;
  vendorFax?: string;
  vendorAssetNumber?: string;
  supportPhone?: string;
  // Identification
  assetNumber?: string;
  circuitId?: string;
  category?: string;     // asset category field (distinct from node category)
  description?: string;
  comment?: string;
  // Maintenance
  dateInstalled?: string;
  lease?: string;
  leaseExpires?: string;
  maintcontract?: string;
  maintContractExpiration?: string;
  // Management
  username?: string;
  connection?: string;
  autoenable?: string;
  snmpcommunity?: string;
  admin?: string;
  // Display/management categories
  displayCategory?: string;
  notifyCategory?: string;
  pollerCategory?: string;
  thresholdCategory?: string;
  // Management
  managedObjectType?: string;
  managedObjectInstance?: string;
  // Tracking
  lastModifiedBy?: string;
  lastModifiedDate?: string;
}

// Format a single event as a summary line (used in list_events)
function formatEventSummary(event: EventDTO): string {
  const time = event.time ? new Date(event.time).toISOString() : "unknown";
  const node = event.nodeLabel ?? (event.nodeId ? `node ${event.nodeId}` : "no node");
  return [
    `ID: ${event.id ?? "?"}  Severity: ${event.severity ?? "UNKNOWN"}  Node: ${node}`,
    `  UEI: ${event.uei ?? "none"}`,
    `  Time: ${time}  Source: ${event.source ?? "unknown"}`,
    event.logMessage ? `  Message: ${event.logMessage}` : null,
  ].filter(Boolean).join("\n");
}

// Format full event detail (used in get_event)
function formatEventDetail(event: EventDTO): string {
  const lines: string[] = [
    `Event ID: ${event.id ?? "unknown"}`,
    `UEI: ${event.uei ?? "none"}`,
    `Label: ${event.label ?? "none"}`,
    `Severity: ${event.severity ?? "UNKNOWN"}`,
    `Node: ${event.nodeLabel ?? (event.nodeId ? `node ${event.nodeId}` : "none")}`,
    `IP Address: ${event.ipAddress ?? "none"}`,
    `Time: ${event.time ? new Date(event.time).toISOString() : "unknown"}`,
    `Source: ${event.source ?? "unknown"}`,
    `Location: ${event.location ?? "none"}`,
    `Description: ${event.description ?? "none"}`,
    `Log Message: ${event.logMessage ?? "none"}`,
    `Created: ${event.createTime ?? "unknown"}`,
  ];
  return lines.join("\n");
}

// Format the full asset record as a readable block
function formatAssetRecord(asset: AssetRecordDTO, nodeId: string): string {
  const sections: string[] = [`Asset Record for node ${nodeId}:`];

  const hw = [
    asset.manufacturer ? `Manufacturer: ${asset.manufacturer}` : null,
    asset.vendor ? `Vendor: ${asset.vendor}` : null,
    asset.modelNumber ? `Model: ${asset.modelNumber}` : null,
    asset.serialNumber ? `Serial: ${asset.serialNumber}` : null,
    asset.operatingSystem ? `OS: ${asset.operatingSystem}` : null,
    asset.cpu ? `CPU: ${asset.cpu}` : null,
    asset.ram ? `RAM: ${asset.ram}` : null,
  ].filter(Boolean);
  if (hw.length > 0) sections.push("Hardware:\n  " + hw.join("\n  "));

  const loc = [
    asset.building ? `Building: ${asset.building}` : null,
    asset.floor ? `Floor: ${asset.floor}` : null,
    asset.room ? `Room: ${asset.room}` : null,
    asset.rack ? `Rack: ${asset.rack}` : null,
    asset.slot ? `Slot: ${asset.slot}` : null,
    asset.city ? `City: ${asset.city}` : null,
    asset.state ? `State: ${asset.state}` : null,
    asset.country ? `Country: ${asset.country}` : null,
    asset.region ? `Region: ${asset.region}` : null,
    asset.department ? `Department: ${asset.department}` : null,
  ].filter(Boolean);
  if (loc.length > 0) sections.push("Location:\n  " + loc.join("\n  "));

  const contact = [
    asset.vendorPhone ? `Vendor Phone: ${asset.vendorPhone}` : null,
    asset.supportPhone ? `Support Phone: ${asset.supportPhone}` : null,
    asset.vendorAssetNumber ? `Vendor Asset #: ${asset.vendorAssetNumber}` : null,
  ].filter(Boolean);
  if (contact.length > 0) sections.push("Contact:\n  " + contact.join("\n  "));

  const ident = [
    asset.assetNumber ? `Asset #: ${asset.assetNumber}` : null,
    asset.circuitId ? `Circuit ID: ${asset.circuitId}` : null,
    asset.category ? `Asset Category: ${asset.category}` : null,
    asset.description ? `Description: ${asset.description}` : null,
    asset.comment ? `Comment: ${asset.comment}` : null,
  ].filter(Boolean);
  if (ident.length > 0) sections.push("Identification:\n  " + ident.join("\n  "));

  const mgmt = [
    asset.displayCategory ? `Display Category: ${asset.displayCategory}` : null,
    asset.notifyCategory ? `Notify Category: ${asset.notifyCategory}` : null,
    asset.pollerCategory ? `Poller Category: ${asset.pollerCategory}` : null,
    asset.thresholdCategory ? `Threshold Category: ${asset.thresholdCategory}` : null,
    asset.managedObjectType ? `Managed Object Type: ${asset.managedObjectType}` : null,
    asset.lastModifiedBy ? `Last Modified By: ${asset.lastModifiedBy}` : null,
    asset.lastModifiedDate ? `Last Modified Date: ${asset.lastModifiedDate}` : null,
  ].filter(Boolean);
  if (mgmt.length > 0) sections.push("Management:\n  " + mgmt.join("\n  "));

  if (sections.length === 1) sections.push("(All asset fields are empty)");
  return sections.join("\n\n");
}

export function registerEventTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {

  // EVENT-01: List events with optional FIQL filter (v2 — FIQL required; v1 has no FIQL support)
  // CRITICAL: FIQL property names: use "eventUei" not "uei"; use "node.id" not "nodeId"; use "eventSeverity" not "severity"
  // Response envelope key is "event" (singular) — confirmed from EventCollectionDTO.java @JsonProperty("event")
  // 204 guard required — same as alarms and nodes: v2 returns HTTP 204 No Content when no events match
  server.tool(
    "list_events",
    "List OpenNMS events. Optionally filter with a FIQL expression. Examples: 'eventUei==uei.opennms.org/nodes/nodeDown', 'node.id==42', 'node.label==myserver', 'eventSeverity==7' (7=CRITICAL, 6=MAJOR, 5=MINOR, 4=WARNING). Returns most recent events first. FIQL operators: == (equals), != (not equals), =lt= (less than), =gt= (greater than). Combine with ; (AND) or , (OR). IMPORTANT: use 'eventUei' not 'uei' in FIQL; use 'node.id' not 'nodeId'.",
    {
      filter: z.string().optional().describe(
        "FIQL filter. Examples: 'eventUei==uei.opennms.org/nodes/nodeDown', 'node.id==42', 'node.label==myserver', 'eventSeverity==7'. Omit for all events. Do NOT URL-encode — pass the raw FIQL string."
      ),
      limit: z.number().int().min(1).max(1000).default(25).describe(
        "Maximum number of events to return (default 25, max 1000)."
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
        const resp = await client.v2.get("/events", { params });

        // v2 returns HTTP 204 No Content (not 200 + empty array) when no events match
        if (resp.status === 204 || !resp.data?.event?.length) {
          return {
            content: [{ type: "text", text: "No events found matching the given filter." }],
          };
        }

        const data = resp.data as EventListResponse;
        const events = data.event;
        const totalCount = data.totalCount ?? events.length;

        const lines = events.map((e) => formatEventSummary(e));
        const header = `Events: ${events.length} of ${totalCount} total`;
        const text = [header, "", ...lines].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, "list events") }],
          isError: true,
        };
      }
    }
  );

  // EVENT-02: Get a specific event by numeric ID
  // EventDTO.id is Integer (NOT string) — unlike NodeDTO which is @XmlID string
  server.tool(
    "get_event",
    "Get full details for a specific OpenNMS event by its numeric ID. Returns UEI, severity, node, IP address, time, source, description, and log message.",
    {
      id: z.number().int().positive().describe("The numeric ID of the event."),
    },
    async ({ id }) => {
      try {
        const resp = await client.v2.get(`/events/${id}`);
        const event = resp.data as EventDTO;
        return {
          content: [{ type: "text", text: formatEventDetail(event) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, `event ${id}`) }],
          isError: true,
        };
      }
    }
  );

  // EVENT-03: Send a custom event to the OpenNMS event bus
  // API: POST /api/v2/events with Content-Type: application/json
  // Response: HTTP 204 No Content on success — do NOT access resp.data
  // CRITICAL field name mapping from Event.java JAXB @XmlElement annotations:
  //   nodeid   (lowercase, no camelCase) — NOT "nodeId"
  //   interface                          — NOT "ipAddress"
  //   descr                              — NOT "description"
  // Source is auto-set to "ReST" by the server if not provided.
  server.tool(
    "send_event",
    "Send a custom event to the OpenNMS event bus. Only 'uei' is required. The event appears in the OpenNMS event list immediately. Source is set to 'ReST' automatically by the server.",
    {
      uei: z.string().describe(
        "Event UEI (Unique Event Identifier). Example: 'uei.opennms.org/generic/traps/SNMP_Warm_Start' or a custom UEI."
      ),
      nodeId: z.number().int().positive().optional().describe(
        "Numeric node ID to associate with the event. Optional."
      ),
      ipInterface: z.string().optional().describe(
        "IP interface address to associate with the event (e.g. '192.168.1.1'). Optional."
      ),
      description: z.string().optional().describe(
        "Event description text. Optional."
      ),
      severity: z.string().optional().describe(
        "Event severity: INDETERMINATE, CLEARED, NORMAL, WARNING, MINOR, MAJOR, or CRITICAL. Optional."
      ),
    },
    async ({ uei, nodeId, ipInterface, description, severity }) => {
      try {
        // Build event JSON body matching org.opennms.netmgt.xml.event.Event JAXB schema
        // CRITICAL: field names must match @XmlElement(name="...") annotations exactly
        const body: Record<string, unknown> = { uei };
        if (nodeId != null) body.nodeid = nodeId;       // @XmlElement(name="nodeid") — lowercase
        if (ipInterface) body.interface = ipInterface;  // @XmlElement(name="interface")
        if (description) body.descr = description;      // @XmlElement(name="descr") — NOT "description"
        if (severity) body.severity = severity;

        await client.v2.post("/events", body);
        // Returns HTTP 204 No Content on success — do NOT access resp.data (will be empty)

        return {
          content: [{ type: "text", text: `Event sent: ${uei}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, `send event ${uei}`) }],
          isError: true,
        };
      }
    }
  );

  // ASSET-01: Get the full asset record for a node
  // API: GET /opennms/rest/nodes/{nodeCriteria}/assetRecord — v1 sub-resource
  // Source: NodeRestService.getAssetRecordResource() delegates to AssetRecordResource.getAssetRecord()
  // Accepts numeric ID or foreignSource:foreignId (v1 m_nodeDao.get() handles both)
  // Returns single OnmsAssetRecord JSON object (NOT an array)
  server.tool(
    "get_node_asset_record",
    "Get the full asset record for an OpenNMS node. Returns all asset fields including location, hardware, contact info, manufacturer, serial number, OS, rack/room details, and management categories. Accepts numeric node ID or 'foreignSource:foreignId' format.",
    {
      id: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
    },
    async ({ id }) => {
      try {
        const resp = await client.v1.get(`/nodes/${id}/assetRecord`);
        const asset = resp.data as AssetRecordDTO;
        return {
          content: [{ type: "text", text: formatAssetRecord(asset, id) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, `asset record for node ${id}`) }],
          isError: true,
        };
      }
    }
  );

  // ASSET-02: Update one or more asset fields for a node (native partial update — no GET needed)
  // API: PUT /opennms/rest/nodes/{nodeCriteria}/assetRecord with Content-Type: application/x-www-form-urlencoded
  // CRITICAL: The Java AssetRecordResource.updateAssetRecord() uses Spring BeanWrapper.setPropertyValue()
  //   which applies ONLY the fields present in the form body. Fields NOT in the body are UNTOUCHED.
  //   This is a server-side partial update — no GET-merge-PUT needed in the client.
  // Response: 204 No Content (fields changed) or 304 Not Modified (no recognized fields submitted)
  //   Both 204 and 304 are success — do NOT access resp.data after the PUT.
  // URLSearchParams body causes axios to auto-set Content-Type: application/x-www-form-urlencoded
  //   (overrides instance-level Content-Type: application/json), matching @Consumes(FORM_URLENCODED)
  server.tool(
    "update_node_asset_record",
    "Update one or more asset fields for an OpenNMS node. Only the fields you provide are changed — other fields are untouched. Accepts numeric node ID or 'foreignSource:foreignId'. Common fields: building, floor, room, rack, slot, city, state, country, department, manufacturer, modelNumber, serialNumber, operatingSystem, cpu, ram, description, comment, assetNumber, supportPhone, displayCategory, pollerCategory.",
    {
      id: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
      fields: z.record(z.string()).describe(
        "Key-value pairs of asset fields to update. Example: { \"building\": \"HQ\", \"city\": \"New York\", \"cpu\": \"Intel Xeon\" }. Only submitted fields are changed; others are untouched. Field names are Java property names (camelCase or lowercase as shown in the tool description)."
      ),
    },
    async ({ id, fields }) => {
      try {
        // URLSearchParams: axios detects this and sets Content-Type: application/x-www-form-urlencoded
        // automatically, overriding the instance-level Content-Type: application/json header.
        // The v1 AssetRecordResource @Consumes(APPLICATION_FORM_URLENCODED) requires this.
        const body = new URLSearchParams(fields);
        await client.v1.put(`/nodes/${id}/assetRecord`, body);
        // 204 No Content (fields changed) or 304 Not Modified (no writable fields submitted)
        // Both are success — do NOT access resp.data

        const fieldNames = Object.keys(fields).join(", ");
        return {
          content: [{ type: "text", text: `Asset record updated for node ${id}. Fields changed: ${fieldNames}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, `update asset record for node ${id}`) }],
          isError: true,
        };
      }
    }
  );

}
