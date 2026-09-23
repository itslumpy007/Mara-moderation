import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomod, defaults } from '../src/automod.js';
import { createAI } from '../src/ai.js';

function fixture(config = {}) {
  const logs = [], deleted = [], reviews = [];
  let time = 100000;
  const handler = createAutomod({
    store: { get: () => ({ ...defaults, enabled:true, ...config }) },
    env: { GUILD_ID:'guild', LOG_CHANNEL_ID:'logs', STAFF_ROLE_ID:'staff' },
    audit: async (_,text) => logs.push(text), now: () => time,
    ai: { canReview:id => id === 'public', review:async text => { reviews.push(text); return { flagged:true, categories:{harassment:true} }; } }
  });
  const message = (overrides = {}) => ({
    id:'message', guild:{id:'guild',ownerId:'owner'}, author:{id:'user',bot:false},
    member:{id:'user',permissions:{has:()=>false},roles:{cache:new Set()}},
    content:'hello', channelId:'public', url:'https://discord.com/channels/guild/public/message',
    mentions:{everyone:false,users:new Map(),roles:new Map()}, delete:async()=>deleted.push(true), ...overrides
  });
  return { handler, message, logs, deleted, reviews, advance:ms=>{time+=ms;} };
}

test('automod is disabled by default and excludes bots, staff, webhooks and other servers',async()=>{
  assert.equal(defaults.enabled,false);
  for (const overrides of [{author:{bot:true}}, {webhookId:'hook'}, {guild:{id:'elsewhere'}}, {channelId:'logs'}, {member:{id:'owner'}}, {member:{id:'staff',permissions:{has:()=>true}}}]) {
    const f=fixture({blockedWords:['hello'],action:'delete'});
    await f.handler(f.message(overrides));
    assert.equal(f.logs.length+f.deleted.length+f.reviews.length,0);
  }
  const f=fixture({enabled:false}); await f.handler(f.message()); assert.equal(f.reviews.length,0);
});

test('local rules support log/delete, normalized phrases, invites and mass mentions',async()=>{
  for (const [config,overrides,reason] of [
    [{blockedWords:['spam']},{content:'S\u200bPAM'},'blocked word'],
    [{blockInvites:true},{content:'https://discord.gg/test'},'Discord invite'],
    [{},{mentions:{everyone:true,users:new Map(),roles:new Map()}},'mass mentions']
  ]) {
    for (const action of ['log','delete']) {
      const f=fixture({...config,action}); await f.handler(f.message(overrides));
      assert.match(f.logs[0],new RegExp(reason)); assert.equal(f.deleted.length,action==='delete'?1:0); assert.equal(f.reviews.length,0);
    }
  }
});

test('flood counts across channels, expires after 10s, and edits do not increase count',async()=>{
  const f=fixture({spamLimit:3});
  await f.handler(f.message({channelId:'one'}));
  await f.handler(f.message({channelId:'two'}));
  await f.handler(f.message({channelId:'two'}),{edited:true});
  assert.equal(f.logs.length,0);
  await f.handler(f.message({channelId:'three'})); assert.match(f.logs[0],/flood/);
  f.advance(10001); await f.handler(f.message({channelId:'one'})); assert.equal(f.logs.length,1);
});

test('edits enforce phrases and deletion failures are reported accurately',async()=>{
  const f=fixture({blockedWords:['blocked'],action:'delete'});
  await f.handler(f.message({content:'blocked',delete:async()=>{throw Error('denied');}}),{edited:true});
  assert.match(f.logs[0],/deletion failed/);
});

test('AI flags are advisory even in delete mode and restricted to selected channels',async()=>{
  const f=fixture({action:'delete'}); await f.handler(f.message());
  assert.equal(f.reviews.length,1); assert.equal(f.deleted.length,0); assert.match(f.logs[0],/staff decision required/);
  await f.handler(f.message({channelId:'private'})); assert.equal(f.reviews.length,1);
});

test('AI disabled mode makes no requests and does not scan unlisted channels',async()=>{
  let called=false;
  const ai=createAI({}, {fetchImpl:async()=>{called=true;}});
  await assert.rejects(ai.review('text'),/disabled/); assert.equal(called,false);
  assert.equal(ai.canReview('public'),false);
  const enabled=createAI({AI_ENABLED:'true',OPENAI_API_KEY:'test',AI_CHANNEL_IDS:'public'});
  assert.equal(enabled.canReview('public'),true); assert.equal(enabled.canReview('private'),false);
});

test('AI requests use bounded inputs, no stored summaries, and parse Responses output',async()=>{
  const requests=[];
  const ai=createAI({AI_ENABLED:'true',OPENAI_API_KEY:'test',AI_MODEL:'configured-model'}, {fetchImpl:async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return {ok:true,json:async()=>url.endsWith('moderations')?{results:[{flagged:false,categories:{}}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Review draft'}]}]}};
  }});
  await ai.review('a'.repeat(5000)); assert.equal(requests[0].body.input.length,4000);
  assert.equal(await ai.summarize('report'),'Review draft');
  assert.equal(requests[1].body.store,false); assert.equal(requests[1].body.model,'configured-model');
  assert.match(requests[1].body.instructions,/untrusted data/);
});

test('AI rejects service errors, malformed responses and excess requests',async()=>{
  const env={AI_ENABLED:'true',OPENAI_API_KEY:'test'};
  await assert.rejects(createAI(env,{fetchImpl:async()=>({ok:false})}).review('text'),/failed/);
  await assert.rejects(createAI(env,{fetchImpl:async()=>({ok:true,json:async()=>({})})}).review('text'),/Invalid/);
  let time=1000;
  const ai=createAI(env,{now:()=>time,fetchImpl:async()=>({ok:true,json:async()=>({results:[{flagged:false,categories:{}}]})})});
  for(let i=0;i<20;i++) await ai.review('text');
  await assert.rejects(ai.review('text'),/busy/);
  time+=60000; await ai.review('text');
});

test('AI all-channel opt-in preserves disabled and blank scope behavior',()=>{
 const env={AI_ENABLED:'true',OPENAI_API_KEY:'test'};
 for(const scope of ['all',' ALL ','public,all']) {
 const ai=createAI({...env,AI_CHANNEL_IDS:scope});
 assert.equal(ai.canReview('new-channel'),true);
 assert.equal(ai.channelScope,'all eligible channels');
 }
 for(const patch of [{AI_CHANNEL_IDS:''},{AI_CHANNEL_IDS:'all',AI_ENABLED:'false'},{AI_CHANNEL_IDS:'all',OPENAI_API_KEY:''},{AI_CHANNEL_IDS:'almost-all'}]) {
 assert.equal(createAI({...env,...patch}).canReview('new-channel'),false);
 }
});
