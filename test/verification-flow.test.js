import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesCard, rulesVersion } from '../src/verification.js';
import { defaultConfig, validateConfig } from '../src/config.js';
test('verification displays configured rules and acceptance is bound to their version',()=>{
 const card=rulesCard(defaultConfig);
 assert.equal(card.embeds[0].description,defaultConfig.verificationRules);
 assert.equal(card.components[0].components[0].custom_id,'verify-accept:'+rulesVersion(defaultConfig.verificationRules));
 assert.notEqual(rulesVersion('old rules'),rulesVersion('new rules'));
 assert.throws(()=>rulesCard({verificationRules:''}),/not configured/);
 assert.deepEqual(validateConfig({verificationRules:'Custom rules'}),{verificationRules:'Custom rules'});
 for(const verificationRules of ['', 'a'.repeat(1501), 12]) assert.throws(()=>validateConfig({verificationRules}));
});

test('new members receive Unverified and verification removes it, with cleanup retry',async()=>{
 const { createVerification }=await import('../src/verification.js');
 const { PermissionsBitField, PermissionFlagsBits:P }=await import('discord.js');
 const cache=new Map(),changes=[];
 const roles=Object.fromEntries(['verified','unverified'].map(id=>[id,{id,guild:{id:'g'},managed:false,editable:true,permissions:new PermissionsBitField()}]));
 let failRemoval=false;
 const member={id:'u',user:{tag:'User',createdTimestamp:0,bot:false},guild:{roles:{fetch:async id=>roles[id]},members:{fetchMe:async()=>({permissions:new PermissionsBitField(P.ManageRoles),roles:{highest:{comparePositionTo:()=>1}}})}},roles:{cache,add:async role=>{cache.set(role.id,role);changes.push('add:'+role.id);},remove:async role=>{if(failRemoval)throw Error('remove failed');cache.delete(role.id);changes.push('remove:'+role.id);}}};
 const store={get:(_,fallback)=>fallback,delete:()=>{},addCase:()=>{}};
 const verify=createVerification({store,env:{VERIFIED_ROLE_ID:'verified',UNVERIFIED_ROLE_ID:'unverified'},audit:async()=>{}});
 await verify.assignUnverified(member);await verify.assignUnverified(member);
 assert.deepEqual(changes,['add:unverified']);
 failRemoval=true;await assert.rejects(verify.grant(member),/remove failed/);
 assert.equal(cache.has('verified'),true);assert.equal(cache.has('unverified'),true);
 failRemoval=false;await verify.grant(member);
 assert.equal(cache.has('unverified'),false);
 await verify.assignUnverified(member);assert.equal(cache.has('unverified'),false);
 cache.clear();member.user.bot=true;await verify.assignUnverified(member);assert.equal(cache.size,0);
 member.user.bot=false;
 const invalid=createVerification({store,env:{VERIFIED_ROLE_ID:'verified',UNVERIFIED_ROLE_ID:'verified'},audit:async()=>{}});
 await assert.rejects(invalid.assignUnverified(member),/different roles/);
});
