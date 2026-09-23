import { createHash } from 'node:crypto';
import { config } from './config.js';
import { verificationProblem } from './setup-check.js';
export function verificationGate(member,settings,pausedUntil=0,now=Date.now()) {
  if(pausedUntil>now) return 'Verification is temporarily paused after a join spike. Staff can review your request.';
  if(now-member.user.createdTimestamp<settings.minAccountDays*86400000) return 'Your Discord account must be at least '+settings.minAccountDays+' days old. Staff can review your request.';
  return null;
}
export function createVerification({store,env,audit}) {
  const locks=new Set();
  async function grant(member,{staff=false,actor='self',captchaPassed=false}={}) {
    if(locks.has(member.id)) throw Error('Verification is already being processed.');
    locks.add(member.id);
    try {
      const cfg=config(store), guild=member.guild;
      const role=await guild.roles.fetch(env.VERIFIED_ROLE_ID||'0').catch(()=>null);
      const problem=verificationProblem(role,await guild.members.fetchMe()); if(problem) throw Error(problem);
      if(member.roles.cache.has(role.id)) return 'You are already verified.';
      if(!staff) {
        const gate=verificationGate(member,cfg,store.get('raid:pausedUntil',0)); if(gate) throw Error(gate);
        if(cfg.captcha&&!captchaPassed) throw Error('Complete the verification challenge first.');
      }
      await member.roles.add(role,staff?'Staff verification approval by '+actor:'Accepted rules and completed verification');
      store.delete('verify-review:'+member.id);
      store.addCase({type:'verify',target:member.id,actor,reason:staff?'Staff approved verification':'Rules accepted'+(captchaPassed?' and CAPTCHA completed':'')});
      await audit(guild,'Rules accepted: '+member.user.tag+' | '+member.id);
      return 'You’re verified. Welcome to The Blacklisted.';
    } finally {locks.delete(member.id);}
  }
  return {grant, async request(member) {
    const key='verify-review:'+member.id;
    if(store.get(key)?.status==='pending') return 'Your request is already waiting for staff.';
    store.set(key,{status:'pending',created:Date.now()});
    await audit(member.guild,'Verification review requested for '+member.id);
    return 'Your verification review is waiting for staff. Use /verification-review to check it (staff only).';
  }};
}

export function rulesVersion(text='') {
  return createHash('sha256').update(text).digest('hex').slice(0,24);
}
export function rulesCard(settings) {
  if(!settings.verificationRules?.trim()) throw Error('Server rules are not configured yet. Ask staff to set /verification rules.');
  return {embeds:[{color:0x9B7BDA,title:'Before you join • Server rules',description:settings.verificationRules,footer:{text:'Read the rules, then accept to continue.'}}],components:[{type:1,components:[{type:2,style:3,label:'I accept the rules',custom_id:'verify-accept:'+rulesVersion(settings.verificationRules)}]}],allowedMentions:{parse:[]}};
}
