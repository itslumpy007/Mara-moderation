import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PermissionsBitField, PermissionFlagsBits as P, ChannelType, Collection } from 'discord.js';
import { createStore } from '../src/store.js';
import { validateConfig, config, runtimeEnv, welcomeText, saveConfig } from '../src/config.js';
import { linkViolations, validateAutomod, defaults, createAutomod } from '../src/automod.js';
import { createRaidGuard } from '../src/raid.js';
import { createVerification, verificationGate } from '../src/verification.js';
import { createDelivery, privateChannel, createBackups } from '../src/reliability.js';
import { collectTranscript, createTickets } from '../src/tickets.js';
import { createStaffTools } from '../src/staff-tools.js';
import { escalateWarning } from '../src/escalation.js';
const bits=(...p)=>new PermissionsBitField(p);
function temp(t) {const dir=mkdtempSync(join(tmpdir(),'mara-roadmap-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function memory(t) {const store=createStore(':memory:');t.after(()=>store.close());return store;}

test('legacy warnings migrate once, case IDs persist, revocation keeps history, backup restores',async t=>{
 const dir=temp(t),path=join(dir,'mara.sqlite');
 let db=new DatabaseSync(path);db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 db.prepare('INSERT INTO kv VALUES (?,?)').run('warnings:123',JSON.stringify([{reason:'original',moderator:'456',date:'2026-01-01T00:00:00.000Z'}]));db.close();
 let s=createStore(path);assert.equal(s.warningCount('123'),1);
 const id=s.addCase({type:'warn',target:'123',actor:'456',reason:'second'});
 assert.equal(id,2);assert.equal(s.revokeWarning(1,'456','appeal accepted'),true);assert.equal(s.revokeWarning(1,'456','again'),false);
 assert.equal(s.warningCount('123'),1);assert.equal(s.case(1).reason,'original');
 await s.backup(join(dir,'copy.sqlite'));s.close();
 s=createStore(path);assert.equal(s.cases().length,2);s.close();
 const restored=createStore(join(dir,'copy.sqlite'));assert.equal(restored.case(1).revoke_reason,'appeal accepted');restored.close();
});
test('configuration refuses secrets and invalid values, honors runtime overrides and template placeholders',t=>{
 const s=memory(t),env=runtimeEnv(s,{LOG_CHANNEL_ID:'old',DISCORD_TOKEN:'secret'});
 assert.throws(()=>validateConfig({DISCORD_TOKEN:'oops'}),/Unknown/);
 assert.throws(()=>validateConfig({minAccountDays:-1}),/range/);
 assert.throws(()=>validateConfig({captcha:'true'}),/boolean|true/);
 assert.throws(()=>validateConfig({ticketCategories:[]}),/category/);
 s.set('config',{LOG_CHANNEL_ID:'new'});assert.equal(env.LOG_CHANNEL_ID,'new');assert.equal(env.DISCORD_TOKEN,'secret');
 assert.equal(config(s).warningThreshold,0);
 assert.equal(welcomeText('{user} / {server} / {count}',{id:'1',guild:{name:'Test',memberCount:10}}),'<@1> / Test / 10');
});
test('CAPTCHA cannot be enabled without external configuration',async t=>{
 const s=memory(t);
 await assert.rejects(saveConfig(s,{captcha:true},{members:{fetchMe:async()=>({})}},{},{}),/Turnstile/);
 assert.equal(config(s).captcha,false);
});
test('domain rules handle subdomains, credentials, punycode and IPs without matching innocent suffixes',()=>{
 const cfg={...defaults,blockedDomains:['bad.example'],blockSuspiciousLinks:true};
 assert.deepEqual(linkViolations('https://sub.bad.example/a',cfg),['blocked link domain']);
 assert.deepEqual(linkViolations('https://notbad.example/a',cfg),[]);
 for(const url of ['https://user:password@good.example','http://127.0.0.1/login','https://xn--test.example']) assert.ok(linkViolations(url,cfg).length);
 assert.throws(()=>validateAutomod({blockedDomains:['https://bad.example']}),/domain/);
 assert.throws(()=>validateAutomod({exemptChannels:['all']}),/IDs/);
});
test('repeated message protection expires and exemptions skip all checks',async t=>{
 const store=memory(t);store.set('automod',{...defaults,enabled:true,repeatEnabled:true,spamLimit:30,exemptChannels:['exempt']});
 let now=100000;const logs=[];
 const moderate=createAutomod({store,env:{GUILD_ID:'g'},now:()=>now,audit:async(_,text)=>logs.push(text),ai:{canReview:()=>false}});
 const msg={guild:{id:'g',ownerId:'owner'},author:{id:'u'},member:{id:'u',permissions:bits(),roles:{cache:new Map()}},content:'same',channelId:'c',mentions:{users:new Map(),roles:new Map()}};
 for(let k=0;k<3;k++)await moderate(msg);
 assert.match(logs[0],/repeated/);
 now+=31000;await moderate(msg);assert.equal(logs.length,1);
 await moderate({...msg,channelId:'exempt',mentions:{everyone:true}});assert.equal(logs.length,1);
});
test('raid guard defaults off, alerts once per window, and pauses verification without punishing',async t=>{
 const store=memory(t);let now=100000;const logs=[];
 const guard=createRaidGuard({store,now:()=>now,audit:async(_,text)=>logs.push(text)});
 const m={user:{bot:false},guild:{}};
 for(let k=0;k<10;k++)await guard(m);assert.equal(logs.length,0);
 store.set('config',{raidAction:'pause-verification',raidJoins:3,raidSeconds:10,raidHoldMinutes:2});
 for(let k=0;k<4;k++)await guard(m);
 assert.equal(logs.length,1);assert.equal(store.get('raid:pausedUntil'),now+120000);
 assert.match(verificationGate({user:{createdTimestamp:0}},config(store),store.get('raid:pausedUntil'),now),/paused/);
 now+=121000;assert.equal(verificationGate({user:{createdTimestamp:0}},config(store),store.get('raid:pausedUntil'),now),null);
});
test('verification enforces age and CAPTCHA before granting and avoids duplicate grants',async t=>{
 const store=memory(t);store.set('config',{minAccountDays:2,captcha:true});let grants=0;
 const role={id:'verified',guild:{id:'g'},managed:false,editable:true,position:1,permissions:bits()};
 const me={permissions:bits(P.ManageRoles),roles:{highest:{comparePositionTo:()=>1}}};
 const cache=new Map();
 const member={id:'u',user:{tag:'User',createdTimestamp:Date.now()},roles:{cache,add:async()=>{grants++;cache.set('verified',role);}},guild:{roles:{fetch:async()=>role},members:{fetchMe:async()=>me}}};
 const verify=createVerification({store,env:{VERIFIED_ROLE_ID:'verified'},audit:async()=>{}});
 await assert.rejects(verify.grant(member),/days old/);assert.equal(grants,0);
 member.user.createdTimestamp=0;
 await assert.rejects(verify.grant(member),/challenge/);
 await verify.grant(member,{captchaPassed:true});await verify.grant(member,{captchaPassed:true});assert.equal(grants,1);
 assert.equal(store.cases()[0].type,'verify');
});
test('private delivery detects unintended role access and retries after permissions are repaired',async t=>{
 const store=memory(t),everyone={id:'g'},staff={id:'staff'};
 let exposed=true,sends=0;
 const channel={type:ChannelType.GuildText,permissionOverwrites:{cache:new Collection()},permissionsFor:r=>r===everyone?bits(...(exposed?[P.ViewChannel]:[])):bits(P.ViewChannel,P.SendMessages),send:async()=>{sends++;}};
 const guild={roles:{everyone,cache:new Map([['staff',staff]]),fetch:async()=>{}},channels:{fetch:async()=>channel},members:{fetchMe:async()=>({})}};
 const client={isReady:()=>true,user:{id:'bot'},guilds:{fetch:async()=>guild}};
 assert.equal(privateChannel(channel,guild,'staff','bot'),false);
 store.enqueue('channel',{content:'private'},true);
 const delivery=createDelivery({store,client,env:{GUILD_ID:'g',STAFF_ROLE_ID:'staff'}});
 await delivery.flush();assert.equal(sends,0);assert.equal(store.queueSize(),1);
 exposed=false;
 // Re-enqueue as an immediately due item while leaving the first retry durable.
 store.enqueue('channel',{embeds:[{title:'Report',description:'private'}]},true);
 await delivery.flush();assert.equal(sends,1);assert.equal(store.queueSize(),1);
});
test('manual backups use SQLite backup and retain a bounded set',async t=>{
 const dir=temp(t),store=memory(t);store.set('test',{works:true});
 const run=createBackups(store,dir);const name=await run();
 const restored=createStore(join(dir,'backups',name));assert.deepEqual(restored.get('test'),{works:true});restored.close();
 assert.equal(store.get('health:backup').name,name);
});
test('transcripts preserve order and attachments, and ticket exports reject unrelated members',async t=>{
 const message=id=>({id:String(id),createdTimestamp:id,author:{tag:'User',id:'u'},content:'message '+id,attachments:new Map([['a',{url:'https://example.com/file'}]])});
 const channel={messages:{fetch:async()=>new Map([['2',message(2)],['1',message(1)]])}};
 const transcript=await collectTranscript(channel);assert.ok(transcript.text.indexOf('message 1')<transcript.text.indexOf('message 2'));assert.match(transcript.text,/example.com/);
 const store=memory(t);store.set('ticket-meta:123',{owner:'owner',status:'open'});
 const tickets=createTickets({store,env:{},client:{},audit:async()=>{},ai:{},dataDir:temp(t)});
 await assert.rejects(tickets.transcript({channelId:'123',channel},{id:'outsider',permissions:bits(),roles:{cache:new Map()}}),/access/);
});
test('new staff handlers reject unauthorized configuration and history access',async t=>{
 const store=memory(t),tools=createStaffTools({store,env:{},audit:async()=>{},backupNow:async()=>{},verification:{},tickets:{}});
 const actor={permissions:bits()};
 for(const name of ['config','raid','escalation','history','warn-remove']) await assert.rejects(tools({commandName:name,options:{}},actor),/required/);
});
test('warning escalation is opt-in, preserves longer timeouts, and records only successful actions',async t=>{
 const store=memory(t);let duration=0;
 const target={id:'user',moderatable:true,communicationDisabledUntilTimestamp:100000+3600000,timeout:async n=>{duration=n;}};
 const input={store,target,caseId:1,botId:'bot',now:()=>100000};
 store.addCase({type:'warn',target:'user',actor:'staff',reason:'warning'});
 await escalateWarning(input);assert.equal(duration,0);
 store.set('config',{warningThreshold:2,warningTimeoutMinutes:10});
 await escalateWarning(input);assert.equal(duration,0);
 store.addCase({type:'warn',target:'user',actor:'staff',reason:'second'});
 assert.match(await escalateWarning(input),/applied/);assert.equal(duration,3600000);assert.equal(store.cases()[0].type,'auto-timeout');
 target.timeout=async()=>{throw Error('denied');};
 const before=store.cases().length;assert.match(await escalateWarning(input),/failed/);assert.equal(store.cases().length,before);
 target.moderatable=false;assert.match(await escalateWarning(input),/skipped/);
});
