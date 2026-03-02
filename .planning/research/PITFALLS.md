# Pitfalls Research: OpenNMS MCP Server

## MCP Server Pitfalls

### 1. Tool descriptions that confuse Claude
**Warning sign:** Claude picks the wrong tool or asks for clarification too often
**Prevention:** Write tool descriptions as actions, not nouns. "List active alarms filtered by severity or node" not "Alarm listing tool". Include example filter values in descriptions.
**Phase:** Phase 1 (foundation)

### 2. Too many required parameters
**Warning sign:** Claude has to ask the user for every field before calling a tool
**Prevention:** Make most params optional with sensible defaults. `list_alarms` with no args should return recent unacknowledged alarms.
**Phase:** Phase 1 (foundation)

### 3. Returning raw JSON blobs to Claude
**Warning sign:** Claude can't summarize or act on tool results meaningfully
**Prevention:** Return structured but readable text — include key fields (id, label, severity, message) rather than entire API response objects. Format as markdown tables or bullet lists.
**Phase:** All phases

### 4. No pagination handling
**Warning sign:** Tool returns 10 items (OpenNMS default limit), user misses critical alarms
**Prevention:** Always set explicit limit param. Default to a reasonable value (25-50). Expose limit and offset as optional tool params.
**Phase:** Phase 1 (foundation)

## OpenNMS API Pitfalls

### 5. Mixed content-type requirements
**Warning sign:** PUT/POST requests fail with 415 Unsupported Media Type
**Prevention:**
- GET: Accept: application/json
- POST to /events: Content-Type: application/xml (events endpoint only accepts XML)
- PUT to /alarms/{id}: Content-Type: application/x-www-form-urlencoded
- PUT to /nodes/{id}/assetRecord: Content-Type: application/xml
**Phase:** Each domain phase

### 6. OpenNMS URL path confusion (v1 vs v2)
**Warning sign:** 404s on API calls
**Prevention:**
- v1 base: http://host:8980/opennms/rest/
- v2 base: http://host:8980/opennms/api/v2/
- The user config URL should be just http://host:8980 — client appends paths
**Phase:** Phase 1 (client)

### 7. FIQL query encoding
**Warning sign:** Filters with special chars (commas, colons) silently fail or match wrong records
**Prevention:** Double-percent-encode reserved FIQL chars in filter values. Commas in values need %252C. Document this clearly.
**Phase:** Phase 2 (alarms)

### 8. Alarm v2 write operations don't exist
**Warning sign:** Trying to PUT to /api/v2/alarms/{id} fails
**Prevention:** Read operations use v2 (FIQL), write operations (ack, clear, escalate) use v1. Route correctly per operation.
**Phase:** Phase 2 (alarms)

### 9. Node ID vs foreignSource:foreignId
**Warning sign:** User provides "fs:fid" format and gets 404
**Prevention:** OpenNMS accepts both {numericId} and {foreignSource}:{foreignId} in node paths. Accept both, pass through directly.
**Phase:** Phase 3 (nodes)

### 10. Asset record PUT replaces entire record
**Warning sign:** Updating one asset field clears all others
**Prevention:** GET the current asset record first, merge changes, then PUT the complete record. Never PUT a partial asset record.
**Phase:** Phase 5 (assets)

### 11. Self-signed SSL certificates
**Warning sign:** HTTPS OpenNMS causes certificate errors
**Prevention:** Add optional insecure: true config field using httpsAgent with rejectUnauthorized: false.
**Phase:** Phase 1 (client)

### 14. v1 API returns XML by default
**Warning sign:** Axios parses response as string instead of object; JSON.parse errors
**Prevention:** Always send `Accept: application/json` header on every request. Set as axios default header.
**Phase:** Phase 1 (client)

### 15. Proactive auth required (no 401 challenge)
**Warning sign:** Silent failures or unexpected 403s; no WWW-Authenticate header prompts retry
**Prevention:** Always send Authorization header on every request, not just on 401 retry. OpenNMS does not issue challenges.
**Phase:** Phase 1 (client)

## TypeScript/Build Pitfalls

### 12. ESM vs CJS confusion
**Warning sign:** require is not defined or Cannot use import statement at runtime
**Prevention:** Set "type": "module" in package.json and "module": "NodeNext" in tsconfig. Use .js extensions in imports even in TypeScript source.
**Phase:** Phase 1 (foundation)

### 13. Missing shebang for CLI execution
**Warning sign:** permission denied when running compiled output directly
**Prevention:** Add #!/usr/bin/env node as first line of src/index.ts. Set chmod +x on dist/index.js in build script.
**Phase:** Phase 1 (foundation)

### 16. Stdout pollution (CRITICAL)
**Warning sign:** Claude CLI session crashes or returns garbled responses; MCP protocol breaks
**Prevention:** MCP uses stdio as its transport. ANY write to stdout (console.log, library debug output, unhandled rejections) corrupts the JSON-RPC stream. Use `console.error` only for debug. Set up global unhandledRejection handler that writes to stderr.
**Phase:** Phase 1 (foundation) — must get right from the start
