import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits as P } from 'discord.js';
import { createModerationConfirmation } from '../src/moderation-confirmation.js';
import { createStore } from '../src/store.js';

function setup(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  let clock = 1;
  const actions = [], logs = [];
  const member = (id, rank) => ({
    id, user: { tag: id }, permissions: new Set([P.KickMembers, P.BanMembers]),
    roles: { highest: { rank, comparePositionTo: other => rank - other.rank } }
  });
  const actor = member('staff', 3), bot = member('bot', 5);
  const target = {
    ...member('target', 1), kickable: true, bannable: true,
    kick: async reason => { actions.push(['kick', reason]); },
    ban: async options => { actions.push(['ban', options]); }
  };
  const guild = {
    id: 'guild', ownerId: 'owner',
    members: {
      async fetch({ user, force }) {
        assert.equal(force, true);
        return user === actor.id ? actor : target;
      },
      async fetchMe({ force }) {
        assert.equal(force, true);
        return bot;
      }
    }
  };
  const confirmation = createModerationConfirmation({
    store, audit: async (_, message) => { logs.push(message); }, now: () => clock
  });
  async function preview(type) {
    const reply = await confirmation.preview({ guild, editReply: value => value }, type, actor, target, bot, 'Testing');
    assert.deepEqual(reply.allowedMentions, { parse: [] });
    return reply.components[0].components.map(button => button.custom_id);
  }
  function click(customId, overrides = {}) {
    return confirmation.handle({
      guild, user: actor.user, customId, reply: value => value, editReply: value => value,
      deferUpdate: async () => {}, followUp: value => value,
      ...overrides, user: { ...actor.user, id: actor.id, ...overrides.user }
    });
  }
  return { actor, bot, target, guild, actions, logs, store, preview, click, advance: ms => { clock += ms; } };
}

test('kick waits for the initiator and executes only once despite duplicate confirmation', async t => {
  const s = setup(t);
  const [confirm] = await s.preview('kick');
  assert.deepEqual(s.actions, []);
  assert.match((await s.click(confirm, { user: { id: 'another-staff-member' } })).content, /unavailable/);
  assert.match((await s.click(confirm, { guild: { ...s.guild, id: 'other-guild' } })).content, /unavailable/);
  const [result, duplicate] = await Promise.all([s.click(confirm), s.click(confirm)]);
  assert.deepEqual(s.actions, [['kick', 'staff: Testing']]);
  assert.match(result.content, /Case #1/);
  assert.deepEqual(result.components, []);
  assert.match(duplicate.content, /already being handled/);
  assert.equal(s.store.cases({ target: 'target' }).length, 1);
  assert.match(s.logs[0], /^KICK.*Case #1/);
});

test('a confirmed ban preserves message history', async t => {
  const s = setup(t);
  const [confirm] = await s.preview('ban');
  assert.match((await s.click(confirm)).content, /Case #1/);
  assert.deepEqual(s.actions, [['ban', { reason: 'staff: Testing', deleteMessageSeconds: 0 }]]);
});

test('cancelled and expired requests cannot be confirmed', async t => {
  const s = setup(t);
  const [confirm, cancel] = await s.preview('kick');
  assert.equal((await s.click(cancel)).content, 'Request cancelled.');
  assert.match((await s.click(confirm)).content, /expired or is already being handled/);
  const [late] = await s.preview('ban');
  s.advance(5 * 60 * 1000);
  assert.match((await s.click(late)).content, /expired/);
  assert.deepEqual(s.actions, []);
  assert.deepEqual(s.store.cases(), []);
});

test('confirmation rechecks moderator permission, bot permission and hierarchy', async t => {
  const s = setup(t);
  const [noModerator] = await s.preview('ban');
  const [noBot] = await s.preview('kick');
  const [higherTarget] = await s.preview('ban');
  s.actor.permissions.delete(P.BanMembers);
  assert.match((await s.click(noModerator)).content, /do not have permission/);
  s.actor.permissions.add(P.BanMembers);
  s.bot.permissions.delete(P.KickMembers);
  assert.match((await s.click(noBot)).content, /Mara cannot kick/);
  s.target.roles.highest.rank = 4;
  assert.match((await s.click(higherTarget)).content, /equal\/higher roles/);
  assert.deepEqual(s.actions, []);
  assert.deepEqual(s.store.cases(), []);
});

test('transient preflight failures can be retried but ambiguous Discord outcomes cannot', async t => {
  const s = setup(t);
  const [confirm] = await s.preview('ban');
  const originalFetch = s.guild.members.fetch;
  s.guild.members.fetch = async () => { throw Error('network'); };
  assert.match((await s.click(confirm)).content, /Try confirming again/);
  s.guild.members.fetch = originalFetch;
  s.target.ban = async () => {
    s.actions.push('attempt');
    throw Error('network');
  };
  assert.match((await s.click(confirm)).content, /server audit log/);
  await s.click(confirm);
  assert.deepEqual(s.actions, ['attempt']);
  assert.deepEqual(s.store.cases(), []);
});
