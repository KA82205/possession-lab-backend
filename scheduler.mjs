import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const RETRY_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const BATCH_COUNT = 10;
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

function endpoint(origin) {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:') throw new Error('SITE_ORIGIN must use HTTPS');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('SITE_ORIGIN must be the Site root URL');
  return new URL('/api/tasks', parsed).toString();
}

export function makeClient({ siteOrigin, token, fetchImpl = fetch, wait = sleep, timeoutMs = 180_000 }) {
  if (!token || typeof token !== 'string') throw new Error('SITE_BYPASS_TOKEN is required');
  const url = endpoint(siteOrigin);
  return async (action, fields = {}) => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'OAI-Sites-Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ action, ...fields }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`Site action ${action} returned HTTP ${response.status}`);
          if (!RETRY_CODES.has(response.status)) throw Object.assign(error, { permanent: true });
          lastError = error;
        } else {
          const data = await response.json();
          if (data && typeof data === 'object' && 'error' in data)
            throw Object.assign(new Error(`Site action ${action} failed: ${String(data.error).slice(0,240)}`), { permanent: true });
          return data;
        }
      } catch (error) {
        lastError = error;
        if (error?.permanent) throw error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < 2) await wait((attempt + 1) * 1500);
    }
    throw lastError;
  };
}

function gameId(item) {
  const value = item?.game_id ?? item?.id;
  if (typeof value !== 'string' || !/^\d{5,20}$/.test(value))
    throw new Error('Due game has an invalid ESPN game ID');
  return value;
}

async function runGame(client, game, log) {
  const id = gameId(game);
  if (game.date && Date.parse(game.date) - Date.now() < 240_000)
    throw new Error(`Game ${id} is too close to tip-off; keeping its existing archive`);
  for (let batch = 0; batch < BATCH_COUNT; batch++) {
    const result = await client('archive_forecast_batch', { game_id: id, batch });
    if (result?.gameId && String(result.gameId) !== id)
      throw new Error(`Batch ${batch} returned a different game ID`);
    log(`game=${id} batch=${batch + 1}/${BATCH_COUNT} saved`);
  }
  const result = await client('finalize_forecast_batches', { game_id: id });
  if (result?.gameId && String(result.gameId) !== id)
    throw new Error('Finalized response returned a different game ID');
  if (!result?.capturedAt && !result?.alreadySaved)
    throw new Error(`Game ${id} did not confirm a saved forecast`);
  log(`game=${id} archived at=${result.capturedAt || 'previously saved'}`);
  return id;
}

async function pool(items, concurrency, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { ok: true, result: await work(items[index]) }; }
      catch (error) { results[index] = { ok: false, error: String(error) }; }
    }
  }));
  return results;
}

export async function runCycle({
  siteOrigin = process.env.SITE_ORIGIN,
  token = process.env.SITE_BYPASS_TOKEN,
  dryRun = process.env.DRY_RUN === '1',
  fetchImpl = fetch,
  wait = sleep,
  log = message => console.log(`[possession-lab] ${message}`),
  timeoutMs = 180_000,
  refreshResults = true,
} = {}) {
  const client = makeClient({ siteOrigin, token, fetchImpl, wait, timeoutMs });
  const started = new Date();
  log(`started=${started.toISOString()}`);

  if (dryRun) {
    const queue = await client('due_games');
    const health = await client('health');
    if (!Array.isArray(queue?.due)) throw new Error('Invalid due_games response');
    log(`DRY_RUN day=${queue.day} scheduled=${queue.scheduled} saved=${queue.savedGames} due=${queue.due.length} health=${health?.status}`);
    return { dryRun: true, due: queue.due.length, day: queue.day };
  }

  // The Site remains the source of truth for D1, injury assumptions, grades,
  // updated team/player strengths, and immutable before-tip snapshots.
  try {
    const updated = refreshResults ? await client('refresh_results') : null;
    if (updated) log(`results refreshed new=${updated?.newGames?.length ?? 0} modelThrough=${updated?.modelThrough ?? 'unknown'}`);
  } catch (error) {
    // Temporary ESPN failure must not suppress forecasts using existing data.
    log(`results refresh warning=${String(error)}`);
  }

  const before = await client('due_games');
  if (!Array.isArray(before?.due)) throw new Error('Invalid due_games response');
  const ids = new Set();
  const allDue = before.due.filter(item => {
    const id = gameId(item);
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
  log(`day=${before.day} saved=${before.savedGames ?? 'unknown'} due=${allDue.length}`);

  // Different games may run concurrently; a game's ten batches must be
  // sequential so its first batch freezes the inputs used by the rest.
  // Each batch uses its own Worker request. Give simultaneous final deadlines
  // enough independent slots to finish before the site's strict tip-off cutoff.
  const concurrency = allDue.some(game => game.minutesToTip <= 15) ? 6 : 2;
  // Finish one group, then reread deadlines. A long early-evening queue must
  // not hide a final pass that becomes due while other games are simulated.
  const due = allDue.slice(0, concurrency);
  const results = await pool(due, concurrency, item => runGame(client, item, log));
  const failures = [];
  for (let i = 0; i < results.length; i++) {
    if (!results[i].ok) {
      failures.push({ game: gameId(due[i]), error: results[i].error });
      log(`failed game=${gameId(due[i])} reason=${results[i].error}`);
    }
  }

  const after = await client('due_games');
  if (!Array.isArray(after?.due)) throw new Error('Invalid follow-up due_games response');
  const outstanding = after.due.map(gameId);
  let health = null;
  try { health = await client('health'); }
  catch (error) { log(`health warning=${String(error)}`); }

  log(`finished=${new Date().toISOString()} archived=${results.length - failures.length} failed=${failures.length} outstanding=${outstanding.length} health=${health?.status ?? 'unavailable'}`);
  const selected = new Set(due.map(gameId));
  if (failures.length || outstanding.some(id => selected.has(id))) {
    const summary = JSON.stringify({ failures, outstanding });
    throw new Error(`Unfinished due forecasts: ${summary}`);
  }
  return { archived: results.length, failed: 0, outstanding: outstanding.length, day: after.day };
}

// Keep an active clock between GitHub launches. Cron is a recovery trigger,
// not the clock for each forecast. Hand off before the six-hour runner limit.
export async function runService({
  durationMs = Number(process.env.RUN_FOR_MINUTES || 300) * 60_000,
  intervalMs = 60_000,
  now = Date.now,
  wait = sleep,
  cycle = runCycle,
  log = message => console.log(`[possession-lab] ${message}`),
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs < 60_000 || durationMs > 330 * 60_000)
    throw new Error('Worker duration must be between 1 and 330 minutes');
  const started = now(), end = started + durationMs;
  let lastRefresh = -Infinity, cycles = 0, failures = 0;
  while (now() < end) {
    const refreshResults = now() - lastRefresh >= 60 * 60_000;
    let pending = false;
    try {
      const result = await cycle({ refreshResults });
      pending = Number(result?.outstanding) > 0;
      if (refreshResults) lastRefresh = now();
    } catch (error) {
      failures++;
      log(`cycle failed; retrying on the next check: ${String(error)}`);
    }
    cycles++;
    const remaining = end - now();
    if (remaining > 0) await wait(Math.min(pending ? 1000 : intervalMs, remaining));
  }
  log(`handoff ready cycles=${cycles} failedCycles=${failures}`);
  return { cycles, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operation = process.env.WATCH === '1' ? runService : runCycle;
  operation().catch(error => {
    console.error(`[possession-lab] scheduler failed: ${String(error)}`);
    process.exitCode = 1;
  });
}

