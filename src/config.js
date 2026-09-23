import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { verificationProblem } from './setup-check.js';
export const defaultConfig = {
  welcomeText: 'Welcome {user} to **{server}**! I’m Mara. Read the rules and use the verification panel to get started.',
  verificationRules: "1. Treat everyone with respect. No harassment, bullying, threats, or hate speech.\n2. No spam, disruptive flooding, scams, malicious links, or unsolicited advertising.\n3. Protect privacy. Do not share anyone’s personal information without permission.\n4. Keep content appropriate. No sexual content, graphic violence, or illegal content.\n5. Use the correct channels and follow their topics.\n6. Follow Discord’s Terms of Service and Community Guidelines.\n7. Follow staff directions. Raise concerns respectfully through a private ticket.",
  minAccountDays: 0, captcha: false, warningThreshold: 0, warningTimeoutMinutes: 10,
  raidAction: 'off', raidJoins: 8, raidSeconds: 20, raidHoldMinutes: 10,
  ticketCategories: ['General support','Member report','Appeal'], aiContextReview: false
};
export const configurableIds = ['LOG_CHANNEL_ID','WELCOME_CHANNEL_ID','VERIFIED_ROLE_ID','STAFF_ROLE_ID','TICKET_CATEGORY_ID'];
export function config(store) { return {...defaultConfig,...store.get('config',{})}; }
export function runtimeEnv(store, env) {
  return new Proxy(env,{get(target,key){ const saved=store.get('config',{}); return configurableIds.includes(key) && Object.hasOwn(saved,key) ? saved[key] : target[key]; }});
}
export function validateConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('Settings must be an object.');
  const result={};
  const numbers={minAccountDays:[0,365],warningThreshold:[0,20],warningTimeoutMinutes:[1,40320],raidJoins:[3,100],raidSeconds:[5,300],raidHoldMinutes:[1,60]};
  for (const [key,value] of Object.entries(patch)) {
    if (configurableIds.includes(key)) { if(typeof value!=='string'||(value!==''&&!/^\d{17,20}$/.test(value))) throw Error('Use a valid Discord ID for '+key); }
    else if (Object.hasOwn(numbers,key)) { const [min,max]=numbers[key]; if(!Number.isInteger(value)||value<min||value>max) throw Error(key+' is outside its allowed range.'); }
    else if (['captcha','aiContextReview'].includes(key)) { if(typeof value!=='boolean') throw Error(key+' must be true or false.'); }
    else if (key==='raidAction') { if(!['off','alert','pause-verification'].includes(value)) throw Error('Invalid raid action.'); }
    else if (key==='verificationRules') { if(typeof value!=='string'||!value.trim()||value.length>1500) throw Error('Rules must contain 1–1500 characters.'); }
    else if (key==='welcomeText') { if(typeof value!=='string'||!value.trim()||value.length>1500) throw Error('Welcome text must contain 1–1500 characters.'); }
    else if (key==='ticketCategories') { if(!Array.isArray(value)||!value.length||value.length>10||new Set(value).size!==value.length||value.some(v=>typeof v!=='string'||!v.trim()||v.length>60)) throw Error('Use 1–10 unique category names of 1–60 characters.'); }
    else throw Error('Unknown setting: '+key);
    result[key]=value;
  }
  return result;
}
export async function saveConfig(store,patch,guild,actor,env) {
  const clean=validateConfig(patch), me=await guild.members.fetchMe();
  for (const key of configurableIds) {
    if (!clean[key]) continue;
    if (key.endsWith('CHANNEL_ID') || key==='TICKET_CATEGORY_ID') {
      const ch=await guild.channels.fetch(clean[key]);
      const type=key==='TICKET_CATEGORY_ID'?ChannelType.GuildCategory:ChannelType.GuildText;
      if(!ch||ch.type!==type||!ch.permissionsFor(actor)?.has(P.ViewChannel)||!ch.permissionsFor(me)?.has(P.ViewChannel)) throw Error('Channel is inaccessible or has the wrong type: '+key);
    } else {
      const role=await guild.roles.fetch(clean[key]);
      if(!role||role.id===guild.id) throw Error('Select an existing role other than @everyone.');
      if(key==='VERIFIED_ROLE_ID') { const issue=verificationProblem(role,me); if(issue) throw Error(issue); }
    }
  }
  if(clean.captcha && !(env.DASHBOARD_ENABLED==='true'&&env.PUBLIC_BASE_URL&&env.DISCORD_CLIENT_SECRET&&env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET_KEY)) throw Error('Configure the HTTPS dashboard and Turnstile credentials before enabling CAPTCHA.');
  store.set('config',{...store.get('config',{}),...clean});
  return config(store);
}
export function welcomeText(template, member) {
  return template.replace(/\{(user|server|count)\}/g,(_,key)=>({user:'<@'+member.id+'>',server:member.guild.name,count:String(member.guild.memberCount)}[key])).slice(0,2000);
}
