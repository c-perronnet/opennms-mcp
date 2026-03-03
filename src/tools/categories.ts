import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, buildErrorMessage } from "../client.js";
import { OpenNMSConfig } from "../config.js";

// CategoryDTO derived from OnmsCategory.java @XmlAttribute/@XmlElement annotations
// Array key is "category" (singular) — @JsonProperty("category") in OnmsCategoryCollection.java
interface CategoryDTO {
  id?: number;           // @XmlAttribute(name="id")
  name?: string;         // @XmlAttribute(name="name")
  description?: string;  // @XmlElement(name="description")
}

interface CategoryListResponse {
  category: CategoryDTO[]; // @JsonProperty("category") — singular key confirmed from OnmsCategoryCollection.java
}

export function registerCategoryTools(
  server: McpServer,
  client: ApiClient,
  _config: OpenNMSConfig,
): void {

  // CAT-01: List all categories defined in OpenNMS (global list, not node-specific)
  // API: GET /opennms/rest/categories — v1 CategoryRestService.listCategories()
  // Response: { category: CategoryDTO[] } — array key "category" (singular)
  // Note: v1 endpoint returns 200 with empty list (not 204) when no categories exist.
  // Guard with ?? [] to handle both empty array and undefined gracefully.
  server.tool(
    "list_categories",
    "List all categories defined in OpenNMS. Returns each category's ID, name, and description. Use this to find available category names before assigning them to nodes.",
    {},
    async () => {
      try {
        const resp = await client.v1.get("/categories");
        // v1 typically returns 200 with empty list (not 204); guard with ?? [] for safety
        const categories = (resp.data?.category ?? []) as CategoryDTO[];

        if (categories.length === 0) {
          return {
            content: [{ type: "text", text: "No categories defined in OpenNMS." }],
          };
        }

        const lines = categories.map((c) =>
          `ID: ${c.id ?? "?"}  Name: ${c.name ?? "unnamed"}${c.description ? `  Description: ${c.description}` : ""}`
        );
        const text = [`Categories: ${categories.length} total`, "", ...lines].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, "list categories") }],
          isError: true,
        };
      }
    }
  );

  // CAT-02: List categories assigned to a specific node
  // API: GET /opennms/rest/nodes/{nodeCriteria}/categories — v1 sub-resource
  // Source: NodeRestService.getCategoriesForNode() — same m_nodeDao.get(nodeCriteria) resolution
  // Accepts numeric ID or foreignSource:foreignId (v1 handles both transparently)
  // Response: same OnmsCategoryCollection envelope with "category" singular array key
  server.tool(
    "get_node_categories",
    "List the categories assigned to a specific OpenNMS node. Accepts numeric node ID or 'foreignSource:foreignId' format. Returns category names and descriptions.",
    {
      id: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
    },
    async ({ id }) => {
      try {
        const resp = await client.v1.get(`/nodes/${id}/categories`);
        const categories = (resp.data?.category ?? []) as CategoryDTO[];

        if (categories.length === 0) {
          return {
            content: [{ type: "text", text: `No categories assigned to node ${id}.` }],
          };
        }

        const lines = categories.map((c) =>
          `${c.name ?? "unnamed"}${c.description ? ` — ${c.description}` : ""}`
        );
        const text = [`Categories for node ${id}: ${categories.length}`, "", ...lines].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, `categories for node ${id}`) }],
          isError: true,
        };
      }
    }
  );

  // CAT-03: Assign a category to a node
  // API: POST /opennms/rest/nodes/{nodeCriteria}/categories/{categoryName} — v1
  // CRITICAL: Use POST not PUT.
  //   @POST @Path("/{nodeCriteria}/categories/{categoryName}") in NodeRestService.java
  //   Returns 201 Created on success.
  //   Returns 400 Bad Request if category does not exist OR is already assigned.
  //   Using PUT instead would hit @PUT which updates category fields (name/description),
  //   NOT the node membership — wrong behavior, no HTTP error, silently does the wrong thing.
  // Category name in URL path: use encodeURIComponent() for spaces and special characters.
  //   JAX-RS @PathParam auto-decodes the URL-encoded value. Encoding prevents 404 for names with spaces.
  server.tool(
    "add_category_to_node",
    "Assign an existing category to an OpenNMS node. The category must already exist in OpenNMS — use list_categories to see available categories. Returns an error if the category does not exist or is already assigned to the node.",
    {
      nodeId: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
      categoryName: z.string().describe(
        "Name of the category to assign (e.g. 'Routers', 'Production'). The category must already exist in OpenNMS."
      ),
    },
    async ({ nodeId, categoryName }) => {
      try {
        // POST (NOT PUT) — NodeRestService @POST @Path("/{nodeCriteria}/categories/{categoryName}")
        // encodeURIComponent handles spaces and special characters in category names.
        // No request body needed. Returns 201 Created — no resp.data to parse.
        await client.v1.post(`/nodes/${nodeId}/categories/${encodeURIComponent(categoryName)}`);

        return {
          content: [{ type: "text", text: `Category '${categoryName}' assigned to node ${nodeId}.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, `add category '${categoryName}' to node ${nodeId}`) }],
          isError: true,
        };
      }
    }
  );

  // CAT-04: Remove a category from a node
  // API: DELETE /opennms/rest/nodes/{nodeCriteria}/categories/{categoryName} — v1
  // Source: NodeRestService @DELETE @Path("/{nodeCriteria}/categories/{categoryName}")
  // Returns 204 No Content on success; 400 Bad Request if not assigned.
  // encodeURIComponent required for category names with spaces/special chars.
  server.tool(
    "remove_category_from_node",
    "Remove a category from an OpenNMS node. Returns an error if the category is not currently assigned to the node.",
    {
      nodeId: z.string().describe(
        "Node identifier: numeric ID (e.g. '42') or foreignSource:foreignId format (e.g. 'MySource:server-001')."
      ),
      categoryName: z.string().describe(
        "Name of the category to remove (e.g. 'Routers'). Must currently be assigned to the node."
      ),
    },
    async ({ nodeId, categoryName }) => {
      try {
        // DELETE — NodeRestService @DELETE @Path("/{nodeCriteria}/categories/{categoryName}")
        // Returns 204 No Content — do NOT access resp.data
        await client.v1.delete(`/nodes/${nodeId}/categories/${encodeURIComponent(categoryName)}`);

        return {
          content: [{ type: "text", text: `Category '${categoryName}' removed from node ${nodeId}.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: buildErrorMessage(err, `remove category '${categoryName}' from node ${nodeId}`) }],
          isError: true,
        };
      }
    }
  );

}
