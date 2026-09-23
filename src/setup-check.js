import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { safeRole } from './security.js';

export function verificationProblem(role, me) {
  if (!role) return 'Set VERIFIED_ROLE_ID to an existing member role ID (not a channel ID), then restart Mara.';
  if (!me.permissions.has(P.ManageRoles)) return 'Give Mara the Manage Roles permission.';
  if (role.id === role.guild.id) return 'Choose a separate member role, not @everyone.';
  if (role.managed) return 'Choose a normal member role, not a bot or integration role.';
  if (me.roles.highest.comparePositionTo(role) <= 0) return 'Move Mara’s highest role above the verification role in Server Settings → Roles.';
  if (!role.editable) return 'Mara cannot manage this role. Check Manage Roles and the server role order.';
  if (!safeRole(role, me)) return 'Remove administrator and moderation permissions from the verification role, or choose a basic member role.';
  return null;
}

export async function setupCheck(guild, env, me) {
  const fields = [];
  for (const [key, label] of [['LOG_CHANNEL_ID','Log channel'],['WELCOME_CHANNEL_ID','Welcome channel']]) {
    let detail;
    const channel = env[key] ? await guild.channels.fetch(env[key]).catch(() => null) : null;
    if (!channel || channel.type !== ChannelType.GuildText) detail = `Set ${key} to an accessible server text channel ID.`;
    else {
      const permissions = channel.permissionsFor(me);
      const missing = ['ViewChannel','SendMessages','EmbedLinks'].filter(name => !permissions?.has(P[name]));
      detail = missing.length ? `Missing permissions: ${missing.join(', ')}.` : 'Ready to send styled messages.';
      if (key === 'LOG_CHANNEL_ID') {
        const publicView = channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel);
        detail += publicView ? '\n⚠ @everyone can view this channel. Make staff logs private.' : '\nCheck other role overrides too; this does not certify staff-only access.';
      }
      detail = `<#${channel.id}>\n${detail}`;
    }
    fields.push({ name: label, value: detail });
  }
  const role = env.VERIFIED_ROLE_ID ? await guild.roles.fetch(env.VERIFIED_ROLE_ID).catch(() => null) : null;
  fields.push({ name:'Verification', value:verificationProblem(role, me) || `Ready to assign <@&${role.id}>.` });
  const missing = ['ManageMessages','ModerateMembers','KickMembers','BanMembers','ManageChannels'].filter(name => !me.permissions.has(P[name]));
  fields.push({ name:'Moderation & tickets', value:missing.length ? `Missing server permissions: ${missing.join(', ')}. Grant only those needed for enabled features.` : 'Server permissions available. Channel overrides and member role order still apply.' });
  fields.push({ name:'Hosting', value:env.RAILWAY_ENVIRONMENT_ID ? `Railway • DATA_DIR ${env.DATA_DIR === '/data' ? 'is configured correctly' : 'must be /data'}. Confirm a volume is attached at /data in Railway.` : 'Local process • keep the terminal open while Mara runs.' });
  return { color:0x9B7BDA, title:'Mara • Setup check', description:'Configuration checks for server staff. No credentials are displayed.', fields, timestamp:new Date().toISOString() };
}
