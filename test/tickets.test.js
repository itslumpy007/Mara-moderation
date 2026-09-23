import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createStore } from '../src/store.js';
import { createTickets } from '../src/tickets.js';
function fixture(t) {
 const dataDir=mkdtempSync(join(tmpdir(),'mara-tickets-')),store=createStore(':memory:');
 t.after(()=>{store.close();rmSync(dataDir,{recursive:true,force:true});});
 const role={id:'staff'},logs=[],replies=[];let denied=0;
 const channel={id:'123456789012345678',permissionsFor:()=>new PermissionsBitField([P.ViewChannel,P.ReadMessageHistory]),messages:{fetch:async()=>new Map()},permissionOverwrites:{edit:async()=>{denied++;}},setName:async()=>{}};
 const client={users:{fetch:async()=>({send:async()=>{}})}};
 const tickets=createTickets({store,env:{STAFF_ROLE_ID:role.id},client,audit:async(_,text)=>logs.push(text),ai:{},dataDir});
 const actor={id:'owner',permissions:new PermissionsBitField(),roles:{cache:new Map()}};
 const i={user:{id:'owner'},channelId:channel.id,channel,guild:{},editReply:async response=>replies.push(response)};
 store.set('ticket-meta:'+channel.id,{owner:'owner',status:'open',category:'Support'});
 store.set('ticket:owner',channel.id);store.set('owner:'+channel.id,'owner');
 return {dataDir,store,tickets,actor,i,channel,logs,replies,denied:()=>denied};
}
test('ticket close asks for confirmation, then archives, locks access and retains metadata',async t=>{
 const f=fixture(t);
 await f.tickets.close(f.i,f.actor);assert.equal(f.denied(),0);assert.match(f.replies[0].content,/Close this ticket/);
 await f.tickets.close(f.i,f.actor,true);
 assert.equal(f.denied(),1);assert.equal(f.store.get('ticket:owner'),null);
 assert.equal(f.store.get('ticket-meta:'+f.channel.id).status,'closed');
 assert.ok(existsSync(join(f.dataDir,'transcripts',f.channel.id+'.txt')));
 await f.tickets.close(f.i,f.actor,true);assert.equal(f.denied(),1);
});
test('failed transcript export leaves an open ticket accessible and retryable',async t=>{
 const f=fixture(t);f.channel.messages.fetch=async()=>{throw Error('missing read history');};
 await assert.rejects(f.tickets.close(f.i,f.actor,true),/missing read history/);
 assert.equal(f.denied(),0);assert.equal(f.store.get('ticket-meta:'+f.channel.id).status,'open');
});
test('claiming requires staff, preserves the claim, and feedback belongs to the owner',async t=>{
 const f=fixture(t);
 await assert.rejects(f.tickets.claim(f.i,f.actor),/access/);
 const staff={id:'staff-user',permissions:new PermissionsBitField(P.ManageChannels),roles:{cache:new Map()}};
 await f.tickets.claim(f.i,staff);
 await assert.rejects(f.tickets.claim(f.i,{...staff,id:'other-staff'}),/already claimed/);
 await f.tickets.close(f.i,f.actor,true);
 f.i.options={getString:()=>f.channel.id,getInteger:()=>5};
 await assert.rejects(f.tickets.feedback({...f.i,user:{id:'other'}}),/own closed/);
 await f.tickets.feedback(f.i);assert.equal(f.store.get('ticket-meta:'+f.channel.id).rating,5);
 await assert.rejects(f.tickets.feedback(f.i),/already rated/);
});
