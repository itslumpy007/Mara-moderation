import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ChannelType, RESTJSONErrorCodes } from 'discord.js';
import { createDelivery } from '../src/reliability.js';
import { createDashboard } from '../src/dashboard.js';
import { createStore } from '../src/store.js';
import { tiktokLivePath } from '../src/tiktok-live.js';

const env = {
  DASHBOARD_ENABLED:'true', TIKTOK_LIVE_ENABLED:'true',
  TIKTOK_LIVE_CHANNEL_ID:'123456789012345678', TIKTOK_LIVE_CREATORS:'@first_creator, second.creator',
  EULER_WEBHOOK_SECRET:'secret used only for this test',
  PUBLIC_BASE_URL:'http://localhost:3000', CLIENT_ID:'client', DISCORD_CLIENT_SECRET:'oauth test secret'
};

async function listen(t,store,settings=env) {
  const server = createDashboard({
    env:settings,store,client:{isReady:()=>true}
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>{ server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:'+server.address().port+tiktokLivePath;
}

function deliver(url,body,secret=env.EULER_WEBHOOK_SECRET) {
  const signature = createHmac('sha256',secret).update(body).digest('hex');
  return fetch(url,{method:'POST',body,headers:{'Content-Type':'application/json','X-Webhook-Signature':signature}});
}

test('signed LIVE events from multiple creators go only to the configured channel',async t=>{
  const store = createStore(':memory:');
  t.after(()=>store.close());
  const url = await listen(t,store);
  const first = '{"unique_id":"FIRST_CREATOR","room_id":7891234567891234567}';
  const second = '{"metadata":{"platformUsername":"second.creator"},"room_info":{"room_id":"7891234567891234568"}}';
  const [one,two] = await Promise.all([deliver(url,first),deliver(url,second)]);
  assert.deepEqual(await one.json(),{queued:true});
  assert.deepEqual(await two.json(),{queued:true});
  assert.deepEqual(await (await deliver(url,first)).json(),{queued:false});
  const items = store.pending();
  assert.equal(items.length,2);
  for(const item of items) assert.equal(item.channel,env.TIKTOK_LIVE_CHANNEL_ID);
  const payloads = items.map(item=>JSON.parse(item.payload));
  assert.ok(payloads.some(message=>message.content.includes('https://www.tiktok.com/@first_creator/live')));
  assert.ok(payloads.some(message=>message.content.includes('https://www.tiktok.com/@second.creator/live')));
  assert.equal(new Set(payloads.map(message=>message.nonce)).size,2);
  assert.deepEqual(payloads[0].allowedMentions,{parse:[]});
  assert.equal(payloads[0].enforceNonce,true);
  // Consecutive numeric IDs are distinct even above Number.MAX_SAFE_INTEGER.
  assert.deepEqual(await (await deliver(url,first.replace(/4567/, '4568'))).json(),{queued:true});
});

test('unsigned, invalid and unwatched events never queue a Discord alert',async t=>{
  const store = createStore(':memory:');
  t.after(()=>store.close());
  const url = await listen(t,store);
  const valid = '{"unique_id":"first_creator","room_id":"7891234567891234567"}';
  assert.equal((await fetch(url)).status,405);
  assert.equal((await fetch(url,{method:'POST',body:valid})).status,401);
  assert.equal((await deliver(url,valid,'incorrect')).status,401);
  assert.equal((await deliver(url,'{invalid}')).status,400);
  assert.equal((await deliver(url,JSON.stringify({event:'z'.repeat(140000)}))).status,413);
  assert.deepEqual(await (await deliver(url,valid.replace('first_creator','outsider'))).json(),{ignored:true});
  assert.deepEqual(await (await deliver(url,'{"is_test":true}')).json(),{ignored:true});
  assert.deepEqual(await (await deliver(url,'{"event":"live.end",'+valid.slice(1))).json(),{ignored:true});
  assert.equal(store.queueSize(),0);
});

test('room deduplication survives queue delivery and a database restart',async t=>{
  const dir = mkdtempSync(join(tmpdir(),'mara-tiktok-'));
  const path = join(dir,'test.sqlite');
  let store = createStore(path);
  t.after(()=>{store.close();rmSync(dir,{recursive:true});});
  assert.equal(store.enqueueTikTokLive('first_creator','123','channel',{content:'Alert'}),true);
  store.delivered(store.pending()[0].id);
  store.close();
  store = createStore(path);
  assert.equal(store.enqueueTikTokLive('first_creator','123','channel',{content:'Duplicate'}),false);
  assert.equal(store.queueSize(),0);
  assert.equal(store.enqueueTikTokLive('first_creator','124','channel',{content:'Next stream'}),true);
});

test('feature is off by default and requires a channel, an allowlist and signature secret when enabled',async t=>{
  const store = createStore(':memory:');
  t.after(()=>store.close());
  const url = await listen(t,store,{...env,TIKTOK_LIVE_ENABLED:'false'});
  assert.equal((await deliver(url,'{}')).status,404);
  for(const overrides of [{TIKTOK_LIVE_CHANNEL_ID:''},{TIKTOK_LIVE_CREATORS:'user, bad handle'},{EULER_WEBHOOK_SECRET:''}]){
    const inactive = await listen(t,store,{...env,...overrides});
    assert.equal((await deliver(inactive,'{}')).status,404);
  }
});

function deliveryFixture() {
  const trace = [], messages = new Map(), rooms = new Map();
  let nextId = 1;
  const addChannel = id => {
    const channel = {
      id,type:ChannelType.GuildText,
      canSend:true,deleteError:null,sendError:null,
      permissionsFor:()=>({has:()=>channel.canSend}),
      async send(payload) {
        if(channel.sendError) throw channel.sendError;
        const message={id:String(nextId++),channel:id,content:payload.content};
        messages.set(message.id,message);
        trace.push(['post',id,message.id,payload.content]);
        return message;
      },
      messages:{async delete(messageId) {
        trace.push(['delete',id,messageId]);
        if(channel.deleteError) throw channel.deleteError;
        if(messages.get(messageId)?.channel!==id) {
          throw Object.assign(Error('Unknown message'),{code:RESTJSONErrorCodes.UnknownMessage});
        }
        messages.delete(messageId);
      }}
    };
    rooms.set(id,channel);
    return channel;
  };
  const firstChannel=addChannel('alerts'), secondChannel=addChannel('other-alerts');
  const guild={channels:{fetch:async id=>rooms.get(id)},roles:{fetch:async()=>{}},members:{fetchMe:async()=>({})}};
  const client={isReady:()=>true,user:{id:'mara'},guilds:{fetch:async()=>guild}};
  return {trace,messages,firstChannel,secondChannel,client};
}

test('only the same creator’s latest alert is replaced, even across a restart and channel change',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'mara-live-posts-'));
  const path=join(dir,'test.sqlite');
  let store=createStore(path);
  t.after(()=>{store.close();rmSync(dir,{recursive:true});});
  const {client,trace,messages}=deliveryFixture();
  const queue=(creator,room,channel)=>store.enqueueTikTokLive(creator,room,channel,{content:creator+' '+room});
  const worker=()=>createDelivery({store,client,env:{GUILD_ID:'guild'}});
  queue('first_creator','100','alerts');
  queue('second.creator','200','alerts');
  await worker().flush();
  assert.equal(messages.size,2);
  const first=store.tiktokLiveMessage('first_creator'), other=store.tiktokLiveMessage('second.creator');
  await worker().flush();
  assert.equal(trace.length,2);
  store.close();
  store=createStore(path);
  assert.equal(queue('first_creator','100','alerts'),false);
  assert.equal(queue('first_creator','101','other-alerts'),true);
  await worker().flush();
  assert.deepEqual(trace.slice(2).map(entry=>entry.slice(0,2)),[['delete','alerts'],['post','other-alerts']]);
  assert.equal(trace[2][2],first.message);
  assert.equal(messages.has(first.message),false);
  assert.equal(messages.get(other.message).content,'second.creator 200');
  assert.equal(messages.get(store.tiktokLiveMessage('first_creator').message).content,'first_creator 101');
  assert.equal(messages.size,2);
});

test('blocked deletion holds replacements for that creator and a manually removed alert can be replaced',async t=>{
  const store=createStore(':memory:');
  t.after(()=>store.close());
  const {client,firstChannel,trace,messages}=deliveryFixture();
  let now=Date.now()+1000;
  const delivery=createDelivery({store,client,env:{GUILD_ID:'guild'},now:()=>now});
  const queue=(creator,room,channel='alerts')=>store.enqueueTikTokLive(creator,room,channel,{content:creator+' '+room});
  queue('first_creator','100');
  await delivery.flush();
  const previous=store.tiktokLiveMessage('first_creator');
  queue('first_creator','101');
  queue('first_creator','102');
  queue('second.creator','200','other-alerts');
  firstChannel.deleteError=Object.assign(Error('Missing access'),{code:RESTJSONErrorCodes.MissingAccess});
  await delivery.flush();
  await delivery.flush();
  assert.equal(messages.has(previous.message),true);
  assert.equal(trace.filter(entry=>entry[0]==='post').length,2);
  assert.equal(store.queueSize(),2);

  messages.delete(previous.message);
  firstChannel.deleteError=null;
  firstChannel.sendError=Error('Discord unavailable');
  now+=30000;
  await delivery.flush();
  assert.equal(store.tiktokLiveMessage('first_creator'),null);
  assert.equal(store.queueSize(),2);
  firstChannel.sendError=null;
  now+=60000;
  await delivery.flush();
  assert.equal(messages.get(store.tiktokLiveMessage('first_creator').message).content,'first_creator 101');
  await delivery.flush();
  assert.equal(messages.get(store.tiktokLiveMessage('first_creator').message).content,'first_creator 102');
  assert.equal(messages.size,2);
  assert.equal(store.queueSize(),0);
});
