import "dotenv/config";

const BASE_URL = process.env.ALATION_BASE_URL!;
const API_TOKEN = process.env.ALATION_API_TOKEN!;

export type AlationObjectType = "data_source" | "schema" | "table" | "column" | "glossary_term";

export interface AlationObject {
  id: number;
  title: string;
  description?: string;
  url: string;
  updated_ts: string; // ISO timestamp — used for delta sync
  data_source_name?: string;
  schema_name?: string;
  table_name?: string;
  data_type?: string;
  steward?: string;
  tags?: string[];
}

// NOTE: endpoint paths and pagination shape are for Alation's v2 integration API —
// verify against your instance's Alation version, this has shifted across major
// releases (README calls this out too).
async function fetchPage(
  objectType: AlationObjectType,
  limit: number,
  skip: number,
  updatedSince?: string
): Promise<AlationObject[]> {
  const params = new URLSearchParams({ limit: String(limit), skip: String(skip) });
  if (updatedSince) params.set("updated_ts__gt", updatedSince);

  const res = await fetch(`${BASE_URL}/integration/v2/${objectType}/?${params}`, {
    headers: { Token: API_TOKEN, Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Alation fetch failed for ${objectType} (skip=${skip}): ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Walks pagination until a page comes back short of `pageSize`, meaning it's the last one.
export async function fetchAllObjects(
  objectType: AlationObjectType,
  updatedSince?: string,
  pageSize = 200
): Promise<AlationObject[]> {
  const all: AlationObject[] = [];
  let skip = 0;

  while (true) {
    const page = await fetchPage(objectType, pageSize, skip, updatedSince);
    all.push(...page);
    if (page.length < pageSize) break;
    skip += pageSize;
  }

  return all;
}
