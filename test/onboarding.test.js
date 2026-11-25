import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOnboarding } from '../src/onboarding.js';
import { createStore } from '../src/store.js';

test('failed welcomes retry after restart and preserve the nonce and join record', async t => {
  const dir = mkdtempSync(join(tmpdir(),'mara-onboarding-'));
  const path = join(dir,'test.sqlite');
  let store = createStore(path), time = 100, fail = true;
  t.after(() => { store.close(); rmSync(dir,{recursive:true}); });
  const messages = [];
  const guild = { id:'g', members:{ async fetch({force}) { assert.equal(force,true); return member; } } };
  const member = { id:'u', joinedTimestamp:time, guild };
  const env = { GUILD_ID:'g', WELCOME_CHANNEL_ID:'welcome' };
  const client = { isReady:()=>true, guilds:{fetch:async()=>guild} };
  const fetchChannel = async (_,id) => id;
  const welcome = async (channel,recipient,_,options) => {
    assert.equal(channel,'welcome');
    assert.equal(recipient.id,'u');
    messages.push(options);
    if (fail) throw Error('Missing Send Messages');
  };
  const worker = () => createOnboarding({store,env,client,fetchChannel,welcome,now:()=>time});
  worker().join(member);
  await worker().flush();
  assert.equal(store.onboarding('g','u').welcomed_at,null);
  assert.equal(store.onboarding('g','u').attempts,1);
  store.close();
  store = createStore(path);
  fail = false;
  await worker().flush();
  assert.equal(messages.length,1);
  time += 15000;
  const restarted = worker();
  await Promise.all([restarted.flush(),restarted.flush()]);
  assert.equal(store.onboarding('g','u').welcomed_at,time);
  assert.deepEqual(messages,[messages[0],messages[0]]);
  assert.equal(messages[0].enforceNonce,true);
  restarted.join(member);
  await restarted.flush();
  assert.equal(messages.length,2);
});

test('a departed membership is skipped and a rejoin queues a new welcome', async t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  let time = 100, exists = false, sent = 0;
  const guild = {
    id:'g', members:{ async fetch() {
      if (!exists) throw Object.assign(Error('Unknown Member'),{code:10007});
      return member;
    } }
  };
  const member = { id:'u', joinedTimestamp:time, guild };
  const onboarding = createOnboarding({
    store, env:{GUILD_ID:'g',WELCOME_CHANNEL_ID:'welcome'}, now:()=>time,
    client:{isReady:()=>true,guilds:{fetch:async()=>guild}},
    fetchChannel:async()=>null, welcome:async()=>{sent++;}
  });
  onboarding.join(member);
  await onboarding.flush();
  assert.equal(sent,0);
  assert.equal(store.onboarding('g','u').left_at,time);
  const old = { ...member };
  member.joinedTimestamp = ++time;
  exists = true;
  onboarding.join(member);
  onboarding.leave(old);
  await onboarding.flush();
  assert.equal(sent,1);
  assert.equal(store.onboarding('g','u').joined_at,time);
  assert.equal(store.onboarding('g','u').left_at,null);
});
