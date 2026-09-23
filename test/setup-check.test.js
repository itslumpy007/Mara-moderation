import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionsBitField, PermissionFlagsBits as P, EmbedBuilder } from 'discord.js';
import { verificationProblem, setupCheck } from '../src/setup-check.js';
import { commands } from '../src/commands.js';

const bot = () => ({permissions:new PermissionsBitField([P.ManageRoles,P.ViewChannel,P.SendMessages,P.EmbedLinks]),roles:{highest:{comparePositionTo:r=>5-r.position}}});
const role = () => ({id:'role',guild:{id:'guild'},managed:false,editable:true,position:1,permissions:new PermissionsBitField()});

test('verification explains missing roles, bot permissions, hierarchy and privileged roles',()=>{
  assert.match(verificationProblem(null,bot()),/VERIFIED_ROLE_ID/);
  assert.match(verificationProblem(role(),{...bot(),permissions:new PermissionsBitField()}),/Manage Roles/);
  assert.match(verificationProblem({...role(),position:5},bot()),/above/);
  assert.match(verificationProblem({...role(),managed:true},bot()),/integration/);
  assert.match(verificationProblem({...role(),permissions:new PermissionsBitField(P.BanMembers)},bot()),/moderation permissions/);
  assert.equal(verificationProblem(role(),bot()),null);
});

test('setup check handles deleted/inaccessible channels and roles without leaking secrets',async()=>{
  const guild={channels:{fetch:async()=>{throw Error('not found');}},roles:{fetch:async()=>null,everyone:{}}};
  const card=await setupCheck(guild,{LOG_CHANNEL_ID:'123',VERIFIED_ROLE_ID:'456',DISCORD_TOKEN:'test-secret'},bot());
  new EmbedBuilder(card).toJSON();
  assert.match(card.fields[0].value,/LOG_CHANNEL_ID/);
  assert.match(card.fields[2].value,/VERIFIED_ROLE_ID/);
  assert.equal(JSON.stringify(card).includes('test-secret'),false);
});

test('setup check detects public logs, missing embeds and distinguishes volume configuration from attachment',async()=>{
  const everyone={id:'guild'};
  const channel={id:'123',type:ChannelType.GuildText,permissionsFor:m=>new PermissionsBitField(m===everyone?[P.ViewChannel]:[P.ViewChannel,P.SendMessages])};
  const guild={channels:{fetch:async()=>channel},roles:{fetch:async()=>role(),everyone}};
  const card=await setupCheck(guild,{LOG_CHANNEL_ID:'123',WELCOME_CHANNEL_ID:'123',VERIFIED_ROLE_ID:'role',RAILWAY_ENVIRONMENT_ID:'railway',DATA_DIR:'/data'},bot());
  assert.match(card.fields[0].value,/EmbedLinks/);
  assert.match(card.fields[0].value,/@everyone/);
  assert.match(card.fields.at(-1).value,/Confirm a volume/);
});

test('new commands default to the appropriate staff permissions',()=>{
  assert.equal(commands.find(c=>c.name==='setup-check').default_member_permissions,String(P.ManageGuild));
  assert.equal(commands.find(c=>c.name==='untimeout').default_member_permissions,String(P.ModerateMembers));
});
