# opennms-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that connects Claude to OpenNMS. Ask Claude to list alarms, inspect nodes, send events, update asset records, manage categories, and control service collection — all in plain language.

## Prerequisites

- Node.js 22+
- An OpenNMS instance reachable over HTTP/HTTPS
- A user account with API access (admin or a read/write role)

## Installation

```bash
git clone https://github.com/c-perronnet/opennms-mcp.git
cd opennms-mcp
npm install
npm run build
```

## Configuration

Create a JSON file with your OpenNMS credentials. Two auth formats are supported:

**Basic auth** (`opennms/myserver.json`):
```json
{
  "url": "https://opennms.example.com",
  "username": "admin",
  "password": "secret"
}
```

**Token auth** (`opennms/myserver.json`):
```json
{
  "url": "https://opennms.example.com",
  "token": "your-api-token"
}
```

Add `"insecure": true` to either format to skip TLS certificate validation (useful for self-signed certs).

Store config files in the `opennms/` directory — it is git-ignored so credentials are never committed.

## Connecting to Claude Desktop

Add the server to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opennms": {
      "command": "node",
      "args": ["/absolute/path/to/opennms-mcp/dist/index.js"],
      "env": {
        "OPENNMS_CONFIG": "/absolute/path/to/opennms-mcp/opennms/myserver.json"
      }
    }
  }
}
```

Alternatively, pass the config path as a positional argument:

```json
{
  "mcpServers": {
    "opennms": {
      "command": "node",
      "args": [
        "/absolute/path/to/opennms-mcp/dist/index.js",
        "/absolute/path/to/opennms-mcp/opennms/myserver.json"
      ]
    }
  }
}
```

## Available tools

### Connectivity
| Tool | Description |
|------|-------------|
| `server_info` | Verify connectivity and return OpenNMS version |

### Alarms
| Tool | Description |
|------|-------------|
| `list_alarms` | List alarms, optionally filtered by FIQL expression |
| `get_alarm` | Get full details for an alarm by ID |
| `acknowledge_alarm` | Acknowledge an alarm |
| `modify_alarm` | Unacknowledge, clear, or escalate an alarm |

### Nodes
| Tool | Description |
|------|-------------|
| `list_nodes` | List nodes, optionally filtered by FIQL expression |
| `get_node` | Get full node details (accepts numeric ID or `foreignSource:foreignId`) |
| `get_node_ip_interfaces` | List IP interfaces for a node |
| `get_node_snmp_interfaces` | List SNMP interfaces for a node |
| `get_node_outages` | List outages for a node |
| `rescan_node` | Trigger a capability rescan for a node |

### Events
| Tool | Description |
|------|-------------|
| `list_events` | List events, optionally filtered by FIQL expression |
| `get_event` | Get full details for an event by ID |
| `send_event` | Send a custom event to the OpenNMS event bus |

### Asset records
| Tool | Description |
|------|-------------|
| `get_node_asset_record` | Get the asset record for a node |
| `update_node_asset_record` | Update one or more asset fields for a node |

### Categories
| Tool | Description |
|------|-------------|
| `list_categories` | List all categories defined in OpenNMS |
| `get_node_categories` | List categories assigned to a node |
| `add_category_to_node` | Assign a category to a node |
| `remove_category_from_node` | Remove a category from a node |

### Collection / polling
| Tool | Description |
|------|-------------|
| `list_node_services` | List monitored services on a node's IP interface |
| `enable_service_collection` | Enable collection for a service (set to Active) |
| `disable_service_collection` | Disable collection for a service (set to Forced Unmanaged) |

## FIQL filtering

Several list tools accept a `filter` parameter using [FIQL](https://fiql-parser.readthedocs.io/) syntax:

| Operator | Meaning |
|----------|---------|
| `==` | equals |
| `!=` | not equals |
| `=lt=` | less than |
| `=gt=` | greater than |
| `;` | AND |
| `,` | OR |

Examples:
- `severity==CRITICAL` — critical alarms only
- `node.label==web*` — nodes whose label starts with "web"
- `severity==MAJOR,severity==CRITICAL` — major or critical alarms
- `category.name==Routers` — nodes in the Routers category

## Development

```bash
npm run dev    # watch mode — recompiles on file changes
npm run build  # one-shot compile to dist/
npm start      # run compiled server (requires OPENNMS_CONFIG)
```

## License

MIT
