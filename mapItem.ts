import type { AlationObject, AlationObjectType } from "./alationClient.js";

interface GraphAcl {
  type: "user" | "group" | "everyone";
  value: string;
  accessType: "grant";
}

interface ExternalItem {
  id: string;
  content: { value: string; type: "text" };
  acl: GraphAcl[];
  properties: Record<string, unknown>;
}

// TODO: replace with a real Alation-steward → AAD-security-group lookup (e.g. a
// small table synced from AAD group membership, or a Graph /groups lookup by mail
// nickname). This is the piece your governance review will want to see before
// anything goes wide — do not ship with everyone falling through to the default.
const STEWARD_TO_AAD_GROUP: Record<string, string> = {
  // "jane.doe@terracon.com": "00000000-0000-0000-0000-000000000000",
};

function resolveAcl(steward?: string): GraphAcl[] {
  const groupId = steward ? STEWARD_TO_AAD_GROUP[steward] : undefined;
  const fallback = process.env.DEFAULT_FALLBACK_GROUP_ID;

  if (groupId) return [{ type: "group", value: groupId, accessType: "grant" }];
  if (fallback) return [{ type: "group", value: fallback, accessType: "grant" }];

  // No mapping and no fallback configured — deny by omission rather than guess wrong.
  // An item pushed with an empty ACL is simply invisible, which is the safe failure mode.
  return [];
}

// Keeps `content` short (a human-readable summary) and pushes structured facts into
// `properties` instead — Graph connector items have a hard content-size ceiling, and
// stuffing lineage/metadata into content wastes it without helping retrieval.
export function mapToExternalItem(objectType: AlationObjectType, obj: AlationObject): ExternalItem {
  const contentSummary = [obj.title, obj.description].filter(Boolean).join(" — ").slice(0, 2000);

  return {
    id: `${objectType}-${obj.id}`,
    content: { value: contentSummary || obj.title, type: "text" },
    acl: resolveAcl(obj.steward),
    properties: {
      title: obj.title,
      description: obj.description ?? "",
      alationUrl: obj.url,
      iconUrl: iconForType(objectType),
      lastModified: obj.updated_ts,
      objectType,
      dataSourceName: obj.data_source_name ?? "",
      schemaName: obj.schema_name ?? "",
      tableName: obj.table_name ?? "",
      columnDataType: obj.data_type ?? "",
      steward: obj.steward ?? "",
      tags: obj.tags ?? [],
    },
  };
}

function iconForType(objectType: AlationObjectType): string {
  // Swap for real hosted icon URLs (must be publicly reachable by Graph) before go-live.
  const icons: Record<AlationObjectType, string> = {
    data_source: "https://cdn.example.com/icons/data-source.png",
    schema: "https://cdn.example.com/icons/schema.png",
    table: "https://cdn.example.com/icons/table.png",
    column: "https://cdn.example.com/icons/column.png",
    glossary_term: "https://cdn.example.com/icons/glossary.png",
  };
  return icons[objectType];
}
