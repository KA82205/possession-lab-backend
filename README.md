# Possession Lab automated forecasting

This private Render cron service invokes the **existing** Possession Lab website's
forecasting backend. It does not replicate the simulation engine or move the
historical record. The Site's D1 database stays authoritative.

## Schedule

Render runs `node scheduler.mjs` every 30 minutes, 24/7, in UTC. Each run:

1. Fetches official final scores and box scores, updating slow-moving team and player strengths.
2. Reads the Site's due-game queue. This considers forecasts already archived, planned refreshes, injury-sensitive late passes, and tip-off times in Eastern Time.
3. Runs four persisted 500-game batches for each due matchup (2,000 simulated games total), two different games concurrently, then finalizes the pre-tip forecast in D1.
4. Rechecks the due queue and operational health, exits nonzero if a due game remains, and leaves the failure visible in Render logs.

Snapshots are written by the Site only before tip-off. There is **no** after-tip catch-up or retrospective grading exception in this scheduler. A late final stays attached to its original Eastern tip-off date.

## Render configuration

Create one Cron Job using the private GitHub repository:

- Runtime: Node
- Build command: `npm install --omit=dev`
- Command: `node scheduler.mjs`
- Schedule (UTC): `*/30 * * * *`
- Compute: smallest supported paid cron compute plan
- Environment: `SITE_ORIGIN` set to the private website origin; `SITE_BYPASS_TOKEN` set as a **secret** to the existing owner's Site-access bypass bearer token

The bypass token is a privileged credential. Never add it to Git, logs, tickets,
README files, or screenshots. Rotate the Site token and update Render if it is
ever disclosed. Keep the website private. Site authentication must continue
accepting the `OAI-Sites-Authorization` header on `/api/tasks`.

## Safe cutover

1. Trigger the Render Cron Job manually and verify its logs.
2. Confirm a saved forecast and model health through the Site's Record page and D1 storage.
3. Only then disable the old ChatGPT hourly automation, to prevent duplicate runs and unnecessary compute.
4. Watch the first two scheduled Render runs, including a game near tip-off.

Historical forecasts, live scores, model code and website pages require no migration.
Run `npm test` for scheduler unit tests. A Git push will automatically redeploy
future Render runs once the service is connected to this repository.
