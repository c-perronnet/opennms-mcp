# Features Research: OpenNMS MCP Server

## Table Stakes (Must Have)

These are the minimum tools needed for the MCP server to be useful for network ops.

### Alarms Domain
| Tool | Complexity | Notes |
|------|------------|-------|
| `list_alarms` | Low | FIQL filter support, severity/node/time filters; use v2 API |
| `get_alarm` | Low | By ID |
| `acknowledge_alarm` | Low | PUT /alarms/{id}?ack=true |
| `unacknowledge_alarm` | Low | PUT /alarms/{id}?ack=false |
| `clear_alarm` | Low | PUT /alarms/{id}?clear=true |
| `escalate_alarm` | Low | PUT /alarms/{id}?escalate=true |

### Events Domain
| Tool | Complexity | Notes |
|------|------------|-------|
| `list_events` | Low | Filter by node, UEI, severity; use v1 (v2 events may be limited) |
| `send_event` | Medium | POST XML to /events; requires UEI + optional params |

### Nodes Domain
| Tool | Complexity | Notes |
|------|------------|-------|
| `list_nodes` | Low | Filter by label, category, foreignSource |
| `get_node` | Low | By ID or foreignSource:foreignId |
| `list_node_ip_interfaces` | Low | v2 API with FIQL |
| `list_node_snmp_interfaces` | Low | v1 API |
| `get_node_outages` | Low | /nodes/{id}/outages or /outages?node.id=X |
| `rescan_node` | Low | POST /nodes/{id}/rescan |

### Assets Domain
| Tool | Complexity | Notes |
|------|------------|-------|
| `get_node_assets` | Low | GET /nodes/{id}/assetRecord |
| `update_node_assets` | Medium | PUT /nodes/{id}/assetRecord (XML body) |

### Categories Domain
| Tool | Complexity | Notes |
|------|------------|-------|
| `list_categories` | Low | GET /categories |
| `get_node_categories` | Low | GET /nodes/{id}/categories |
| `add_node_category` | Low | POST /nodes/{id}/categories/{name} |
| `remove_node_category` | Low | DELETE /nodes/{id}/categories/{name} |

### Collection Config Domain
| Tool | Complexity | Notes |
|------|------------|-------|
| `list_node_services` | Low | GET /nodes/{id}/ipinterfaces/{ip}/services |
| `enable_collection` | Medium | PUT on ifServices or snmpInterfaces — need to verify API |
| `disable_collection` | Medium | Inverse of above |

## Differentiating Features

These make the MCP server more useful than a raw API call:

| Feature | Description |
|---------|-------------|
| Smart alarm summary | `summarize_alarms` — count by severity/node, surface top offenders |
| Node health overview | Combine alarms + outages + availability into one tool call |
| FIQL helper | Accept human-readable filters, not raw FIQL strings |
| Bulk acknowledge | Acknowledge all alarms matching a filter in one tool call |

## Anti-Features (Defer to v2+)

| Feature | Reason |
|---------|--------|
| Provisioning/requisitions | Complex enough to be a separate project |
| Performance data (RRD graphs) | Binary data, not useful in text MCP responses |
| Real-time event streaming | MCP is request/response, not push |
| User/group management | Low operational value for network ops use case |
| Scheduled outages | Niche; add in v2 if requested |
| Flow analytics | Requires different data pipeline |

## Dependencies Between Features

- Assets and Categories both depend on `get_node` (need node ID)
- Collection config depends on `list_node_ip_interfaces` (need IP addresses)
- `send_event` can trigger alarms — good to have alarm tools first
- Build order: Alarms → Nodes → Events → Assets → Categories → Collection
