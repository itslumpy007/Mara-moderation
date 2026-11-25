import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const tiktokLivePath = '/webhooks/tiktok-live';
const maxBodyBytes = 128 * 1024;
const handlePattern = /^[a-z0-9_.]{1,24}$/;
const roomPattern = /^[1-9]\d{0,29}$/;
const handle = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/^@/, '') : '';
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

export function createTikTokLiveHandler({ env, store }) {
  if (env.TIKTOK_LIVE_ENABLED !== 'true') return undefined;
  if (env.DASHBOARD_ENABLED !== 'true') throw Error('TikTok LIVE alerts require the Mara dashboard.');
  const channel = env.TIKTOK_LIVE_CHANNEL_ID;
  const secret = env.EULER_WEBHOOK_SECRET;
  const creators = new Set((env.TIKTOK_LIVE_CREATORS ?? '').split(',').map(handle));
  if (!/^\d{17,20}$/.test(channel ?? '')) throw Error('Set TIKTOK_LIVE_CHANNEL_ID to a valid Discord text channel ID.');
  if (!secret?.trim()) throw Error('Set EULER_WEBHOOK_SECRET to the Euler Stream account webhook secret.');
  if ([...creators].some(value => !handlePattern.test(value))) {
    throw Error('Set TIKTOK_LIVE_CREATORS to a comma-separated list of TikTok usernames.');
  }

  return async (req, res) => {
    const reply = (status, content) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(content));
    };
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
    const hmac = createHmac('sha256', secret);
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
    if (!alert || !creators.has(alert.username)) return reply(200, { ignored: true });

    const { username, roomId } = alert;
    const nonce = createHash('sha256').update('tiktok:' + username + ':' + roomId).digest('hex').slice(0, 24);
    const payload = {
      content: '🔴 **@' + username + '** is live on TikTok! [Watch live](https://www.tiktok.com/@' + username + '/live)',
      allowedMentions: { parse: [] }, nonce, enforceNonce: true
    };
    try {
      const queued = store.enqueueTikTokLive(username, roomId, channel, payload);
      return reply(200, { queued });
    } catch {
      console.error('TikTok LIVE alert could not enter the delivery queue.');
      return reply(503, { error: 'Delivery queue unavailable.' });
    }
  };
}
