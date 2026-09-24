import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBuilder, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { publicRulesPanel, postRulesPanel, defaultRules } from '../src/rules.js';
import { defaultConfig, validateConfig, config } from '../src/config.js';
import { commands } from '../src/commands.js';

test('default rules fit configuration limits and produce seven readable sections',()=>{
 assert.equal(defaultConfig.verificationRules,defaultRules);
 assert.deepEqual(validateConfig({verificationRules:defaultRules}),{verificationRules:defaultRules});
 const panel=publicRulesPanel(defaultConfig);
 new EmbedBuilder(panel.embeds[0]).toJSON();
 assert.equal(panel.embeds[0].fields.length,7);
 assert.equal(panel.components[0].components[0].custom_id,'verify');
 // Decorative text symbols such as ✦ are not valid Discord button emoji.
 assert.equal(panel.components[0].components[0].emoji,undefined);
 assert.equal(panel.components[0].components[0].label,'Read & accept the rules');
 assert.deepEqual(panel.allowedMentions,{parse:[]});
});

test('custom saved rules remain unchanged in the public card and verification config',()=>{
 const text='Custom rules: be kind. @everyone';
 const settings=config({get:()=>({verificationRules:text})});
 const panel=publicRulesPanel(settings);
 assert.equal(panel.embeds[0].description,text);
 assert.equal(panel.embeds[0].fields,undefined);
 assert.equal(settings.verificationRules,text);
 assert.throws(()=>publicRulesPanel({verificationRules:''}),/Set server rules/);
});

function fixture({preview=false,admin=true,canPost=true,canEmbed=true}={}) {
 const replies=[],posts=[];
 const actor={permissions:new PermissionsBitField(admin?[P.ManageGuild]:[])},me={};
 const channel={permissionsFor:member=>new PermissionsBitField(member===actor?(canPost?[P.ViewChannel,P.SendMessages]:[]):(canEmbed?[P.ViewChannel,P.SendMessages,P.EmbedLinks]:[P.ViewChannel,P.SendMessages])),send:async p=>posts.push(p)};
 const i={options:{getBoolean:()=>preview},editReply:async p=>replies.push(p)};
 return {replies,posts,run:()=>postRulesPanel(i,channel,actor,me,defaultConfig)};
}

test('rules panel preview never posts and disables the acceptance entry button',async()=>{
 const f=fixture({preview:true});assert.equal(await f.run(),false);
 assert.equal(f.posts.length,0);assert.equal(f.replies.length,1);
 assert.equal(f.replies[0].components[0].components[0].disabled,true);
});

test('rules panel posts only with required actor and bot permissions',async()=>{
 const f=fixture();assert.equal(await f.run(),true);assert.equal(f.posts.length,1);
 assert.equal(f.posts[0].components[0].components[0].disabled,undefined);
 for(const options of [{admin:false},{canPost:false},{canEmbed:false}]) {
  const denied=fixture(options);await assert.rejects(denied.run());assert.equal(denied.posts.length,0);
 }
 assert.ok(commands.find(c=>c.name==='panel').options.find(o=>o.name==='kind').choices.some(c=>c.value==='rules'));
});
