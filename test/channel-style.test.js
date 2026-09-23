import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { styledName, styleChannel } from '../src/channel-style.js';
import { commands } from '../src/commands.js';
import { createStaffTools } from '../src/staff-tools.js';

test('styles channel names and preserves category spaces, emoji and non-Latin text',()=>{
  assert.equal(styledName(' General Chat ','small-caps','star'),'✦・ɢᴇɴᴇʀᴀʟ-ᴄʜᴀᴛ');
  assert.equal(styledName('Welcome 12','bold','none',4),'𝐖𝐞𝐥𝐜𝐨𝐦𝐞 𝟏𝟐');
  assert.equal(styledName('General 12','mono'),'𝚐𝚎𝚗𝚎𝚛𝚊𝚕-𝟷𝟸');
  assert.equal(styledName('🌸 日本語','plain','none',4),'🌸 日本語');
  assert.equal(styledName('General Chat','plain','none',4),'General Chat');
});

test('rejects invalid names and overlong styled output',()=>{
  for(const name of ['', '  ', 'a\nb', 'a\u200bb']) assert.throws(()=>styledName(name));
  assert.throws(()=>styledName('general','unknown'));
  assert.throws(()=>styledName('general','plain','unknown'));
  assert.throws(()=>styledName('general','plain','none',11));
  assert.equal(styledName('a'.repeat(50),'bold').length,100);
  assert.throws(()=>styledName('a'.repeat(51),'bold'));
  assert.throws(()=>styledName('a'.repeat(99),'plain','star'));
});

function fixture({apply=false,actorAllowed=true,botAllowed=true,fail=false,type=4}={}) {
  const actor={id:'staff'}, bot={id:'bot'}, changes=[], logs=[], replies=[];
  const channel={id:'channel',guildId:'guild',type,name:'Old Name',permissionsFor:member=>new PermissionsBitField((member===actor?actorAllowed:botAllowed)?[P.ViewChannel,P.ManageChannels]:[]),setName:async(name,reason)=>{if(fail)throw Error('Discord rejected rename');changes.push({name,reason});return {...channel,name};}};
  const interaction={commandName:'channel-style',guild:{id:'guild',channels:{fetch:async()=>channel},members:{fetchMe:async()=>bot}},options:{getChannel:()=>({id:'channel'}),getString:key=>({name:'Welcome',style:'small-caps',decoration:'star'}[key]??null),getBoolean:()=>apply},editReply:async reply=>replies.push(reply)};
  return {actor,channel,interaction,changes,logs,replies,audit:async(...args)=>logs.push(args)};
}

test('staff command previews privately without renaming or auditing',async()=>{
  const f=fixture();
  assert.equal(await createStaffTools({audit:f.audit})(f.interaction,f.actor),true);
  assert.match(f.replies[0].content,/Name preview:.*ᴡᴇʟᴄᴏᴍᴇ/);
  assert.deepEqual(f.replies[0].allowedMentions,{parse:[]});
  assert.equal(f.changes.length,0); assert.equal(f.logs.length,0);
});

test('explicit apply renames only the selected name and audits the result',async()=>{
  const f=fixture({apply:true});
  assert.match(await styleChannel(f.interaction,f.actor,f.audit),/Renamed/);
  assert.deepEqual(f.changes,[{name:'✦・ᴡᴇʟᴄᴏᴍᴇ',reason:'Name styling by staff'}]);
  assert.match(f.logs[0][1],/Old Name → ✦・ᴡᴇʟᴄᴏᴍᴇ/);
});

test('enforces permissions and rejects unsupported targets and failed renames',async()=>{
  for(const config of [{actorAllowed:false},{apply:true,botAllowed:false},{apply:true,type:11},{apply:true,fail:true}]) {
    const f=fixture(config);
    await assert.rejects(styleChannel(f.interaction,f.actor,f.audit));
    assert.equal(f.changes.length,0); assert.equal(f.logs.length,0);
  }
  const f=fixture({apply:true}); f.channel.guildId='another-guild';
  await assert.rejects(styleChannel(f.interaction,f.actor,f.audit),/this server/);
});

test('command registration requires Manage Channels and permits categories',()=>{
  const command=commands.find(c=>c.name==='channel-style');
  assert.equal(command.default_member_permissions,String(P.ManageChannels));
  assert.ok(command.options.find(o=>o.name==='channel').channel_types.includes(4));
  assert.equal(command.options.find(o=>o.name==='apply').required,false);
});
