# Possession Lab automated forecasting

This GitHub Actions workflow invokes the **existing** Possession Lab website's
forecasting backend. It does not replicate the simulation engine or move the
historical record. The Site's D1 database stays authoritative.

## Schedule

GitHub Actions checks the backend at minute `47` of every UTC hour, which
also means minute `47` in Eastern Time. A scheduled check can be delayed
by GitHub, and the Site (not the workflow) decides which games are due.
Each full run:

1. Fetches official final scores and box scores, updating slow-moving team and player strengths.
2. Reads the Site's due-game queue. This considers forecasts already archived, planned refreshes, injury-sensitive late passes, and tip-off times in Eastern Time.
3. Runs four persisted 500-game batches for each due matchup (2,000 simulated games total), two different games concurrently, then finalizes the pre-tip forecast in D1.
4. Rechecks the due queue and operational health, exits nonzero if a due game remains, and leaves the failure visible in GitHub Actions logs.

Snapshots are written by the Site only before tip-off. There is **no** after-tip catch-up or retrospective grading exception in this scheduler. A late final stays attached to its original Eastern tip-off date.

## GitHub Actions configuration

Manual runs default to read-only (`DRY_RUN=1`). An explicit `full` manual run
or the hourly schedule calls the Site updater.

1. In repository Settings → Secrets and variables → Actions, store the current
   Site service-access bearer token as a **repository secret** named
   `SITE_BYPASS_TOKEN`. Do not add it as a variable or checked-in file.
2. Set the GitHub Actions budget to $0 and configure it to **stop usage** when
   the budget is reached. Private GitHub Free repositories have a monthly
   included-minutes allowance, not unlimited time.
3. Trigger the read-only workflow manually. It must read the due game queue
   and backend health without returning HTTP 401 or 403.
4. Check GitHub's monthly minutes periodically. A private repository can exhaust
   its free minutes when several dozen 2,000-game forecasts run each day. At a
   $0 stop-usage budget this stops rather than charging. Standard GitHub Actions
   runners in public repositories have no included-minute quota, but changing a
   repository from private to public requires the owner's explicit consent.
   GitHub does not guarantee exact schedule start times.

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
