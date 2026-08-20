# Alation → Copilot Connector: Setup Guide

Follow these steps in order. Some require clicking around in Azure and Alation
admin panels — no way around that part.

## 1. Get the code onto your computer

Download the `alation-copilot-connector` folder. Put it somewhere easy to
find, like your Desktop. Open a terminal (Mac: **Terminal** app; Windows:
**PowerShell**) and type `cd ` followed by dragging the folder into the
terminal window, then hit Enter. You're now "inside" the project.

## 2. Install Node.js (if you don't have it)

Go to [nodejs.org](https://nodejs.org), download the **LTS** version, install
it like any app. Then in your terminal type:

```bash
node -v
```

If it prints a version number like `v20.x`, you're good.

## 3. Install the project's dependencies

Still in the terminal, inside the project folder, run:

```bash
npm install
```

This downloads the code libraries the connector needs (Microsoft Graph
client, Azure auth, etc). Wait for it to finish.

## 4. Register an Azure AD app and get 3 codes

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active
   Directory** → **App registrations** → **New registration**.
2. Name it `Alation Copilot Connector`, click **Register**.
3. Copy the **Application (client) ID** and **Directory (tenant) ID** shown
   on that page — save them somewhere safe.
4. Go to **Certificates & secrets** → **New client secret** → copy the
   secret **value** immediately (it hides forever after you leave the page).
5. Go to **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** → search and add both:
   - `ExternalConnection.ReadWrite.OwnedBy`
   - `ExternalItem.ReadWrite.OwnedBy`
6. Click **Grant admin consent** (you may need an admin to click this).

## 5. Get an Alation API token

Log into your Alation instance as an admin. Go to **Admin Settings** (or the
profile menu) → **API Tokens** (or **Authentication**). Create a new token
for a service account with read access to the catalog. Copy the token
string — this is your `ALATION_API_TOKEN`.

## 6. Fill in the `.env` file

In the project folder, copy `.env.example` and rename the copy to `.env`.
Open it in any text editor and fill in:

```
AZURE_TENANT_ID=<from step 4>
AZURE_CLIENT_ID=<from step 4>
AZURE_CLIENT_SECRET=<from step 4>
ALATION_BASE_URL=https://yourcompany.alationcloud.com
ALATION_API_TOKEN=<from step 5>
CONNECTOR_ID=alationcatalog
```

Save the file.

> ⚠️ **Don't skip this:** `src/mapItem.ts` has an empty
> `STEWARD_TO_AAD_GROUP` mapping. Any item without a mapped steward and no
> `DEFAULT_FALLBACK_GROUP_ID` set in `.env` gets pushed with an **empty
> ACL — invisible in Copilot, not public.** Fill in a real steward → AAD
> group mapping, or at minimum set `DEFAULT_FALLBACK_GROUP_ID`, before
> step 8 — otherwise the sync will "succeed" and nothing will show up.

## 7. Register the schema (one-time setup)

```bash
npm run register-schema
```

This tells Microsoft Graph what kind of data is coming. **Wait about 15
minutes** before the next step — Microsoft needs time to provision it.

## 8. Run the first sync and turn Copilot on

```bash
npm run ingest
```

This pulls everything from Alation and pushes it into Microsoft Graph — may
take a while depending on catalog size. When it's done:

1. Go to the **Microsoft 365 admin center** → **Copilot** → **Connectors**.
2. Find **Alation Data Catalog**.
3. Toggle it **ON**.

This last toggle can't be done from code — someone has to click it by hand.

## Ongoing sync

Once this works, schedule it to run regularly instead of by hand:

```bash
npm run ingest -- --delta   # incremental — run often (e.g. hourly)
npm run ingest               # full crawl — run at least weekly, catches deletions
```

Use a cron job, Azure Function timer trigger, or Task Scheduler — whatever
fits how the rest of your infrastructure runs scheduled jobs.
