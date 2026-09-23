import { PermissionFlagsBits as P } from 'discord.js';
export function canTarget(actor, target, ownerId) {
  return target.id !== actor.id && target.id !== ownerId && !target.user.bot &&
    (actor.id === ownerId || actor.roles.highest.comparePositionTo(target.roles.highest) > 0);
}
export function safeRole(role, me) {
  const dangerous = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages, P.ManageWebhooks, P.MentionEveryone];
  return !!role && role.id !== role.guild.id && !role.managed && role.editable &&
    me.roles.highest.comparePositionTo(role) > 0 && !dangerous.some(p => role.permissions.has(p));
}
