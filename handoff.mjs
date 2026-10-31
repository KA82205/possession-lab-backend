import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function handoff({
  token = process.env.GH_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  fetchImpl = fetch,
  wait = ms => new Promise(done => setTimeout(done, ms)),
  log = console.log,
} = {}) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || ''))
    throw new Error('GitHub handoff credentials or repository are missing');
  const url = `https://api.github.com/repos/${repository}/actions/workflows/manual-check.yml/dispatches`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main', inputs: { mode: 'watch' } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 204) {
      log('[possession-lab] successor requested; cron remains a recovery trigger');
      return { dispatched: true };
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2)
      throw new Error(`Worker handoff returned HTTP ${response.status}`);
    await wait(5000 * (attempt + 1));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  handoff().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
