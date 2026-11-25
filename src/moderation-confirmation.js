import { randomUUID } from 'node:crypto';
import { ButtonStyle, escapeMarkdown, MessageFlags, PermissionFlagsBits as P } from 'discord.js';
import { canTarget } from './security.js';

const prefix = 'mod-confirm:';
const lifetime = 5 * 60 * 1000;
const permissionFor = type => type === 'kick' ? P.KickMembers : P.BanMembers;

function eligibility(type, actor, target, bot, ownerId) {
  if (!actor.permissions.has(permissionFor(type))) return 'You do not have permission to do that.';
  if (!canTarget(actor, target, ownerId)) return 'You cannot moderate yourself, the owner, bots, or equal/higher roles.';
  if (!bot.permissions.has(permissionFor(type)) || !(type === 'kick' ? target.kickable : target.bannable)) {
    return 'Mara cannot ' + type + ' that member. Check permissions and role order.';
  }
}

export function createModerationConfirmation({ store, audit, now = Date.now }) {
  async function preview(i, type, actor, target, bot, reason) {
    const problem = eligibility(type, actor, target, bot, i.guild.ownerId);
    if (problem) return i.editReply(problem);

    const id = randomUUID();
    store.createModerationRequest({
      id, guild: i.guild.id, actor: actor.id, target: target.id, type, reason, expires: now() + lifetime
    });
    return i.editReply({
      content: 'Confirm ' + type + ' for <@' + target.id + '> (' + target.id + ')?\nReason: ' +
        escapeMarkdown(reason.slice(0, 512)) + '\nThis request expires in five minutes.',
      allowedMentions: { parse: [] },
      components: [{ type: 1, components: [
        { type: 2, style: ButtonStyle.Danger, custom_id: prefix + 'confirm:' + id, label: 'Confirm ' + type },
        { type: 2, style: ButtonStyle.Secondary, custom_id: prefix + 'cancel:' + id, label: 'Cancel' }
      ] }]
    });
  }

  async function handle(i) {
    const [decision, id] = i.customId.slice(prefix.length).split(':');
    const request = store.moderationRequest(id);
    const privateReply = content => i.reply({ content, flags: MessageFlags.Ephemeral });
    if (!request || request.guild !== i.guild.id || request.actor !== i.user.id) {
      return privateReply('This confirmation is unavailable to you.');
    }
    if (!store.claimModerationRequest(id, now())) {
      return privateReply('This request has expired or is already being handled.');
    }

    try {
      await i.deferUpdate();
    } catch (error) {
      store.setModerationRequestStatus(id, 'pending');
      throw error;
    }

    const finish = content => i.editReply({ content, components: [], allowedMentions: { parse: [] } });
    async function recordOutcome(status, content) {
      store.setModerationRequestStatus(id, status);
      await audit(i.guild, 'SETUP | ' + request.type.toUpperCase() + ' confirmation ' + status +
        ' | target ' + request.target + ' | staff ' + request.actor + ' | request ' + id);
      return finish(content);
    }

    if (decision === 'cancel') return recordOutcome('cancelled', 'Request cancelled.');

    let actor, target, bot;
    try {
      [actor, target, bot] = await Promise.all([
        i.guild.members.fetch({ user: request.actor, force: true }),
        i.guild.members.fetch({ user: request.target, force: true }),
        i.guild.members.fetchMe({ force: true })
      ]);
    } catch (error) {
      if (Number(error.code) === 10007) {
        return recordOutcome('rejected', 'The moderator or target is no longer a server member.');
      }
      store.setModerationRequestStatus(id, 'pending');
      return i.followUp({
        content: 'Mara could not refresh server members. Try confirming again before the request expires.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (request.expires <= now()) return recordOutcome('expired', 'This request has expired.');
    const problem = eligibility(request.type, actor, target, bot, i.guild.ownerId);
    if (problem) return recordOutcome('rejected', problem);

    try {
      const reason = (i.user.tag + ': ' + request.reason).slice(0, 512);
      if (request.type === 'kick') await target.kick(reason);
      else await target.ban({ reason, deleteMessageSeconds: 0 });
    } catch (error) {
      const status = Number(error.status);
      if (status === 429) {
        store.setModerationRequestStatus(id, 'pending');
        return i.followUp({
          content: 'Discord rate-limited the action. Try confirming again before the request expires.',
          flags: MessageFlags.Ephemeral
        });
      }
      if (status >= 400 && status < 500 && status !== 408) {
        return recordOutcome('rejected', 'Discord rejected the action. Check permissions and role order.');
      }
      return recordOutcome('unverified', 'Mara could not confirm the Discord result. Check the server audit log before submitting another request.');
    }

    const caseId = store.completeModerationRequest(request);
    await audit(i.guild, request.type.toUpperCase() + ' | target ' + target.id + ' | staff ' + actor.id +
      ' | Case #' + caseId + ': ' + request.reason);
    return finish(request.type + ' recorded for ' + escapeMarkdown(target.user.tag) + '. Case #' + caseId + '.');
  }

  return {
    preview,
    handle,
    matches: id => /^mod-confirm:(confirm|cancel):[a-f0-9-]{36}$/.test(id)
  };
}
