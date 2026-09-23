import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { canTarget, safeRole } from '../src/security.js';
import { commands } from '../src/commands.js';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('SQLite values persist across restarts and support replacement',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mara-test-')); const path=join(dir,'test.sqlite');
  try { let s=createStore(path); assert.equal(s.get('missing',0),0); s.set('warnings',[{reason:'test'}]); s.close(); s=createStore(path); assert.deepEqual(s.get('warnings'),[{reason:'test'}]); s.set('warnings',[]); assert.deepEqual(s.get('warnings'),[]); s.close(); } finally { rmSync(dir,{recursive:true}); }
});
const member=(id,position,bot=false)=>({id,user:{bot},roles:{highest:{position,comparePositionTo(other){return position-other.position;}}}});
test('Moderation protects self, owner, bots, and equal/higher roles',()=>{
  const a=member('staff',5);
  assert.equal(canTarget(a,member('member',1),'owner'),true);
  for(const target of [member('staff',1),member('owner',1),member('peer',5),member('higher',6),member('bot',1,true)]) assert.equal(canTarget(a,target,'owner'),false);
  assert.equal(canTarget(member('owner',1),member('staff',5),'owner'),true);
});
test('Self-assigned roles reject privilege and unmanageable roles',()=>{
  const role={id:'role',guild:{id:'guild'},managed:false,editable:true,position:1,permissions:new PermissionsBitField()};
  const me=member('mara',5);
  assert.equal(safeRole(role,me),true);
  for(const p of [P.Administrator,P.ManageRoles,P.BanMembers,P.ModerateMembers,P.ManageWebhooks,P.MentionEveryone]) assert.equal(safeRole({...role,permissions:new PermissionsBitField(p)},me),false);
  assert.equal(safeRole({...role,managed:true},me),false);
  assert.equal(safeRole({...role,position:6},me),false);
  assert.equal(safeRole({...role,id:'guild'},me),false);
});
test('Commands are unique, guild-only, and staff commands default restricted',()=>{
  assert.equal(new Set(commands.map(c=>c.name)).size,commands.length);
  for(const c of commands) { assert.equal(c.dm_permission,false); let optional=false; for(const o of c.options){if(!o.required)optional=true; if(optional)assert.notEqual(o.required,true);} }
  for(const name of ['warn','warnings','timeout','kick','ban','purge','announce','panel','rolepanel','custom-set','custom-delete','automod','ai-summary']) assert.ok(commands.find(c=>c.name===name).default_member_permissions);
});
