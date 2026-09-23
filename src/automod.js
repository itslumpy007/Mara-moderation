import { PermissionFlagsBits as P } from 'discord.js';

export const defaults = { enabled: false, action: 'log', blockInvites: false, mentionLimit: 5, spamLimit: 6, blockedWords: [] };
export function settings(store) { return { ...defaults, ...store.get('automod', {}) }; }
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '');

export function createAutomod({ store, env, audit, ai, now = Date.now }) {
  const recent = new Map();
  return async function moderate(message, { edited = false } = {}) {
    const config = settings(store);
    if (!config.enabled || message.guild?.id !== env.GUILD_ID || !message.author || message.author.bot || message.webhookId || message.channelId === env.LOG_CHANNEL_ID) return;
    const member = message.member || await message.guild.members.fetch(message.author.id);
    if (member.id === message.guild.ownerId || member.permissions.has(P.ManageMessages) || member.roles.cache.has(env.STAFF_ROLE_ID)) return;
    const content = normalize(message.content || '');
    const reasons = [];
    const time = now();
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
    } catch { console.warn('AI review unavailable; local automod remains active.'); }
  };
}
