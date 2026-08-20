import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { graphClient } from "./graphClient.js";
import { fetchAllObjects, type AlationObjectType } from "./alationClient.js";
import { mapToExternalItem } from "./mapItem.js";

const connectorId = process.env.CONNECTOR_ID!;
const STATE_FILE = "./.sync-state.json";

const OBJECT_TYPES: AlationObjectType[] = ["data_source", "schema", "table", "column", "glossary_term"];

function readLastSyncAt(): string | undefined {
  if (!existsSync(STATE_FILE)) return undefined;
  return JSON.parse(readFileSync(STATE_FILE, "utf8")).lastSyncAt;
}

function writeLastSyncAt(iso: string): void {
  writeFileSync(STATE_FILE, JSON.stringify({ lastSyncAt: iso }, null, 2));
}

// Graph connector ingestion is rate-limited per tenant; retry on 429 with the
// Retry-After header rather than a fixed backoff, since the limit varies by tier.
async function pushItem(itemId: string, body: unknown, attempt = 1): Promise<void> {
  try {
    await graphClient.api(`/external/connections/${connectorId}/items/${itemId}`).patch(body);
  } catch (err: any) {
    if (err?.statusCode === 429 && attempt <= 5) {
      const retryAfterMs = Number(err.headers?.["retry-after"] ?? 2) * 1000;
      await new Promise((r) => setTimeout(r, retryAfterMs));
      return pushItem(itemId, body, attempt + 1);
    }
    throw err;
  }
}

async function ingestObjectType(objectType: AlationObjectType, updatedSince?: string): Promise<string[]> {
  const objects = await fetchAllObjects(objectType, updatedSince);
  const ids: string[] = [];

  for (const obj of objects) {
    const item = mapToExternalItem(objectType, obj);
    await pushItem(item.id, { acl: item.acl, properties: item.properties, content: item.content });
    ids.push(item.id);
  }

  return ids;
}

// Full-crawl-only: diffs the id set we just synced against what was indexed last
// full crawl, and deletes whatever fell out (deleted/moved in Alation). Skipped on
// delta runs since a partial pull would otherwise look like mass deletion.
const INDEX_FILE = "./.indexed-ids.json";

function readLastIndexedIds(): string[] {
  return existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, "utf8")) : [];
}

function writeIndexedIds(ids: string[]): void {
  writeFileSync(INDEX_FILE, JSON.stringify(ids));
}

async function deleteItem(itemId: string, attempt = 1): Promise<void> {
  try {
    await graphClient.api(`/external/connections/${connectorId}/items/${itemId}`).delete();
  } catch (err: any) {
    if (err?.statusCode === 429 && attempt <= 5) {
      const retryAfterMs = Number(err.headers?.["retry-after"] ?? 2) * 1000;
      await new Promise((r) => setTimeout(r, retryAfterMs));
      return deleteItem(itemId, attempt + 1);
    }
    if (err?.statusCode === 404) return; // already gone, fine
    throw err;
  }
}

async function main() {
  const isDelta = process.argv.includes("--delta");
  const updatedSince = isDelta ? readLastSyncAt() : undefined;

  if (isDelta && !updatedSince) {
    console.log("No prior sync state found — running a full crawl instead of delta.");
  }
  const effectiveIsDelta = isDelta && !!updatedSince;

  const syncStartedAt = new Date().toISOString();
  let total = 0;
  const allIds: string[] = [];

  for (const objectType of OBJECT_TYPES) {
    const ids = await ingestObjectType(objectType, updatedSince);
    allIds.push(...ids);
    total += ids.length;
    console.log(`${objectType}: ${ids.length} items synced`);
  }

  if (!effectiveIsDelta) {
    const previousIds = readLastIndexedIds();
    const currentSet = new Set(allIds);
    const stale = previousIds.filter((id) => !currentSet.has(id));

    for (const id of stale) await deleteItem(id);
    if (stale.length) console.log(`Removed ${stale.length} stale item(s) no longer in Alation.`);

    writeIndexedIds(allIds);
  }

  writeLastSyncAt(syncStartedAt);
  console.log(`Done — ${total} items synced total.`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
