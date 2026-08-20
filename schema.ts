import "dotenv/config";
import { graphClient } from "./graphClient.js";

const connectorId = process.env.CONNECTOR_ID!;

// One connection covers every Alation object type (dataSource/schema/table/column/
// glossaryTerm) via the shared `objectType` field, rather than one connection per type.
// Keeps ACL management and Copilot enablement in one place.
async function registerConnection() {
  await graphClient.api("/external/connections").post({
    id: connectorId,
    name: "Alation Data Catalog",
    description: "Alation catalog objects: data sources, schemas, tables, columns, glossary terms.",
    activitySettings: { urlToItemResolvers: [] },
  });
}

async function registerSchema() {
  await graphClient.api(`/external/connections/${connectorId}/schema`).patch({
    baseType: "microsoft.graph.externalItem",
    properties: [
      // Semantic labels are what make Copilot treat these as usable grounding
      // content, not just Microsoft Search hits — don't skip them.
      { name: "title", type: "string", isSearchable: true, isRetrievable: true, labels: ["title"] },
      { name: "description", type: "string", isSearchable: true, isRetrievable: true },
      { name: "alationUrl", type: "string", isRetrievable: true, labels: ["url"] },
      { name: "iconUrl", type: "string", isRetrievable: true, labels: ["iconUrl"] },
      { name: "lastModified", type: "dateTime", isRetrievable: true, isQueryable: true, labels: ["lastModifiedDateTime"] },

      // Alation-specific facets — queryable/refinable so results can be filtered
      // by catalog structure inside Microsoft Search.
      { name: "objectType", type: "string", isQueryable: true, isRetrievable: true, isRefinable: true },
      { name: "dataSourceName", type: "string", isQueryable: true, isRetrievable: true, isRefinable: true },
      { name: "schemaName", type: "string", isQueryable: true, isRetrievable: true },
      { name: "tableName", type: "string", isQueryable: true, isRetrievable: true },
      { name: "columnDataType", type: "string", isRetrievable: true },
      { name: "steward", type: "string", isQueryable: true, isRetrievable: true },
      { name: "tags", type: "stringCollection", isQueryable: true, isRetrievable: true, isRefinable: true },
    ],
  });
}

async function main() {
  await registerConnection();
  console.log(`Connection "${connectorId}" registered.`);

  await registerSchema();
  console.log("Schema submitted — provisioning can take up to ~15 min before items can be pushed.");
}

main().catch((err) => {
  console.error("Schema registration failed:", err);
  process.exit(1);
});
