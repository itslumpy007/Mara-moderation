import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbedBuilder,PermissionFlagsBits as P,PermissionsBitField} from 'discord.js';
import {welcomePayload,makeWelcome,sendWelcome} from '../src/welcome.js';
import {defaultConfig} from '../src/config.js';
import {createStaffTools} from '../src/staff-tools.js';
const makeMember=()=>({id:'123456789012345678',user:{displayAvatarURL:()=> 'https://cdn.discordapp.com/embed/avatars/0.png'},guild:{id:'223456789012345678',name:'The Blacklisted',memberCount:1234,iconURL:()=>null,members:{fetchMe:async()=>({id:'bot'})},channels:{fetch:async()=>new Map()}}});
const perms=(...flags)=>new PermissionsBitField(flags);

test('welcome card renders greeting, avatar, count and navigation-only buttons',()=>{
 const member=makeMember();
 const payload=welcomePayload(member,defaultConfig.welcomeText,{rules:{id:'323456789012345678'},verification:{id:'423456789012345678'}});
 new EmbedBuilder(payload.embeds[0]).toJSON();
 assert.match(payload.embeds[0].description,/<@123456789012345678>/);
 assert.match(payload.embeds[0].footer.text,/1,234/);
 assert.equal(payload.embeds[0].thumbnail.url,member.user.displayAvatarURL());
 assert.equal(payload.embeds[0].fields.length,3);
 assert.equal(payload.components[0].components.length,2);
 for(const button of payload.components[0].components){assert.equal(button.style,5);assert.equal(button.custom_id,undefined);assert.equal(button.emoji,undefined);}
 assert.deepEqual(payload.allowedMentions,{parse:[],users:[member.id]});
});

test('welcome resolves decorative names and omits links to inaccessible destinations',async()=>{
 const member=makeMember();
 member.guild.channels.fetch=async()=>new Map([['rules',{id:'rules',type:0,name:'◇・𝑟𝑢𝑙𝑒𝑠-📔',permissionsFor:()=>perms(P.ViewChannel)}],['verify',{id:'verify',type:0,name:'verification',permissionsFor:()=>perms()}]]);
 const payload=await makeWelcome(member,'Custom greeting {server} / {count}');
 assert.equal(payload.embeds[0].description,'Custom greeting The Blacklisted / 1234');
 assert.equal(payload.components[0].components.length,1);
 assert.match(payload.components[0].components[0].url,/\/rules$/);
 member.guild.channels.fetch=async()=>{throw Error('Unavailable');};
 const fallback=await makeWelcome(member,'Welcome');assert.deepEqual(fallback.components,[]);
});

test('welcome falls back to text without Embed Links and refuses missing send access',async()=>{
 const member=makeMember(),sent=[];
 const channel={permissionsFor:()=>perms(P.ViewChannel,P.SendMessages),send:async p=>sent.push(p)};
 await sendWelcome(channel,member,'Welcome {user}');assert.equal(sent[0].embeds,undefined);assert.match(sent[0].content,/Welcome/);
 channel.permissionsFor=()=>perms(P.ViewChannel,P.SendMessages,P.EmbedLinks);
 await sendWelcome(channel,member,'Welcome');assert.ok(sent[1].embeds);
 channel.permissionsFor=()=>perms(P.ViewChannel);await assert.rejects(sendWelcome(channel,member,'Welcome'),/cannot post/);
 assert.equal(sent.length,2);
});

test('/welcome previews the same card privately and keeps custom greeting',async()=>{
 const actor=makeMember();actor.permissions=perms(P.ManageGuild);
 const replies=[];
 const i={commandName:'welcome',guild:actor.guild,options:{getString:()=>null},editReply:async p=>replies.push(p)};
 const tools=createStaffTools({store:{get:()=>({welcomeText:'Our custom hello, {user}!'})},env:{}});
 await tools(i,actor);
 assert.match(replies[0].embeds[0].description,/Our custom hello/);
 assert.deepEqual(replies[0].allowedMentions,{parse:[]});
});
