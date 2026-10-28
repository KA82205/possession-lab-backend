import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, runCycle } from './scheduler.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

test('saves ten 200-game batches per game and verifies no due games remain', async () => {
  const calls = [];
  let dueReads = 0;
  const gameIds = ['401800011', '401800012'];
  const fetchImpl = async (_url, init) => {
    assert.equal(init.headers['OAI-Sites-Authorization'], 'Bearer placeholder');
    const request = JSON.parse(init.body);
    calls.push(request);
    if (request.action === 'refresh_results') return json({ newGames: ['401800010'], modelThrough: '2026-10-27' });
    if (request.action === 'due_games') return json({ day: '2026-10-28', savedGames: 0,
      due: dueReads++ ? [] : gameIds.map(game_id => ({ game_id })) });
    if (request.action === 'archive_forecast_batch') return json({ gameId: request.game_id, saved: true });
    if (request.action === 'finalize_forecast_batches') return json({ gameId: request.game_id, capturedAt: '2026-10-28T12:00:00Z' });
    if (request.action === 'health') return json({ status: 'healthy' });
    throw new Error('unexpected action');
  };
  const result = await runCycle({ siteOrigin: 'https://example.com', token: 'placeholder', fetchImpl, log() {} });
  assert.deepEqual(result, { day: '2026-10-28', archived: 2, failed: 0, outstanding: 0 });
  assert.equal(calls.filter(call => call.action === 'archive_forecast_batch').length, 20);
  assert.equal(calls.filter(call => call.action === 'finalize_forecast_batches').length, 2);
  for (const id of gameIds) {
    const sequence = calls.filter(call => call.game_id === id).map(call => `${call.action}:${call.batch ?? ''}`);
    assert.deepEqual(sequence, Array.from({length:10},(_,i) => `archive_forecast_batch:${i}`).concat('finalize_forecast_batches:'));
  }
});

test('retries transient 429 without exposing token in errors', async () => {
  let count = 0;
  const client = makeClient({ siteOrigin: 'https://example.com', token: 'secret', wait: async () => {},
    fetchImpl: async () => ++count < 3 ? json({ error: 'rate limit' }, 429) : json({ due: [] }),
  });
  assert.deepEqual(await client('due_games'), { due: [] });
  assert.equal(count, 3);
});

test('never retries authorization failures', async () => {
  let count = 0;
  const client = makeClient({ siteOrigin: 'https://example.com', token: 'secret', wait: async () => {},
    fetchImpl: async () => { count++; return json({ error: 'not authorized' }, 401); },
  });
  await assert.rejects(client('due_games'), /HTTP 401/);
  assert.equal(count, 1);
});

test('rejects insecure Site endpoints', () => {
  assert.throws(() => makeClient({ siteOrigin: 'http://example.com', token: 'secret' }), /HTTPS/);
});

test('dry run checks status without starting a simulation or learning update', async () => {
  const actions = [];
  const fetchImpl = async (_url, init) => {
    const { action } = JSON.parse(init.body);
    actions.push(action);
    if (action === 'due_games') return json({ day: '2026-10-28', scheduled: 12, savedGames: 11, due: [{ game_id: '401800011' }] });
    if (action === 'health') return json({ status: 'healthy' });
    throw new Error('unwanted write');
  };
  assert.deepEqual(await runCycle({ siteOrigin: 'https://example.com', token: 'secret', dryRun: true, fetchImpl, log() {} }),
    { dryRun: true, due: 1, day: '2026-10-28' });
  assert.deepEqual(actions, ['due_games', 'health']);
});

test('a missing archived game fails the scheduled run', async () => {
  const fetchImpl = async (_url, init) => {
    const { action, game_id } = JSON.parse(init.body);
    if (action === 'refresh_results') return json({ newGames: [] });
    if (action === 'due_games') return json({ day: '2026-10-28', due: [{ game_id: '401800011' }] });
    if (action === 'archive_forecast_batch') return json({ gameId: game_id });
    if (action === 'finalize_forecast_batches') return json({ gameId: game_id, capturedAt: '2026-10-28T12:00:00Z' });
    if (action === 'health') return json({ status: 'healthy' });
  };
  await assert.rejects(runCycle({ siteOrigin: 'https://example.com', token: 'secret', fetchImpl, log() {} }), /Unfinished due forecasts/);
});
