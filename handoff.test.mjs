import test from 'node:test';
import assert from 'node:assert/strict';
import { handoff } from './handoff.mjs';

test('handoff starts one continuous successor on main without copying site secrets', async () => {
  let called=0;
  const result=await handoff({ token:'placeholder',repository:'KA82205/possession-lab-backend',log(){},
    fetchImpl: async (url,init) => {
      called++;
      assert.match(url,/manual-check.yml\/dispatches$/);
      assert.deepEqual(JSON.parse(init.body),{ref:'main',inputs:{mode:'watch'}});
      return new Response(null,{status:204});
    }});
  assert.equal(called,1);
  assert.deepEqual(result,{dispatched:true});
});

test('authorization failure stops handoff, while transient failures retry', async () => {
  let attempts=0;
  const base={token:'hidden',repository:'KA82205/possession-lab-backend',log(){},wait:async()=>{}};
  await assert.rejects(handoff({...base,fetchImpl:async()=>new Response(null,{status:403})}),/HTTP 403/);
  await handoff({...base,fetchImpl:async()=>new Response(null,{status:++attempts===1?503:204})});
  assert.equal(attempts,2);
});
