import { PermissionFlagsBits as P } from 'discord.js';
import { config as serverConfig } from './config.js';

export const defaults = { enabled: false, action: 'log', blockInvites: false, mentionLimit: 5, spamLimit: 6, blockedWords: [], repeatLimit:3, repeatEnabled:false, blockedDomains:[], blockSuspiciousLinks:false, exemptChannels:[] };
export function settings(store) { return { ...defaults, ...store.get('automod', {}) }; }
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '');

export function createAutomod({ store, env, audit, ai, now = Date.now }) {
  const recent = new Map();
  const repeats = new Map();
  return async function moderate(message, { edited = false } = {}) {
    const config = settings(store);
    if (!config.enabled || message.guild?.id !== env.GUILD_ID || !message.author || message.author.bot || message.webhookId || message.channelId === env.LOG_CHANNEL_ID || config.exemptChannels.includes(message.channelId) || config.exemptChannels.includes(message.channel?.parentId)) return;
    const member = message.member || await message.guild.members.fetch(message.author.id);
    if (member.id === message.guild.ownerId || member.permissions.has(P.ManageMessages) || member.roles.cache.has(env.STAFF_ROLE_ID)) return;
    const content = normalize(message.content || '');
    const reasons = [];
    const time = now();
    for(const [id,items] of repeats) if(items.at(-1).time<=time-30000) repeats.delete(id);
    if(!edited&&content.trim()&&config.repeatEnabled) {
      const items=(repeats.get(member.id)||[]).filter(x=>x.time>time-30000);
      items.push({text:content,time}); repeats.set(member.id,items.slice(-30));
      if(items.filter(x=>x.text===content).length>=config.repeatLimit) reasons.push('repeated message');
      if(repeats.size>10000) repeats.delete(repeats.keys().next().value);
    }
    if(linkViolations(content,config).length) reasons.push(...linkViolations(content,config));
    for (const [key, entries] of recent) if (entries.at(-1) <= time - 10000) recent.delete(key);
    if (!edited) {
      const entries = (recent.get(member.id) || []).filter(t => t > time - 10000);
      entries.push(time);
      recent.set(member.id, entries.slice(-config.spamLimit));
      if (entries.length >= config.spamLimit) reasons.push('message flood');
      if (recent.size > 10000) recent.delete(recent.keys().next().value);
    }
    if (message.mentions?.everyone || (message.mentions?.users.size || 0) + (message.mentions?.roles.size || 0) >= config.mentionLimit) reasons.push('mass mentions');
    if (config.blockInvites && /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i.test(content)) reasons.push('Discord invite');
    if (config.blockedWords.some(word => content.includes(normalize(word)))) reasons.push('blocked word or phrase');
    if (reasons.length) {
      let outcome = 'logged only';
      if (config.action === 'delete') {
        try { await message.delete(); outcome = 'deleted'; }
        catch { outcome = 'deletion failed; check Manage Messages permission'; }
      }
      await audit(message.guild, `AUTOMOD | ${outcome} | member ${member.id} | channel ${message.channelId} | message ${message.id}\n${reasons.join(', ')}`);
      return;
    }
    if (!content.trim() || !ai.canReview(message.channelId)) return;
    try {
      const result = await ai.review(message.content);
      if (result?.flagged) await audit(message.guild, `AI REVIEW — staff decision required | member ${member.id} | ${message.url}\nCategories: ${Object.entries(result.categories).filter(([, value]) => value === true).map(([key]) => key).join(', ')}\nNo automatic punishment applied.`);
      if(result?.flagged&&serverConfig(store).aiContextReview&&ai.contextReview) {
        const context=await message.channel.messages.fetch({limit:6});
        const text=[...context.values()].filter(m=>!m.author.bot).reverse().map(m=>m.author.id+': '+m.content).join('\n').slice(0,4000);
        const draft=await ai.contextReview(text);
        await audit(message.guild,'AI context review | '+message.url+'\n'+draft+'\nStaff decision required; no punishment applied.');
      }
    } catch { console.warn('AI review unavailable; local automod remains active.'); }
  };
}

export function linkViolations(content,config) {
  const reasons=new Set();
  for(const raw of content.match(/(?:https?:\/\/|www\.)[^\s<>]+/gi)||[]) {
    try {
      const url=new URL(raw.startsWith('www.')?'https://'+raw:raw), host=url.hostname.toLowerCase();
      if(config.blockedDomains.some(d=>host===d||host.endsWith('.'+d))) reasons.add('blocked link domain');
      if(config.blockSuspiciousLinks&&(url.username||url.password||host.includes('xn--')||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host))) reasons.add('suspicious link structure');
    } catch { if(config.blockSuspiciousLinks) reasons.add('malformed link'); }
  }
  return [...reasons];
}
export function validateAutomod(patch) {
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) throw Error('Automod settings must be an object.');
  const ranges={mentionLimit:[2,50],spamLimit:[3,30],repeatLimit:[2,10]};
  const result={};
  for(const [key,value] of Object.entries(patch)) {
    if(['enabled','blockInvites','repeatEnabled','blockSuspiciousLinks'].includes(key)) { if(typeof value!=='boolean') throw Error('Expected true or false for '+key); }
    else if(Object.hasOwn(ranges,key)) { const [min,max]=ranges[key]; if(!Number.isInteger(value)||value<min||value>max) throw Error('Invalid limit for '+key); }
    else if(key==='action') { if(!['log','delete'].includes(value)) throw Error('Invalid action.'); }
    else if(['blockedWords','blockedDomains','exemptChannels'].includes(key)) {
      if(!Array.isArray(value)||value.length>100||value.some(x=>typeof x!=='string'||!x.length||x.length>100)) throw Error('Use a list of at most 100 entries for '+key);
      if(key==='exemptChannels'&&value.some(x=>!/^\d{17,20}$/.test(x))) throw Error('Use channel IDs for exemptions.');
      if(key==='blockedDomains'&&value.some(x=>!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(x))) throw Error('Use lowercase domain names without https://.');
    } else throw Error('Unknown automod setting: '+key);
    result[key]=value;
  }
  return result;
}
