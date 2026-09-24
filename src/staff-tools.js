import { publicRulesPanel } from './rules.js';
import { styleChannel, styleChannels } from './channel-style.js';
import { PermissionFlagsBits as P, escapeMarkdown } from 'discord.js';
import { config, saveConfig, welcomeText } from './config.js';
import { settings, validateAutomod } from './automod.js';
import { canTarget } from './security.js';
const clean=value=>escapeMarkdown(String(value));
export function caseText(c) {
  return '#'+c.id+' • '+c.type+(c.revoked?' (revoked)':'')+'\nMember: '+c.target+' • Staff: '+c.actor+'\n'+c.created+'\n'+clean(c.reason)+(c.revoked?'\nRevoked by '+c.revoked_by+': '+clean(c.revoke_reason):'');
}
export function createStaffTools({store,env,audit,backupNow,verification,tickets}) {
  const admin=['rules','config','welcome','protection','verification','verification-review','raid','escalation','backup','ticket-categories','ai-context'];
  return async (i,actor)=>{
    const n=i.commandName,o=i.options,s=name=>o.getString(name,true);
    if(admin.includes(n)&&!actor.permissions.has(P.ManageGuild)) throw Error('Manage Server is required.');
    const save=patch=>saveConfig(store,patch,i.guild,actor,env);
    let result;
    if(n==='rules') {
      const text=o.getString('text');
      if(text!==null) {
        await save({publicRules:text});
        await audit(i.guild,'Public rules updated by '+actor.id);
      }
      await i.editReply(publicRulesPanel(config(store))); return true;
    }
    else if(n==='channel-style-bulk') { await styleChannels(i,actor,audit); return true; }
    else if(n==='channel-style') result=await styleChannel(i,actor,audit);
    else if(n==='config') { await save({[s('setting')]:s('id')==='-'?'':s('id')}); result='Saved. This setting takes effect immediately and overrides the Railway value. Run /setup-check to verify it.'; }
    else if(n==='welcome') {
      if(o.getString('text')) await save({welcomeText:s('text')});
      result='Welcome preview:\n'+welcomeText(config(store).welcomeText,actor);
    }
    else if(n==='protection') {
      const patch={};
      for(const [option,key] of [['repeats','repeatEnabled'],['suspicious-links','blockSuspiciousLinks']]) if(o.getBoolean(option)!==null) patch[key]=o.getBoolean(option);
      for(const [option,key] of [['blocked-domains','blockedDomains'],['exempt-channels','exemptChannels']]) if(o.getString(option)!==null) patch[key]=s(option)==='-'?[]:s(option).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
      store.set('automod',{...settings(store),...validateAutomod(patch)});
      result='Protection settings saved. /automod must be enabled for message rules to run.';
    }
    else if(n==='verification') {
      const patch={}; if(o.getInteger('minimum-days')!==null) patch.minAccountDays=o.getInteger('minimum-days');
      if(o.getBoolean('captcha')!==null) patch.captcha=o.getBoolean('captcha');
      if(o.getString('rules')!==null) patch.verificationRules=o.getString('rules');
      await save(patch); const cfg=config(store);
      result='Minimum account age: '+cfg.minAccountDays+' days. CAPTCHA: '+(cfg.captcha?'on':'off')+'.';
    }
    else if(n==='verification-review') {
      const target=await i.guild.members.fetch(o.getUser('user',true).id);
      if(!store.get('verify-review:'+target.id)) throw Error('This member has no pending review request.');
      if(s('action')==='approve') result=await verification.grant(target,{staff:true,actor:actor.id});
      else { store.delete('verify-review:'+target.id); result='Verification review denied.'; }
      await audit(i.guild,'Verification review '+s('action')+' | member '+target.id+' | staff '+actor.id+'\n'+s('reason'));
    }
    else if(n==='raid') {
      const patch={}; if(o.getString('action')) patch.raidAction=s('action');
      for(const [option,key] of [['joins','raidJoins'],['seconds','raidSeconds'],['pause-minutes','raidHoldMinutes']]) if(o.getInteger(option)!==null) patch[key]=o.getInteger(option);
      await save(patch); if(o.getBoolean('resume')) store.set('raid:pausedUntil',0);
      const cfg=config(store); result='Raid response: '+cfg.raidAction+' at '+cfg.raidJoins+' joins in '+cfg.raidSeconds+' seconds.';
    }
    else if(n==='escalation') {
      await save({warningThreshold:o.getInteger('warnings',true),...(o.getInteger('minutes')!==null?{warningTimeoutMinutes:o.getInteger('minutes')}:{})});
      result='Warning escalation updated. It runs on new warnings only; 0 disables it.';
    }
    else if(n==='ticket-categories') { await save({ticketCategories:s('names').split(',').map(x=>x.trim()).filter(Boolean)}); result='Ticket categories saved. Existing ticket panels use the updated categories when opened.'; }
    else if(n==='ai-context') { await save({aiContextReview:o.getBoolean('enabled',true)}); result='AI contextual review updated. Only allowlisted AI channels are eligible; AI must also be enabled.'; }
    else if(n==='backup') result='Backup saved: '+await backupNow()+'. It is on the data volume; download it through Railway for an off-volume copy.';
    else if(['case','history','warn-remove'].includes(n)) {
      if(!actor.permissions.has(P.ModerateMembers)) throw Error('Moderate Members is required.');
      if(n==='history') result=store.cases({target:o.getUser('user',true).id,before:o.getInteger('before')||undefined,limit:10}).map(c=>caseText(c).slice(0,175)).join('\n\n')||'No cases. Use before:<oldest case number> for the next page.';
      else {
        const c=store.case(o.getInteger('number',true)); if(!c) throw Error('Case not found.');
        if(n==='case') result=caseText(c);
        else {
          const target=await i.guild.members.fetch(c.target).catch(()=>null);
          if(c.target===actor.id||c.target===i.guild.ownerId||(!target&&actor.id!==i.guild.ownerId)||(target&&!canTarget(actor,target,i.guild.ownerId))) throw Error('You cannot revoke this member’s warning. For departed members, ask the server owner.');
          if(!store.revokeWarning(c.id,actor.id,s('reason'))) throw Error('This case is not an active warning.');
          await audit(i.guild,'Warning #'+c.id+' revoked by '+actor.id+'\n'+s('reason')); result='Warning #'+c.id+' revoked. The history is retained.';
        }
      }
    }
    else if(n==='unban') {
      if(!actor.permissions.has(P.BanMembers)) throw Error('Ban Members is required.');
      if(!/^\d{17,20}$/.test(s('id'))) throw Error('Enter a valid user ID.');
      await i.guild.bans.remove(s('id'),(actor.id+': '+s('reason')).slice(0,512));
      const number=store.addCase({type:'unban',target:s('id'),actor:actor.id,reason:s('reason')});
      await audit(i.guild,'Unban case #'+number+' | member '+s('id')+' | staff '+actor.id+'\n'+s('reason')); result='Unbanned. Case #'+number+'.';
    }
    else if(n==='ticket-claim') { await tickets.claim(i,actor); return true; }
    else if(n==='ticket-transcript') { await i.editReply({files:[await tickets.transcript(i,actor)]}); return true; }
    else if(n==='ticket-ai') { await tickets.assist(i,actor,s('mode')); return true; }
    else if(n==='ticket-feedback') { await tickets.feedback(i); return true; }
    else return false;
    await i.editReply({content:result.slice(0,2000),allowedMentions:{parse:[]}}); return true;
  };
}
