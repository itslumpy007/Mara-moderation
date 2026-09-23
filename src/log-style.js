import { escapeMarkdown } from 'discord.js';

const themes = {
  JOIN: ['Member joined', 0x57C99B, '🟢'],
  LEAVE: ['Member left', 0x95A1B5, '↗️'],
  WARN: ['Warning issued', 0xF2C66D, '⚠️'],
  TIMEOUT: ['Member timed out', 0xEDA46B, '⏳'],
  UNTIMEOUT: ['Timeout removed', 0x57C99B, '✅'],
  KICK: ['Member kicked', 0xEC9279, '🚪'],
  BAN: ['Member banned', 0xE86F86, '🔨'],
  PURGE: ['Messages cleared', 0x7AA9EB, '🧹'],
  DELETE: ['Message deleted', 0xE86F86, '🗑️'],
  EDIT: ['Message edited', 0x7AA9EB, '✏️'],
  AUTOMOD: ['Automod detection', 0xF2C66D, '🛡️'],
  'AI REVIEW': ['AI review requested', 0xB395E8, '🔎'],
  'PRIVATE REPORT': ['Member report', 0xECA4C5, '📩'],
  VERIFIED: ['Rules accepted', 0x57C99B, '✅'],
  TICKET: ['Ticket activity', 0x7AA9EB, '🎫'],
  SETUP: ['Server update', 0x9B7BDA, '📌']
};

export function logCard(text, avatarURL) {
  const firstBreak = text.indexOf('\n');
  const header = firstBreak < 0 ? text : text.slice(0, firstBreak);
  const body = firstBreak < 0 ? '' : text.slice(firstBreak + 1);
  const parts = header.split(' | ');
  let type = parts[0];
  if (type.startsWith('AI REVIEW')) type = 'AI REVIEW';
  if (header.startsWith('Rules accepted:')) type = 'VERIFIED';
  if (header.startsWith('Ticket ')) type = 'TICKET';
  const [title, color, icon] = themes[type] || themes.SETUP;
  const fields = [];
  const safe = value => escapeMarkdown(String(value)).slice(0, 1024) || '—';
  const field = (name, value, inline = true) => fields.push({ name, value: safe(value), inline });
  const member = (name, id) => fields.push({ name, value: /^\d+$/.test(id) ? `<@${id}>\n\`${id}\`` : safe(id), inline: true });
  let description;

  if (['WARN','TIMEOUT','UNTIMEOUT','KICK','BAN'].includes(type)) {
    member('Member', parts[1].replace('target ', ''));
    member('Moderator', parts[2].replace('staff ', ''));
    field('Reason', parts.slice(3).join(' | '), false);
  } else if (type === 'JOIN' || type === 'LEAVE') {
    member('Member', parts.at(-1));
    field('Username', parts.slice(1,-1).join(' | '));
  } else if (type === 'PURGE') {
    member('Moderator', parts[1]);
    fields.push({ name:'Channel', value:`<#${parts[2]}>`, inline:true });
    field('Removed', parts.slice(3).join(' | '));
  } else if (['DELETE','EDIT','AUTOMOD','AI REVIEW','PRIVATE REPORT'].includes(type)) {
    for (const part of parts.slice(1)) {
      const match = /^(channel|member|target|staff|reporter|author|message) (.+)$/.exec(part);
      if (!match) { field(type === 'AI REVIEW' ? 'Message link' : 'Outcome', part, false); continue; }
      const [, key, value] = match;
      if (['member','target','staff','reporter','author'].includes(key)) member(key[0].toUpperCase()+key.slice(1), value);
      else if (key === 'channel' && /^\d+$/.test(value)) fields.push({ name:'Channel', value:`<#${value}>`, inline:true });
      else field('Message ID', value);
    }
    if (body) {
      const label = type === 'AUTOMOD' ? 'Rule matched' : type === 'PRIVATE REPORT' ? 'Report details' : type === 'AI REVIEW' ? 'Review notes' : 'Message content';
      description = `**${label}**\n${escapeMarkdown(body).slice(0, 3500)}`;
    }
  } else {
    description = escapeMarkdown(text).slice(0, 2000);
  }
  return {
    content: '', allowedMentions: { parse: [] },
    embeds: [{
      color, author: { name:'MARA • THE BLACKLISTED', ...(avatarURL ? { icon_url:avatarURL } : {}) },
      title: `${icon}  ${title}`, ...(description ? { description } : {}),
      ...(fields.length ? { fields } : {}),
      footer: { text: type === 'AI REVIEW' ? 'Staff review required • No automatic punishment' : 'Mara • Server activity' },
      timestamp: new Date().toISOString()
    }]
  };
}
