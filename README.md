# Possession Lab automated forecasting

This repository runs the existing Site's forecast backend. The Site retains its
2,000-game simulation engine, immutable D1 archives, roster/injury inputs, grades,
and model updates. No historical prediction is recreated after tip-off.

## Timing

The production worker checks the due queue every minute between forecast cycles.
It remains active for five hours, then explicitly dispatches its successor before
GitHub's six-hour job limit. Hourly cron at minute 18 is a recovery trigger, not
the clock for individual forecasts. Source pushes first run a two-minute bootstrap
and handoff. A shared concurrency group allows only one production worker.

The Site makes regular forecasts due after 60 minutes, checks injuries in the last
hour, and starts an independent final pass 12 minutes before each scheduled tip.
Each game runs ten sequential 200-game batches. Normally two games run concurrently;
up to six run near tip so simultaneous games can finish before the cutoff. The Site
refuses late writes. The input-check timestamp is distinct from archive completion.
Interrupted inputs expire after 20 minutes, and an unavailable or stale injury feed
causes a retry while keeping the last saved forecast.

Results and roster maintenance run hourly. Cycle failures are logged and retried on
the next check; a failure does not terminate all later checks. Health reports also
include missed final refreshes for games already live, so an empty due queue does
not imply every forecast was timely.

GitHub and ESPN outages can still delay work. Exact start times are not guaranteed.
A successful dispatch means the next run was requested; verify that it actually
started and that forecasts were saved. The production repo is already public and
uses standard Ubuntu runners. No paid hosting service or larger runner is added.

## Operation

- `dry-run` manually reads status without simulations or model changes.
- `full` manually performs one complete update.
- `watch` manually starts a continuous worker and successor chain.
- Cancelling a running worker does not request a successor. Disable the workflow
  to stop its cron trigger and future dispatches as well.
- Tests run before every worker. Use `node --test` locally.
- `.github/workflows/keepalive.yml`, if present, retains its existing repository
  activity maintenance. Do not reactivate the old ChatGPT automation.

The encrypted repository secret `SITE_BYPASS_TOKEN` supplies Site service access.
It is never copied into source, logs, prompts, or successor inputs. Handoff uses
the short-lived repository-scoped `GITHUB_TOKEN` with `actions: write`, not a new
personal access token. The read-only source checkout does not persist credentials.
