import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ChannelType, escapeMarkdown, PermissionFlagsBits as P } from 'discord.js';

export const tiktokLivePath = '/webhooks/tiktok-live';
const maxBodyBytes = 128 * 1024;
const handlePattern = /^[a-z0-9_.]{1,24}$/;
const roomPattern = /^[1-9]\d{0,29}$/;
const handle = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/^@/, '') : '';
const settingsKey = 'tiktok-live:settings';
const channelPattern = /^\d{17,20}$/;
const normalizeCreators = values => [...new Set(values.map(handle))];
const secretConfigured = env => Boolean(env.EULER_WEBHOOK_SECRET?.trim());
const firstText = (...values) => values.find(value => typeof value === 'string' && value.length);

function readAlert(body) {
  const event = JSON.parse(body, (key, value, context) => {
    // Room IDs can be larger than JavaScript's safe integer range.
    if ((key === 'room_id' || key === 'roomId' || key === 'id_str') && typeof value === 'number') {
      return context.source;
    }
    return value;
  });
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw Error('Expected an alert object.');
  const data = event.data ?? event;
  const room = data.room_info ?? data.roomInfo ?? event.room_info ?? event.roomInfo ?? {};
  const owner = room.owner ?? data.owner ?? data.user ?? {};
  const status = firstText(event.event, event.type, data.status, event.status)?.toLowerCase();
  if (event.is_test === true || event.test === true || data.is_live === false || event.is_live === false ||
    (status && /(?:offline|ended|\.end\b|stopped|inactive)/.test(status))) return null;
  const username = handle(firstText(
    data.unique_id, data.uniqueId, owner.unique_id, owner.uniqueId, owner.display_id,
    event.unique_id, event.uniqueId, event.metadata?.platformUsername
  ));
  const roomId = firstText(data.room_id, data.roomId, room.room_id, room.roomId, room.id_str, event.room_id, event.roomId);
  if (!handlePattern.test(username) || !roomPattern.test(roomId ?? '')) throw Error('Missing creator or live room.');
  return { username, roomId };
}

export function getTikTokLiveSettings(store, env) {
  return store.get(settingsKey, {
    enabled: env.TIKTOK_LIVE_ENABLED === 'true',
    channelId: env.TIKTOK_LIVE_CHANNEL_ID ?? '',
    creators: normalizeCreators((env.TIKTOK_LIVE_CREATORS ?? '').split(',').filter(value => value.trim()))
  });
}

const canPost = (channel, guild, actor, bot) => channel?.guildId === guild.id &&
  channel.type === ChannelType.GuildText && channel.permissionsFor(actor)?.has(P.ViewChannel) &&
  channel.permissionsFor(bot)?.has([P.ViewChannel, P.SendMessages]);

async function requireTikTokAlertChannel(guild, actor, channelId) {
  if (typeof channelId !== 'string' || !channelPattern.test(channelId)) throw Error('Choose a Discord alert channel.');
  const [channel, bot] = await Promise.all([guild.channels.fetch(channelId, { force: true }), guild.members.fetchMe()])
    .catch(() => { throw Error('Could not check the alert channel. Try again.'); });
  if (!canPost(channel, guild, actor, bot)) throw Error('Choose a text channel you can view and Mara can post in.');
  return channel;
}

export function previewTikTokLiveAlert(creator) {
  const username = handle(creator);
  if (!handlePattern.test(username)) throw Error('Choose a valid TikTok username to preview or test.');
  return {
    handle: '@' + username,
    announcement: 'went live on TikTok!',
    watchLabel: 'Watch live',
    watchUrl: 'https://www.tiktok.com/@' + username + '/live'
  };
}

function tiktokLiveMessage(preview) {
  return {
    content: '🔴 **' + escapeMarkdown(preview.handle) + '** ' + preview.announcement +
      '\n[' + preview.watchLabel + '](' + preview.watchUrl + ')',
    allowedMentions: { parse: [] }
  };
}

export async function sendTikTokLiveTest(guild, actor, { creator, channelId }) {
  const payload = tiktokLiveMessage(previewTikTokLiveAlert(creator));
  const channel = await requireTikTokAlertChannel(guild, actor, channelId);
  const message = await channel.send({
    ...payload,
    content: '**TEST ALERT** · ' + payload.content
  }).catch(() => { throw Error('Mara could not send the test alert. Check channel permissions and try again.'); });
  return { url: 'https://discord.com/channels/' + guild.id + '/' + channel.id + '/' + message.id };
}

export async function getTikTokLiveDashboard(store, env, guild, actor, base) {
  const saved = getTikTokLiveSettings(store, env);
  let channels = [], channelsAvailable = true;
  try {
    const [all, bot] = await Promise.all([guild.channels.fetch(), guild.members.fetchMe()]);
    channels = [...all.values()].filter(channel => canPost(channel, guild, actor, bot))
      .sort((a,b) => a.name.localeCompare(b.name))
      .map(channel => ({ id: channel.id, name: channel.name }));
  } catch {
    channelsAvailable = false;
  }
  return {
    ...saved, providerConfigured: secretConfigured(env), channels, channelsAvailable,
    webhookUrl: new URL(tiktokLivePath, base).href
  };
}

export async function saveTikTokLiveSettings(store, env, guild, actor, input) {
  const { enabled, channelId, creators } = input;
  if (typeof enabled !== 'boolean' || typeof channelId !== 'string' ||
    (channelId !== '' && !channelPattern.test(channelId)) || !Array.isArray(creators)) {
    throw Error('Provide an alert setting, a Discord text channel, and a list of TikTok usernames.');
  }
  const handles = normalizeCreators(creators);
  if (handles.some(value => !handlePattern.test(value))) throw Error('Enter TikTok usernames, one per line.');
  if (enabled && !secretConfigured(env)) throw Error('Add EULER_WEBHOOK_SECRET in Railway before enabling alerts.');
  if (enabled && (!channelId || !handles.length)) throw Error('Choose a channel and add at least one creator.');
  if (channelId && (enabled || channelId !== getTikTokLiveSettings(store, env).channelId)) {
    await requireTikTokAlertChannel(guild, actor, channelId);
  }
  const saved = { enabled, channelId, creators: handles };
  store.set(settingsKey,saved);
  return saved;
}

function activeTikTokLiveSettings(store, env) {
  const saved = getTikTokLiveSettings(store, env);
  if (saved.enabled && secretConfigured(env) && channelPattern.test(saved.channelId) && saved.creators.length &&
    saved.creators.every(value => handlePattern.test(value))) return saved;
}

export function createTikTokLiveHandler({ env, store }) {
  return async (req, res) => {
    const reply = (status, content) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(content));
    };
    if (!activeTikTokLiveSettings(store, env)) return reply(404, { error: 'Not found.' });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(405, { error: 'POST required.' });
    }
    const signature = req.headers['x-webhook-signature'];
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) {
      return reply(401, { error: 'Invalid signature.' });
    }
    if (Number(req.headers['content-length']) > maxBodyBytes) return reply(413, { error: 'Alert is too large.' });
    const chunks = [];
    let bytes = 0;
    const hmac = createHmac('sha256', env.EULER_WEBHOOK_SECRET);
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        req.resume();
        return reply(413, { error: 'Alert is too large.' });
      }
      hmac.update(chunk);
      chunks.push(chunk);
    }
    if (!timingSafeEqual(hmac.digest(), Buffer.from(signature, 'hex'))) {
      return reply(401, { error: 'Invalid signature.' });
    }

    let alert;
    try {
      alert = readAlert(Buffer.concat(chunks, bytes));
    } catch {
      return reply(400, { error: 'Invalid TikTok LIVE alert.' });
    }
    const settings = activeTikTokLiveSettings(store, env);
    if (!alert || !settings?.creators.includes(alert.username)) return reply(200, { ignored: true });

    const { username, roomId } = alert;
    const nonce = createHash('sha256').update('tiktok:' + username + ':' + roomId).digest('hex').slice(0, 24);
    const payload = {
      ...tiktokLiveMessage(previewTikTokLiveAlert(username)), nonce, enforceNonce: true
    };
    try {
      const queued = store.enqueueTikTokLive(username, roomId, settings.channelId, payload);
      return reply(200, { queued });
    } catch {
      console.error('TikTok LIVE alert could not enter the delivery queue.');
      return reply(503, { error: 'Delivery queue unavailable.' });
    }
  };
}
