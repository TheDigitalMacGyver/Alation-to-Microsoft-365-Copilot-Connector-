![Uploading Alation-to-Microsoft-365-Copilot-Connector.PNG…]()
# Alation → Copilot Graph Connector

Indexes Alation catalog objects (data sources, schemas, tables, columns, business
glossary terms) into Microsoft Graph as a **Graph Connector**, so they show up as
grounding content in M365 Copilot and Microsoft Search.

## Architecture

```
Alation REST API  →  ingest.ts  →  Microsoft Graph /external/connections/{id}/items
   (catalog objects)   (maps + ACL)         (indexed, ACL-enforced, Copilot-visible)
```

1. **One-time setup** (`src/schema.ts`): register the external connection + item schema
   in Graph. Semantic labels (`title`, `url`, `iconUrl`, `lastModifiedDateTime`) are what
   let Copilot actually use items as grounding, not just Microsoft Search results.
2. **Ingestion** (`src/ingest.ts`): pulls objects from Alation's catalog API, maps each
   to a Graph `externalItem`, resolves an ACL, and pushes via `PATCH` (idempotent upsert).
3. **ACL mapping** (`src/mapItem.ts`): this is the governance-critical part. Alation
   objects carry stewardship/visibility info — don't default to "everyone" unless
   that's an explicit governance decision. Map Alation groups/stewards to AAD security
   groups where possible; fall back to a restricted default group, not public.
4. **Delta sync**: Alation objects expose `updated_ts` (or similar, varies by object
   type). Track `lastSyncAt` in a small state file/table and only pull objects updated
   since then. Run on a schedule (Azure Function timer trigger, or cron if self-hosted).

### Deletion sync

Full crawls (`npm run ingest`, no `--delta`) now track everything indexed in
`.indexed-ids.json` and delete whatever fell out of the latest pull — handles
Alation objects that were deleted, deprecated, or moved. Delta runs skip this
(a partial pull would otherwise look like mass deletion). Run a full crawl
periodically — nightly or weekly — even if delta runs more often intraday.

## Setup

1. **Azure AD app registration**
   - App permissions (application, admin-consented): `ExternalConnection.ReadWrite.OwnedBy`,
     `ExternalItem.ReadWrite.OwnedBy`.
   - Client credentials flow — no user context needed, this runs as a background job.

2. **Alation API token**
   - Generate an Alation API token (Alation admin → API tokens) scoped to a service
     account with read access to the catalog objects you're indexing.

3. **Env vars** — copy `.env.example` to `.env` and fill in:
   - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   - `ALATION_BASE_URL`, `ALATION_API_TOKEN`
   - `CONNECTOR_ID` (alphanumeric, ≤32 chars, no dashes — Graph requirement)

4. **Install + register schema** (once, or whenever the schema changes):
   ```bash
   npm install
   npm run register-schema
   ```
   Schema propagation can take up to ~15 min after creation before you can push items —
   don't run ingest immediately after registering.

5. **Run ingestion**:
   ```bash
   npm run ingest        # full crawl
   npm run ingest -- --delta   # incremental, since lastSyncAt
   ```

6. **Enable for Copilot** (not automatable via API as of today — do this in the admin
   center): Microsoft 365 admin center → Copilot → Agents/Connectors → find your
   connector → toggle it on as a Copilot content source. Registering the connection in
   Graph makes it searchable; this step is what makes it Copilot-grounding.

## Gotchas

- **ACL is deny-by-default.** An item with no ACL is invisible, not public. Get the
  ACL mapping right before wide rollout — this is the part your governance review will
  actually scrutinize.
- **Item content size**: keep `content.value` well under the ~4MB ceiling — for
  table/column objects, that means a trimmed description, not a full lineage dump.
  Push structured metadata as `properties`, not stuffed into `content`.
- **Rate limits**: Graph ingestion throughput is tenant-tier-dependent (roughly
  4–25 items/sec). Batch and backoff on 429s — see `pushItem`'s retry logic.
- **Connector ID is immutable.** Pick it carefully; you can't rename a connection,
  only delete and recreate (which drops all indexed items).
- **Alation pagination**: the catalog API paginates; `alationClient.ts` follows
  `next` links — verify against your Alation version, the pagination shape has
  changed across major releases.
