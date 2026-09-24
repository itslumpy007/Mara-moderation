import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionFlagsBits as P,PermissionsBitField} from 'discord.js';
import {categoryKind,presetOverwrites,permissionPlan,snapshotOverwrites,sameOverwrites,categoryPermissions} from '../src/category-permissions.js';
import {commands} from '../src/commands.js';
const ids={guildId:'guild',verifiedId:'verified',staffId:'staff',botId:'bot'};
const row=(id,allow=0n,deny=0n,type=0)=>({id,type,allow:String(allow),deny:String(deny)});
function effective(rows,roleIds=[]) {
 let result=P.ViewChannel|P.SendMessages|P.Connect|P.MentionEveryone;
 for(const o of rows.filter(r=>r.id==='guild'))result=(result&~BigInt(o.deny))|BigInt(o.allow);
 let allow=0n,deny=0n;
 for(const o of rows.filter(r=>roleIds.includes(r.id))){allow|=BigInt(o.allow);deny|=BigInt(o.deny);}
 return new PermissionsBitField((result&~deny)|allow);
}
function fixture({action='preview',admin=true,botCan=true}={}) {
 const state=new Map(),channels=new Map(),writes=[],replies=[],audits=[];
 const actor={id:'owner',permissions:new PermissionsBitField(admin?P.Administrator:0n)};
 const me={id:'bot',permissions:new PermissionsBitField(botCan?P.Administrator:0n)};
 const roles=new Map([['verified',{id:'verified',managed:false,permissions:new PermissionsBitField(P.ViewChannel)}],['staff',{id:'staff',managed:false,permissions:new PermissionsBitField(P.Administrator)}]]);
 const store={get:(k,d=null)=>state.get(k)??d,set:(k,v)=>state.set(k,structuredClone(v)),list:prefix=>Array.from(state,([key,value])=>({key,value})).filter(r=>r.key.startsWith(prefix))};
 function add(id,name,type,parentId=null,rows=[]) {
  const c={id,name,type,parentId,permissionsFor:()=>new PermissionsBitField(botCan?P.Administrator:0n)};
  const load=rows=>{c.permissionOverwrites.cache=new Map(rows.map(o=>[o.id,{...o,allow:new PermissionsBitField(BigInt(o.allow)),deny:new PermissionsBitField(BigInt(o.deny))}]));};
  c.permissionOverwrites={cache:new Map(),set:async(newRows)=>{
   if(f.fail===id)throw Object.assign(Error('denied'),{code:50013});
   const before=snapshotOverwrites(c);
   const synced=Array.from(channels.values()).filter(child=>child.parentId===id&&sameOverwrites(snapshotOverwrites(child),before));
   load(newRows);writes.push(id);
   for(const child of synced)child.load(newRows);
  }};
  c.load=load;load(rows);channels.set(id,c);return c;
 }
 const guild={id:'guild',roles:{cache:roles,fetch:async()=>roles},members:{fetch:async()=>actor,fetchMe:async()=>me},channels:{fetch:async id=>id?channels.get(id):channels}};
 const i={guild,options:{getString:()=>f.action},editReply:async r=>replies.push(r)};
 const f={action,fail:null,store,state,channels,add,writes,replies,audits,roles,actor,me,i,run:()=>categoryPermissions(i,actor,{env:{VERIFIED_ROLE_ID:'verified',STAFF_ROLE_ID:'staff'},store,audit:async(...a)=>audits.push(a)})};
 add('info','━━ INFO ━━',4);add('rules','rules',0,'info');
 add('community','✦ COMMUNITY',4,null,[row('guild',0n,P.ViewChannel)]);add('general','general',0,'community',[row('guild',0n,P.ViewChannel),row('booster',P.ViewChannel)]);
 add('voice','VOICE',4);add('vc','Lounge',2,'voice');
 add('staff-cat','STAFF',4,null,[row('guild',0n,P.ViewChannel)]);add('logs','bot-log',0,'staff-cat',[row('guild',0n,P.ViewChannel)]);
 return f;
}

test('preset makes info read-only, members verified-only and staff private',()=>{
 for(const kind of ['info','community','voice','staff']) {
  const rows=presetOverwrites(kind,ids);
  assert.equal(effective(rows).has(P.ViewChannel),kind==='info');
  assert.equal(effective(rows).has(P.SendMessages),kind!=='info'); // hidden areas are not accessible
  assert.equal(effective(rows,['verified']).has(P.ViewChannel),kind!=='staff');
  assert.equal(effective(rows,['booster']).has(P.ViewChannel),kind==='info');
  assert.ok(effective(rows,['staff']).has([P.ViewChannel,P.SendMessages,P.Connect]));
  assert.ok(effective(rows,['bot']).has([P.ViewChannel,P.SendMessages]));
  assert.equal(effective(rows,['verified']).has(P.MentionEveryone),false);
 }
});

test('decorated names match only known category names; ticket areas are excluded',()=>{
 assert.equal(categoryKind('━━ ✦ 𝓒𝓸𝓶𝓶𝓾𝓷𝓲𝓽𝔂 ✦ ━━'),'community');
 assert.equal(categoryKind('Community Staff'),null);assert.equal(categoryKind('Private projects'),null);
 const f=fixture();f.add('ticket','ticket-owner',0,'community');f.add('unknown','Secret',4);
 const plan=permissionPlan(f.channels,ids);
 assert.ok(!plan.targets.some(t=>t.id==='community'||t.id==='ticket'||t.id==='general'));
 assert.equal(plan.skipped.length,2);
});

test('preview is read-only and explains overwrite replacement',async()=>{
 const f=fixture();await f.run();assert.equal(f.writes.length,0);assert.equal(f.state.size,0);
 assert.match(f.replies[0].files[0].attachment.toString(),/replaces ALL/);
});

test('apply syncs children, stores a full backup, is idempotent and restore recovers exceptions',async()=>{
 const f=fixture({action:'apply'});
 const originals=Array.from(f.channels,([id,c])=>[id,snapshotOverwrites(c)]);
 await f.run();
 assert.equal(f.state.get('category-permissions:backup:guild').status,'complete');
 for(const c of f.channels.values())if(c.parentId)assert.ok(sameOverwrites(snapshotOverwrites(c),snapshotOverwrites(f.channels.get(c.parentId))));
 const count=f.writes.length,backup=structuredClone(f.state.get('category-permissions:backup:guild'));
 await f.run();assert.equal(f.writes.length,count);assert.deepEqual(f.state.get('category-permissions:backup:guild'),backup);
 f.action='restore';await f.run();
 for(const [id,before] of originals)assert.ok(sameOverwrites(snapshotOverwrites(f.channels.get(id)),before));
 assert.equal(f.state.get('category-permissions:backup:guild').restored,true);
});

test('partial failures keep backup and restore; manual edits block restore',async()=>{
 const f=fixture({action:'apply'});f.fail='general';await f.run();
 assert.equal(f.state.get('category-permissions:backup:guild').status,'partial');
 f.fail=null;await assert.rejects(f.run(),/previous update/);
 f.action='restore';await f.run();assert.equal(f.state.get('category-permissions:backup:guild').restored,true);
 f.action='apply';await f.run();
 f.channels.get('general').load([row('outsider',P.ViewChannel)]);f.action='restore';
 await assert.rejects(f.run(),/Permissions changed/);
});

test('only administrators can run and unsafe or missing roles block apply',async()=>{
 await assert.rejects(fixture({admin:false}).run(),/Administrator/);
 await assert.rejects(fixture({botCan:false}).run(),/Mara needs/);
 const f=fixture();f.roles.get('verified').permissions=new PermissionsBitField(P.Administrator);
 await assert.rejects(f.run(),/Verified role/);assert.equal(f.writes.length,0);
 assert.equal(commands.find(c=>c.name==='category-permissions').default_member_permissions,String(P.Administrator));
});

test('restore still works after the configured verified role is deleted',async()=>{
 const f=fixture({action:'apply'});await f.run();f.roles.delete('verified');f.action='restore';await f.run();
 assert.equal(f.state.get('category-permissions:backup:guild').restored,true);
});
