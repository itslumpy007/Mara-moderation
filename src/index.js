import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client, GatewayIntentBits as I, Partials, PermissionFlagsBits as P, ChannelType, MessageFlags } from 'discord.js';
import { createStore } from './store.js';
import { canTarget, safeRole } from './security.js';
import { createAutomod, settings } from './automod.js';
import { createAI } from './ai.js';
import { logCard } from './log-style.js';
import { setupCheck, verificationProblem } from './setup-check.js';
for (const key of ['DISCORD_TOKEN','GUILD_ID']) if (!process.env[key]) throw new Error(`Missing ${key}`);
if (process.env.RAILWAY_ENVIRONMENT_ID && process.env.DATA_DIR !== '/data') throw new Error('Set DATA_DIR=/data and attach a Railway volume at /data.');
const env = process.env;
const ai = createAI(env);
mkdirSync(env.DATA_DIR || './data',{recursive:true});
const store = createStore(join(env.DATA_DIR || './data','mara.sqlite'));
const client = new Client({intents:[I.Guilds,I.GuildMembers,I.GuildMessages,I.GuildMessageReactions,I.MessageContent,I.GuildModeration],partials:[Partials.Message,Partials.Channel,Partials.Reaction],allowedMentions:{parse:[]}});
const allowed = g => g?.id === env.GUILD_ID;
const row = (id,label) => [{type:1,components:[{type:2,style:2,custom_id:id,label}]}];
const requirePermission = (member, p) => { if (!member.permissions.has(p)) throw new Error('You do not have permission to do that.'); };
async function textChannel(g,id) { const c = await g.channels.fetch(id); if (!c || c.type !== ChannelType.GuildText) throw new Error('Configure a valid server text channel.'); return c; }
async function audit(g,text) {
  if (!env.LOG_CHANNEL_ID) { console.warn('LOG_CHANNEL_ID is not configured.'); return; }
  try {
    const channel = await textChannel(g,env.LOG_CHANNEL_ID);
    const me = g.members.me || await g.members.fetchMe();
    await channel.send(channel.permissionsFor(me)?.has(P.EmbedLinks)
      ? logCard(text, client.user.displayAvatarURL())
      : {content:text.slice(0,2000),allowedMentions:{parse:[]}});
  }
  catch { console.error('Could not deliver an audit log. Check channel permissions.'); }
}
const locks = new Set();
const moderate = createAutomod({ store, env, audit, ai });
client.on('messageCreate', m => moderate(m).catch(() => console.error('Automod failed; check configuration and permissions.')));
client.on('messageUpdate', (before, after) => {
  if (before.content !== after.content) void moderate(after, { edited: true }).catch(() => console.error('Automod edit check failed.'));
});
async function ticket(i) {
  const key = `ticket:${i.user.id}`;
  if (locks.has(key)) throw new Error('Your ticket is already being created.');
  locks.add(key);
  try {
    const existing = store.get(key);
    if (existing && await i.guild.channels.fetch(existing).catch(()=>null)) throw new Error(`You already have a ticket: <#${existing}>`);
    const staff = await i.guild.roles.fetch(env.STAFF_ROLE_ID || '0');
    if (!staff || staff.id === i.guild.id) throw new Error('An administrator must configure STAFF_ROLE_ID.');
    const c = await i.guild.channels.create({name:`ticket-${i.user.id}`,type:ChannelType.GuildText,parent:env.TICKET_CATEGORY_ID || undefined,permissionOverwrites:[
      {id:i.guild.id,deny:[P.ViewChannel]},
      {id:i.user.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles]},
      {id:staff.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory]},
      {id:client.user.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.ManageChannels]}
    ]});
    store.set(key,c.id); store.set(`owner:${c.id}`,i.user.id);
    await c.send({content:`Welcome <@${i.user.id}>. Describe your issue here. Staff can reply in this private channel. Use /close when finished.`});
    await i.editReply(`Your ticket: <#${c.id}>`);
    await audit(i.guild,`Ticket opened by ${i.user.tag}: ${c.id}`);
  } finally { locks.delete(key); }
}
client.on('interactionCreate',async i => {
  if (!i.isChatInputCommand() && !i.isButton()) return;
  if (!allowed(i.guild)) return i.reply({content:'Mara is configured for a different server.',flags:MessageFlags.Ephemeral});
  try {
    await i.deferReply({flags:MessageFlags.Ephemeral});
    const actor = await i.guild.members.fetch(i.user.id);
    const me = await i.guild.members.fetchMe();
    if (i.isButton()) {
      if (i.customId === 'ticket') return await ticket(i);
      if (i.customId !== 'verify') throw new Error('Unknown button.');
      const role = await i.guild.roles.fetch(env.VERIFIED_ROLE_ID || '0');
      const problem = verificationProblem(role, me);
      if (problem) throw new Error(`Verification is not ready. Ask a server administrator to fix this: ${problem}`);
      if (actor.roles.cache.has(role.id)) return await i.editReply('You’re already verified. Welcome back to The Blacklisted.');
      await actor.roles.add(role,'Member accepted the server rules');
      await audit(i.guild,`Rules accepted: ${i.user.tag}`);
      return await i.editReply('You’re verified. Welcome to The Blacklisted.');
    }
    const n=i.commandName, o=i.options;
    const reason=o.getString('reason');
    const s = name => o.getString(name,true);
    if (n === 'setup-check') {
      requirePermission(actor, P.ManageGuild);
      const card = await setupCheck(i.guild, env, me);
      return await i.editReply(i.channel?.permissionsFor(me)?.has(P.EmbedLinks)
        ? { embeds:[card], allowedMentions:{parse:[]} }
        : { content:card.fields.map(f=>`${f.name}\n${f.value}`).join('\n\n').slice(0,2000), allowedMentions:{parse:[]} });
    }
    if (n === 'automod') {
      requirePermission(actor, P.ManageGuild);
      const config = settings(store);
      for (const [option, key] of [['enabled','enabled'],['block-invites','blockInvites']]) {
        const value = o.getBoolean(option); if (value !== null) config[key] = value;
      }
      for (const [option, key] of [['mention-limit','mentionLimit'],['spam-limit','spamLimit']]) {
        const value = o.getInteger(option); if (value !== null) config[key] = value;
      }
      if (o.getString('action')) config.action = o.getString('action');
      const words = o.getString('blocked-words');
      if (words !== null) config.blockedWords = words === '-' ? [] : [...new Set(words.split(',').map(w=>w.trim()).filter(Boolean))];
      if (config.enabled && !env.LOG_CHANNEL_ID) throw new Error('Configure LOG_CHANNEL_ID before enabling automod.');
      store.set('automod', config);
      return await i.editReply(`Automod: ${config.enabled ? 'on' : 'off'} | action: ${config.action}\nInvites: ${config.blockInvites ? 'blocked' : 'allowed'} | mention limit: ${config.mentionLimit} | flood: ${config.spamLimit} messages / 10 seconds\nBlocked phrases: ${config.blockedWords.length}\nAI review: ${env.AI_ENABLED === 'true' && env.OPENAI_API_KEY ? 'configured; selected channels only' : 'off'}`);
    }
    if (n === 'ai-summary') {
      requirePermission(actor, P.ModerateMembers);
      const summary = await ai.summarize(s('text'));
      return await i.editReply({ content: `AI draft — verify against the original report.\n${summary}`, allowedMentions: { parse: [] } });
    }
    if (n==='help') return await i.editReply('Mara • The Blacklisted\nStaff: /warn /warnings /timeout /untimeout /kick /ban /purge /ai-summary\nSetup: /setup-check /panel /rolepanel /announce /custom-set /custom-delete /automod\nMembers: /custom /report /close\nVerification means accepting rules, not proving age or identity.');
    if (['warn','warnings','timeout','untimeout','kick','ban'].includes(n)) {
      requirePermission(actor,n==='kick'?P.KickMembers:n==='ban'?P.BanMembers:P.ModerateMembers);
      const target=await i.guild.members.fetch(o.getUser('user',true).id);
      const key=`warnings:${target.id}`;
      if (n==='warnings') return await i.editReply((store.get(key,[]).map(w=>`${w.date} — ${w.reason}`).join('\n') || 'No warnings.').slice(0,1950));
      if (!canTarget(actor,target,i.guild.ownerId)) throw new Error('You cannot moderate yourself, the owner, bots, or equal/higher roles.');
      const why=`${i.user.tag}: ${reason}`.slice(0,512);
      if(n==='warn') { const warnings=store.get(key,[]); warnings.push({reason,moderator:i.user.id,date:new Date().toISOString()}); store.set(key,warnings); }
      if(n==='timeout') { if(!target.moderatable) throw new Error('Mara cannot timeout that member. Check permissions and role order.'); await target.timeout(o.getInteger('minutes',true)*60000,why); }
      if(n==='untimeout') {
        if(!target.moderatable) throw new Error('Mara cannot change that member’s timeout. Check Moderate Members and role order.');
        if(!target.isCommunicationDisabled()) return await i.editReply('That member is not currently timed out.');
        await target.timeout(null,why);
      }
      if(n==='kick') { if(!target.kickable) throw new Error('Mara cannot kick that member.'); await target.kick(why); }
      if(n==='ban') { if(!target.bannable) throw new Error('Mara cannot ban that member.'); await target.ban({reason:why,deleteMessageSeconds:0}); }
      await audit(i.guild,`${n.toUpperCase()} | target ${target.id} | staff ${i.user.id} | ${reason}`);
      return await i.editReply(`${n} recorded for ${target.user.tag}.`);
    }
    if(n==='purge') {
      requirePermission(actor,P.ManageMessages);
      if(i.channel?.type!==ChannelType.GuildText) throw new Error('Use this in a server text channel.');
      const deleted=await i.channel.bulkDelete(o.getInteger('count',true),true);
      await audit(i.guild,`PURGE | ${i.user.id} | ${i.channelId} | ${deleted.size} messages`);
      return await i.editReply(`Deleted ${deleted.size} messages. Messages older than 14 days are skipped.`);
    }
    if(['announce','panel','rolepanel','custom-set','custom-delete'].includes(n)) requirePermission(actor,P.ManageGuild);
    if(n==='announce'||n==='panel'||n==='rolepanel') {
      const c=await textChannel(i.guild,o.getChannel('channel',true).id);
      if(!c.permissionsFor(actor).has([P.ViewChannel,P.SendMessages])) throw new Error('You cannot post in that channel.');
      if(n==='announce') await c.send({content:s('text')});
      if(n==='panel') {
        const kind=s('kind');
        if (kind === 'verify') {
          await c.send({
            embeds: [{
              color: 0x9B7BDA,
              author: { name: 'MARA • THE BLACKLISTED', icon_url: client.user.displayAvatarURL() },
              title: 'Your place in The Blacklisted starts here.',
              description: 'Welcome in. I’m **Mara**, your server guide.\nRead our server rules, then accept them below to receive your member role.',
              fields: [
                { name: '01  •  Read the rules', value: 'Take a moment to review the server rules before joining the conversation.' },
                { name: '02  •  Make it official', value: 'Click **Accept rules & verify** to confirm you agree to follow them.' },
                { name: 'Need a hand?', value: 'If verification fails, contact a staff member and they’ll help you get settled.' }
              ],
              footer: { text: 'Rules acceptance only • No age or identity checks' }
            }],
            components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: 'verify', label: 'Accept rules & verify', emoji: { name: '✅' } }] }]
          });
        } else {
          await c.send({content:'Mara • Support\nOpen a private ticket to speak with staff.',components:row(kind,'Open a ticket')});
        }
      }
      if(n==='rolepanel') {
        const role=await i.guild.roles.fetch(o.getRole('role',true).id);
        if(!safeRole(role,me) || role.id === env.VERIFIED_ROLE_ID) throw new Error('Choose a non-privileged role below Mara, other than the verification role.');
        const message=await c.send({content:`${s('text')}\nReact with ✅ for <@&${role.id}>. Remove your reaction to remove the role.`});
        store.set(`reaction:${message.id}`,role.id); await message.react('✅');
      }
      await audit(i.guild,`${n} posted by ${i.user.id} in ${c.id}`);
      return await i.editReply('Posted.');
    }
    if(n.startsWith('custom')) {
      const name=s('name').toLowerCase().trim();
      if(!/^[a-z0-9_-]{1,32}$/.test(name)) throw new Error('Use 1–32 lowercase letters, numbers, hyphens, or underscores.');
      const key=`custom:${name}`;
      if(n==='custom-set') store.set(key,s('text'));
      if(n==='custom-delete') store.set(key,null);
      if(n==='custom') return await i.editReply(store.get(key)||'No saved response with that name.');
      return await i.editReply('Saved.');
    }
    if(n==='report') {
      const key=`report:${i.user.id}`, last=store.get(key,0);
      if(Date.now()-last<60000) throw new Error('Please wait one minute between reports.');
      const c=await textChannel(i.guild,env.LOG_CHANNEL_ID || '0');
      if(c.permissionsFor(i.guild.roles.everyone).has(P.ViewChannel)) throw new Error('Reports are disabled until staff make the log channel private.');
      store.set(key,Date.now());
      const report = `PRIVATE REPORT | reporter ${i.user.id} | member ${o.getUser('user',true).id}\n${reason}`;
      await c.send(c.permissionsFor(me)?.has(P.EmbedLinks)
        ? logCard(report, client.user.displayAvatarURL())
        : {content:report,allowedMentions:{parse:[]}});
      return await i.editReply('Your report has been sent to staff.');
    }
    if(n==='close') {
      const owner=store.get(`owner:${i.channelId}`);
      if(!owner) throw new Error('This is not an open Mara ticket.');
      if(owner!==i.user.id && !actor.permissions.has(P.ManageChannels) && !actor.roles.cache.has(env.STAFF_ROLE_ID)) throw new Error('Only the ticket owner or staff can close it.');
      await i.channel.permissionOverwrites.edit(owner,{ViewChannel:false,SendMessages:false});
      await i.channel.setName(`closed-${owner}`);
      store.set(`ticket:${owner}`,null); store.set(`owner:${i.channelId}`,null);
      await audit(i.guild,`Ticket ${i.channelId} closed by ${i.user.id}; retained for staff.`);
      return await i.editReply('Ticket closed and retained for staff.');
    }
    throw new Error('Unknown command.');
  } catch(error) {
    console.error('Interaction failed:',error.code || error.name);
    const message=error.code ? 'Discord could not complete this action. Check Mara’s permissions, role order, and configured IDs.' : error.message;
    if(i.deferred || i.replied) await i.editReply({content:message}).catch(()=>{});
    else await i.reply({content:message,flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});
async function reactionRole(reaction,user,add) {
  if(user.bot || !allowed(reaction.message.guild) || reaction.emoji.name!=='✅') return;
  const roleId=store.get(`reaction:${reaction.message.id}`); if(!roleId) return;
  const g=reaction.message.guild, role=await g.roles.fetch(roleId), me=await g.members.fetchMe();
  if(!safeRole(role,me)) return;
  const member=await g.members.fetch(user.id);
  if(add) await member.roles.add(role); else await member.roles.remove(role);
}
client.on('messageReactionAdd',(r,u)=>reactionRole(r,u,true).catch(()=>console.error('Reaction role failed.')));
client.on('messageReactionRemove',(r,u)=>reactionRole(r,u,false).catch(()=>console.error('Reaction role failed.')));
client.on('guildMemberAdd',async m=>{
  if(!allowed(m.guild)) return;
  await audit(m.guild,`JOIN | ${m.user.tag} | ${m.id}`);
  if(env.WELCOME_CHANNEL_ID) await textChannel(m.guild,env.WELCOME_CHANNEL_ID).then(c=>c.send({content:`Welcome <@${m.id}> to The Blacklisted. I’m Mara. Read the rules and use the verification panel to get started.`,allowedMentions:{users:[m.id]}})).catch(()=>console.error('Welcome failed.'));
});
client.on('guildMemberRemove',m=>{if(allowed(m.guild)) void audit(m.guild,`LEAVE | ${m.user.tag} | ${m.id}`);});
client.on('messageDelete',m=>{if(allowed(m.guild)&&!m.author?.bot&&m.channelId!==env.LOG_CHANNEL_ID) void audit(m.guild,`DELETE | channel ${m.channelId} | message ${m.id} | author ${m.author?.id||'uncached'}\n${m.content||'[content unavailable]'}`);});
client.on('messageUpdate',(a,b)=>{if(allowed(b.guild)&&!b.author?.bot&&b.channelId!==env.LOG_CHANNEL_ID&&a.content!==b.content) void audit(b.guild,`EDIT | channel ${b.channelId} | message ${b.id}\nBefore: ${(a.content||'[uncached]').slice(0,850)}\nAfter: ${(b.content||'[unavailable]').slice(0,850)}`);});
client.once('clientReady',c=>console.log(`Mara online as ${c.user.tag}`));
client.on('error',e=>console.error('Discord client error:',e.code||e.name));
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{client.destroy();store.close();process.exit(0);});
await client.login(env.DISCORD_TOKEN);
