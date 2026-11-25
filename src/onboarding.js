import { createHash } from 'node:crypto';
import { config } from './config.js';
import { sendWelcome } from './welcome.js';

export function createOnboarding({ store, env, client, fetchChannel, now = Date.now, welcome = sendWelcome }) {
  let flushing = false;

  function join(member) {
    store.recordJoin(member.guild.id, member.id, member.joinedTimestamp ?? now(), Boolean(env.WELCOME_CHANNEL_ID));
  }

  function leave(member) {
    if (member.joinedTimestamp != null) {
      store.recordDeparture(member.guild.id, member.id, member.joinedTimestamp, now());
    }
  }

  async function flush() {
    if (flushing || !client.isReady() || !env.WELCOME_CHANNEL_ID) return;
    const pending = store.dueWelcomes(env.GUILD_ID, now());
    if (!pending.length) return;
    flushing = true;
    try {
      for (const entry of pending) {
        try {
          const guild = await client.guilds.fetch(entry.guild);
          let member;
          try {
            member = await guild.members.fetch({ user: entry.member, force: true });
          } catch (error) {
            if (Number(error.code) !== 10007) throw error;
          }
          if (!member || member.joinedTimestamp !== entry.joined_at) {
            store.recordDeparture(entry.guild, entry.member, entry.joined_at, now());
            continue;
          }
          const channel = await fetchChannel(guild, env.WELCOME_CHANNEL_ID);
          const nonce = createHash('sha256').update(entry.guild + ':' + entry.member + ':' + entry.joined_at)
            .digest('hex').slice(0, 24);
          await welcome(channel, member, config(store).welcomeText, { nonce, enforceNonce: true });
          store.welcomeSent(entry, now());
        } catch {
          store.postponeWelcome(entry, now());
          console.warn('Welcome delivery pending. Check the welcome channel permissions.');
        }
      }
    } finally {
      flushing = false;
    }
  }

  return { join, leave, flush };
}
