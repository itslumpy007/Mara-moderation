import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { baseName, styledName, styleChannels, nameStyles } from '../src/channel-style.js';
import { commands } from '../src/commands.js';

function fixture({scope='all',apply=false,category=null,denied=[],fail=[],style='small-caps',decoration='star',divider='none'}={}) {
 const changed=[],replies=[],logs=[];
 const channels=new Map([['cat',4,'Community',null],['general',0,'general','cat'],['voice',2,'Lounge','cat'],['other',0,'other',null],['thread',11,'thread','cat']].map(([id,type,name,parentId])=>[id,{id,type,name,parentId,guildId:'guild',permissionsFor:()=>new PermissionsBitField(denied.includes(id)?[]:[P.ViewChannel,P.ManageChannels]),setName:async function(name){if(fail.includes(id))throw Error('Rename failed');changed.push(id);this.name=name;return this;}}]));
 const actor={id:'staff'};
 const i={guild:{id:'guild',channels:{fetch:async id=>id?channels.get(id):channels},members:{fetch:async()=>actor,fetchMe:async()=>({id:'bot'})}},options:{getString:key=>({scope,style,decoration,divider}[key]),getBoolean:()=>apply,getChannel:()=>category?{id:category}:null},editReply:async reply=>replies.push(reply)};
 return {i,actor,channels,changed,replies,logs,audit:async(...args)=>logs.push(args)};
}
const run=f=>styleChannels(f.i,f.actor,f.audit);

test('restyling replaces supported lettering without stacking decorations',()=>{
 for(const {value:style} of nameStyles) {
  const name=styledName('general',style,'star');
  assert.equal(styledName(baseName(name),style,'star'),name);
  assert.equal(baseName(name),'general');
 }
 assert.equal(baseName('🌸・日本語'),'🌸・日本語');
});

test('bulk preview lists full plan without writes, excludes threads',async()=>{
 const f=fixture();await run(f);
 assert.equal(f.changed.length,0);assert.equal(f.logs.length,0);
 assert.match(f.replies[0].content,/4 names would change/);
 const report=f.replies[0].files[0].attachment.toString();
 assert.match(report,/general → ✦・ɢᴇɴᴇʀᴀʟ/);assert.doesNotMatch(report,/thread/);
});

test('bulk apply respects each scope and is idempotent',async()=>{
 for(const [scope,category,expected] of [['all',null,['cat','general','voice','other']],['channels',null,['general','voice','other']],['categories',null,['cat']],['category','cat',['general','voice']]]) {
  const f=fixture({scope,category,apply:true});await run(f);
  assert.deepEqual(f.changed,expected);
  await run(f);assert.deepEqual(f.changed,expected);
  assert.match(f.replies.at(-1).content,/0 renamed/);
 }
});

test('bulk skips denied channels without disclosing names and continues after errors',async()=>{
 const f=fixture({apply:true,denied:['other'],fail:['general']});await run(f);
 assert.deepEqual(f.changed,['cat','voice']);
 assert.match(f.replies.at(-1).content,/2 renamed, 1 failed.*1 skipped/);
 assert.doesNotMatch(f.replies.at(-1).files[0].attachment.toString(),/other/);
 assert.equal(f.logs.length,1);
});

test('bulk rejects invalid scope/category selection before changes',async()=>{
 for(const options of [{scope:'category'},{scope:'category',category:'general'},{scope:'all',category:'cat'},{scope:'invalid'},{scope:'category',category:'cat',denied:['cat']}]) {
  const f=fixture({...options,apply:true});await assert.rejects(run(f));assert.equal(f.changed.length,0);
 }
});

test('bulk rechecks permissions when applying and releases lock on completion',async()=>{
 const f=fixture({apply:true});
 f.i.editReply=async reply=>{f.replies.push(reply);if(reply.content.startsWith('Applying'))f.channels.get('general').permissionsFor=()=>new PermissionsBitField();};
 await run(f);assert.ok(!f.changed.includes('general'));
 await run(f);
});

test('bulk rejects concurrent apply operations',async()=>{
 const f=fixture({apply:true});let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const fetch=f.i.guild.channels.fetch;
 f.i.guild.channels.fetch=async id=>{if(!id)await gate;return fetch(id);};
 const first=run(f);
 await assert.rejects(run(f),/already running/);
 release();await first;
});

test('bulk command is restricted and previews by default',()=>{
 const c=commands.find(c=>c.name==='channel-style-bulk');
 assert.equal(c.default_member_permissions,String(P.ManageChannels));
 assert.equal(c.options.find(o=>o.name==='apply').required,false);
});


test('all lettering styles encode assigned Unicode characters and round-trip all letters and digits',()=>{
 for(const {value:style} of nameStyles.filter(s=>s.value!=='small-caps')) {
  for(const text of ['ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz','0123456789']) {
   const styled=styledName(text,style,'none',4);
   assert.equal(baseName(styled),text,style);
   assert.equal(styled.normalize('NFKD'),text,style);
   assert.equal(styledName(baseName(styled),style,'none',4),styled);
  }
 }
});

test('new styles handle Unicode exceptions and preserve unrelated symbols',()=>{
 assert.equal(styledName('high','italic','none',4),'ℎ𝑖𝑔ℎ');
 assert.equal(styledName('CHNPQRZ','double-struck','none',4),'ℂℍℕℙℚℝℤ');
 assert.equal(styledName('general','script'),'𝓰𝓮𝓷𝓮𝓻𝓪𝓵');
 assert.equal(styledName('general','gothic'),'𝖌𝖊𝖓𝖊𝖗𝖆𝖑');
 for(const {value:style} of nameStyles) assert.equal(baseName(styledName('🌸・日本語',style,'none',4)),'🌸・日本語');
});

test('both commands expose all styles within Discord choice limits',()=>{
 for(const name of ['channel-style','channel-style-bulk']) {
  const choices=commands.find(c=>c.name===name).options.find(o=>o.name==='style').choices;
  assert.equal(choices.length,11);assert.ok(choices.length<=25);
  assert.equal(new Set(choices.map(c=>c.value)).size,choices.length);
 }
});

test('bulk can switch from script to Gothic and then plain',async()=>{
 const f=fixture({apply:true,style:'script'});await run(f);
 f.i.options.getString=key=>({scope:'all',style:'gothic',decoration:'star'}[key]);await run(f);
 assert.equal(f.channels.get('general').name,'✦・𝖌𝖊𝖓𝖊𝖗𝖆𝖑');
 f.i.options.getString=key=>({scope:'all',style:'plain',decoration:'none'}[key]);await run(f);
 assert.equal(f.channels.get('general').name,'general');
 assert.equal(f.channels.get('cat').name,'Community');
});


test('category dividers frame names, restyle cleanly and enforce length',()=>{
 assert.equal(styledName('COMMUNITY','plain','none',4,'stars'),'━━ ✦ COMMUNITY ✦ ━━');
 assert.equal(styledName('Community','plain','none',4,'lines'),'━━ Community ━━');
 assert.equal(styledName('Community','plain','none',4,'brackets'),'╭── Community ──╮');
 for(const divider of ['lines','stars','brackets']) {
  const name=styledName('Community','bold','star',4,divider);
  assert.equal(baseName(name),'Community');
  assert.equal(styledName(baseName(name),'bold','star',4,divider),name);
 }
 assert.equal(styledName('━━ ✦ COMMUNITY ✦ ━━','plain','none',4,'brackets'),'╭── COMMUNITY ──╮');
 assert.throws(()=>styledName('general','plain','none',0,'stars'),/categories only/);
 assert.throws(()=>styledName('Community','plain','none',4,'invalid'),/supported/);
 assert.throws(()=>styledName('a'.repeat(95),'plain','none',4,'stars'),/too long/);
 assert.equal(baseName('✦ Community ✦'),'✦ Community ✦');
});

test('bulk category dividers preview then apply without touching child names',async()=>{
 const f=fixture({scope:'categories',style:'plain',decoration:'none',divider:'stars'});
 await run(f);assert.equal(f.changed.length,0);
 assert.match(f.replies.at(-1).files[0].attachment.toString(),/━━ ✦ Community ✦ ━━/);
 f.i.options.getBoolean=()=>true;await run(f);
 assert.deepEqual(f.changed,['cat']);assert.equal(f.channels.get('general').name,'general');
 await run(f);assert.deepEqual(f.changed,['cat']);
 f.i.options.getString=key=>({scope:'categories',style:'plain',decoration:'none',divider:'none'}[key]);
 await run(f);assert.equal(f.channels.get('cat').name,'Community');
});

test('all scope frames only categories and rejects divider with children-only scopes',async()=>{
 const f=fixture({apply:true,divider:'stars'});await run(f);
 assert.equal(f.channels.get('cat').name,'━━ ✦ ✦・ᴄᴏᴍᴍᴜɴɪᴛʏ ✦ ━━');
 assert.equal(f.channels.get('general').name,'✦・ɢᴇɴᴇʀᴀʟ');
 for(const scope of ['channels','category']) await assert.rejects(run(fixture({scope,category:scope==='category'?'cat':null,divider:'stars'})),/use dividers/);
 for(const name of ['channel-style','channel-style-bulk']) assert.equal(commands.find(c=>c.name===name).options.find(o=>o.name==='divider').choices.length,4);
});
