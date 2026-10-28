# Possession Lab automated forecasting

This private GitHub Actions workflow invokes the **existing** Possession Lab website's
forecasting backend. It does not replicate the simulation engine or move the
historical record. The Site's D1 database stays authoritative.

## Schedule

GitHub Actions is planned to run `node scheduler.mjs` on a recurring UTC schedule.
Each full run:

1. Fetches official final scores and box scores, updating slow-moving team and player strengths.
2. Reads the Site's due-game queue. This considers forecasts already archived, planned refreshes, injury-sensitive late passes, and tip-off times in Eastern Time.
3. Runs four persisted 500-game batches for each due matchup (2,000 simulated games total), two different games concurrently, then finalizes the pre-tip forecast in D1.
4. Rechecks the due queue and operational health, exits nonzero if a due game remains, and leaves the failure visible in GitHub Actions logs.

Snapshots are written by the Site only before tip-off. There is **no** after-tip catch-up or retrospective grading exception in this scheduler. A late final stays attached to its original Eastern tip-off date.

## GitHub Actions configuration

The workflow is initially **manual-only** so it cannot consume minutes or
touch forecasts before its secret and $0 spending budget have been verified.
Manual runs default to read-only (`DRY_RUN=1`). Enable the schedule only after
those checks pass.

1. In repository Settings → Secrets and variables → Actions, store the current
   Site service-access bearer token as a **repository secret** named
   `SITE_BYPASS_TOKEN`. Do not add it as a variable or checked-in file.
2. Set the GitHub Actions budget to $0 and configure it to **stop usage** when
   the budget is reached. Private GitHub Free repositories have a monthly
   included-minutes allowance, not unlimited time.
3. Trigger the read-only workflow manually. It must read the due game queue
   and backend health without returning HTTP 401 or 403.
4. Then enable the recurring schedule. At the planned 30-minute cadence,
   monitor monthly minutes and adjust if actual 2,000-game simulations would
   exceed the included allowance. GitHub does not guarantee exact schedule
   start times, so the Site's existing pre-tip check remains authoritative.

The bypass token is a privileged credential. Never add it to Git, logs, tickets,
README files, or screenshots. Rotate the Site token and update GitHub Actions if it is
ever disclosed. Keep the website private. Site authentication must continue
accepting the `OAI-Sites-Authorization` header on `/api/tasks`.

## Safe cutover

1. Trigger the GitHub Actions workflow manually and verify its logs.
2. Confirm a saved forecast and model health through the Site's Record page and D1 storage.
3. Only then disable the old ChatGPT hourly automation, to prevent duplicate runs and unnecessary compute.
4. Watch the first two scheduled GitHub runs, including a game near tip-off.

Historical forecasts, live scores, model code and website pages require no migration.
Run `npm test` for scheduler unit tests. A Git push will automatically redeploy
future workflow code to GitHub Actions once the schedule is enabled.
