import test from 'node:test';
import assert from 'node:assert/strict';
import {panelTargetId} from '../src/panel-target.js';
import {commands} from '../src/commands.js';
const fixture=(selected=null,raw=null)=>({channelId:'1552527993572823091',options:{getChannel:()=>selected,getString:()=>raw}});
test('panel supports current channel, selected channel and exact ID or mention',()=>{
 assert.equal(panelTargetId(fixture()),'1552527993572823091');
 assert.equal(panelTargetId(fixture({id:'123456789012345678'})),'123456789012345678');
 for(const raw of ['1552527993572823091',' <#1552527993572823091> ']) assert.equal(panelTargetId(fixture(null,raw)),'1552527993572823091');
});
test('panel rejects ambiguous destinations and malformed IDs',()=>{
 assert.throws(()=>panelTargetId(fixture({id:'123'},'1552527993572823091')),/not both/);
 for(const raw of ['','rules','123','@everyone','1552527993572823091junk']) assert.throws(()=>panelTargetId(fixture(null,raw)),/valid channel ID/);
});
test('panel requires kind while destination options are optional',()=>{
 const options=commands.find(c=>c.name==='panel').options;
 assert.equal(options[0].name,'kind');assert.equal(options[0].required,true);
 for(const name of ['channel','channel-id']) assert.equal(options.find(o=>o.name===name).required,false);
});
