import { sendWelcome } from './welcome.js';
import { panelTargetId } from './panel-target.js';
import { postRulesPanel } from './rules.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client, GatewayIntentBits as I, Partials, PermissionFlagsBits as P, ChannelType, MessageFlags } from 'discord.js';
import { createStore } from './store.js';
import { canTarget, safeRole } from './security.js';
import { createAutomod, settings, validateAutomod } from './automod.js';
import { createAI } from './ai.js';
import { logCard } from './log-style.js';
import { setupCheck } from './setup-check.js';
import { config, runtimeEnv } from './config.js';
import { createDelivery, createBackups, privateChannel } from './reliability.js';
import { createVerification, verificationGate, rulesVersion, rulesCard } from './verification.js';
import { createTickets } from './tickets.js';
import { createStaffTools } from './staff-tools.js';
import { createRaidGuard } from './raid.js';
import { createDashboard } from './dashboard.js';
import { escalateWarning } from './escalation.js';
for (const key of ['DISCORD_TOKEN','GUILD_ID']) if (!process.env[key]) throw new Error(`Missing ${key}`);
if (process.env.RAILWAY_ENVIRONMENT_ID && process.env.DATA_DIR !== '/data') throw new Error('Set DATA_DIR=/data and attach a Railway volume at /data.');
const baseEnv = process.env;
const ai = createAI(baseEnv);
const dataDir=baseEnv.DATA_DIR || './data';
mkdirSync(dataDir,{recursive:true});
const store = createStore(join(dataDir,'mara.sqlite'));
const env=runtimeEnv(store,baseEnv);
const client = new Client({intents:[I.Guilds,I.GuildMembers,I.GuildMessages,I.GuildMessageReactions,I.MessageContent,I.GuildModeration],partials:[Partials.Message,Partials.Channel,Partials.Reaction],allowedMentions:{parse:[]}});
const allowed = g => g?.id === env.GUILD_ID;
const row = (id,label) => [{type:1,components:[{type:2,style:2,custom_id:id,label}]}];
const delivery=createDelivery({store,client,env});
const backupNow=createBackups(store,dataDir);
const requirePermission = (member, p) => { if (!member.permissions.has(p)) throw new Error('You do not have permission to do that.'); };
async function textChannel(g,id) { const c = await g.channels.fetch(id); if (!c || c.type !== ChannelType.GuildText) throw new Error('Configure a valid server text channel.'); return c; }
async function audit(g,text) {
  if (!env.LOG_CHANNEL_ID) { console.warn('LOG_CHANNEL_ID is not configured.'); return; }
  try { delivery.enqueue(env.LOG_CHANNEL_ID,logCard(text,client.user?.displayAvatarURL())); }
  catch { console.error('Could not deliver an audit log. Check channel permissions.'); }
}
const verification=createVerification({store,env,audit});
const tickets=createTickets({store,env,client,audit,ai,dataDir});
const staffTools=createStaffTools({store,env,audit,backupNow,verification,tickets});
const raidGuard=createRaidGuard({store,audit});
let dashboard;
if(env.DASHBOARD_ENABLED==='true') {
  dashboard=createDashboard({client,store,env,verification,audit});
  dashboard.listen(Number(env.PORT||3000),'0.0.0.0',()=>console.log('Mara dashboard listening.'));
}
const moderate = createAutomod({ store, env, audit, ai });
client.on('messageCreate', m => moderate(m).catch(() => console.error('Automod failed; check configuration and permissions.')));
client.on('messageUpdate', (before, after) => {
  if (before.content !== after.content) void moderate(after, { edited: true }).catch(() => console.error('Automod edit check failed.'));
});
client.on('interactionCreate',async i => {
  if (!i.isChatInputCommand() && !i.isButton() && !i.isStringSelectMenu()) return;
  if (!allowed(i.guild)) return i.reply({content:'Mara is configured for a different server.',flags:MessageFlags.Ephemeral});
  try {
    await i.deferReply({flags:MessageFlags.Ephemeral});
    const actor = await i.guild.members.fetch(i.user.id);
    const me = await i.guild.members.fetchMe();
    if(i.isStringSelectMenu()) {
      if(i.customId==='ticket-category') return await tickets.open(i,i.values[0]);
      throw Error('Unknown selection.');
    }
    if (i.isButton()) {
      if(i.customId==='ticket-confirm-close') return await tickets.close(i,actor,true);
      if(i.customId==='verify-review') return await i.editReply(await verification.request(actor));
      if (i.customId === 'ticket') return await i.editReply({content:'What can we help with?',components:[{type:1,components:[{type:3,custom_id:'ticket-category',placeholder:'Choose a ticket category',options:config(store).ticketCategories.map(name=>({label:name,value:name}))}]}]});
      if (i.customId !== 'verify' && !i.customId.startsWith('verify-accept:')) throw new Error('Unknown button.');
      if(i.customId==='verify') return await i.editReply(rulesCard(config(store)));
      if(i.customId !== 'verify-accept:'+rulesVersion(config(store).verificationRules)) return await i.editReply(rulesCard(config(store)));
      const cfg=config(store),gate=verificationGate(actor,cfg,store.get('raid:pausedUntil',0));
      if(gate) return await i.editReply({content:gate,components:row('verify-review','Request staff review')});
      if(cfg.captcha) {
        if(env.DASHBOARD_ENABLED!=='true'||!env.PUBLIC_BASE_URL) throw Error('Verification website is unavailable. Ask staff for help.');
        return await i.editReply({content:'Rules accepted. Continue with Discord on Mara’s verification page to complete the CAPTCHA.',components:[{type:1,components:[{type:2,style:5,label:'Verify with Mara',url:new URL('/verify',env.PUBLIC_BASE_URL).href}]}]});
      }
      return await i.editReply(await verification.grant(actor));
    }
    const n=i.commandName, o=i.options;
    const reason=o.getString('reason');
    const s = name => o.getString(name,true);
    if(await staffTools(i,actor)) return;
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
      store.set('automod', validateAutomod(config));
      return await i.editReply(`Automod: ${config.enabled ? 'on' : 'off'} | action: ${config.action}\nInvites: ${config.blockInvites ? 'blocked' : 'allowed'} | mention limit: ${config.mentionLimit} | flood: ${config.spamLimit} messages / 10 seconds\nBlocked phrases: ${config.blockedWords.length}\nAI review: ${env.AI_ENABLED === 'true' && env.OPENAI_API_KEY ? ai.channelScope : 'off'}`);
    }
    if (n === 'ai-summary') {
      requirePermission(actor, P.ModerateMembers);
      const summary = await ai.summarize(s('text'));
      return await i.editReply({ content: `AI draft — verify against the original report.\n${summary}`, allowedMentions: { parse: [] } });
    }
    if (n==='help') return await i.editReply('Mara • The Blacklisted\nModeration: /warn /warnings /warn-remove /case /history /timeout /untimeout /kick /ban /unban /purge\nSetup: /category-permissions /rules /channel-style /channel-style-bulk /setup-check /config /welcome /panel /rolepanel /automod /protection /verification /raid /escalation /backup\nTickets: /ticket-claim /ticket-transcript /ticket-ai /ticket-feedback /ticket-categories /close\nAI: /ai-summary /ai-context\nMembers: /custom /report\nStaff review: /verification-review\nMessages: /announce /custom-set /custom-delete');
    if (['warn','warnings','timeout','untimeout','kick','ban'].includes(n)) {
      requirePermission(actor,n==='kick'?P.KickMembers:n==='ban'?P.BanMembers:P.ModerateMembers);
      const target=await i.guild.members.fetch(o.getUser('user',true).id);
      if (n==='warnings') return await i.editReply(('Active warnings: '+store.warningCount(target.id)+'\n'+store.cases({target:target.id,limit:100}).filter(c=>c.type==='warn'&&!c.revoked).slice(0,10).map(c=>'#'+c.id+' • '+c.reason).join('\n')).slice(0,1950));
      if (!canTarget(actor,target,i.guild.ownerId)) throw new Error('You cannot moderate yourself, the owner, bots, or equal/higher roles.');
      const why=`${i.user.tag}: ${reason}`.slice(0,512);
      if(n==='timeout') { if(!target.moderatable) throw new Error('Mara cannot timeout that member. Check permissions and role order.'); await target.timeout(o.getInteger('minutes',true)*60000,why); }
      if(n==='untimeout') {
        if(!target.moderatable) throw new Error('Mara cannot change that member’s timeout. Check Moderate Members and role order.');
        if(!target.isCommunicationDisabled()) return await i.editReply('That member is not currently timed out.');
        await target.timeout(null,why);
      }
      if(n==='kick') { if(!target.kickable) throw new Error('Mara cannot kick that member.'); await target.kick(why); }
      if(n==='ban') { if(!target.bannable) throw new Error('Mara cannot ban that member.'); await target.ban({reason:why,deleteMessageSeconds:0}); }
      const caseId=store.addCase({type:n,target:target.id,actor:i.user.id,reason});
      const extra=n==='warn'?await escalateWarning({store,target,caseId,botId:client.user.id}):'';
      await audit(i.guild,`${n.toUpperCase()} | target ${target.id} | staff ${i.user.id} | Case #${caseId}: ${reason}${extra}`);
      return await i.editReply(`${n} recorded for ${target.user.tag}. Case #${caseId}.${extra}`);
    }
    if(n==='purge') {
      requirePermission(actor,P.ManageMessages);
      if(i.channel?.type!==ChannelType.GuildText) throw new Error('Use this in a server text channel.');
      const deleted=await i.channel.bulkDelete(o.getInteger('count',true),true);
      store.addCase({type:'purge',target:i.channelId,actor:i.user.id,reason:deleted.size+' messages deleted'});
      await audit(i.guild,`PURGE | ${i.user.id} | ${i.channelId} | ${deleted.size} messages`);
      return await i.editReply(`Deleted ${deleted.size} messages. Messages older than 14 days are skipped.`);
    }
    if(['announce','panel','rolepanel','custom-set','custom-delete'].includes(n)) requirePermission(actor,P.ManageGuild);
    if(n==='announce'||n==='panel'||n==='rolepanel') {
      const c=await textChannel(i.guild,n==='panel'?panelTargetId(i):o.getChannel('channel',true).id);
      if(!c.permissionsFor(actor).has([P.ViewChannel,P.SendMessages])) throw new Error('You cannot post in that channel.');
      if(n==='announce') await c.send({content:s('text')});
      if(n==='panel') {
        const kind=s('kind');
        if(kind==='rules') {
          if(!await postRulesPanel(i,c,actor,me,config(store))) return;
        } else if (kind === 'verify') {
          const panel={
            embeds: [{
              color: 0x9B7BDA,
              author: { name: 'MARA • THE BLACKLISTED', icon_url: client.user.displayAvatarURL() },
              title: 'Your place in The Blacklisted starts here.',
              description: 'Welcome in. I’m **Mara**, your server guide.\nClick Verify to view the rules, accept them, and complete any required CAPTCHA.',
              fields: [
                { name: '01  •  Read the rules', value: 'Take a moment to review the server rules before joining the conversation.' },
                { name: '02  •  Make it official', value: 'Accept the rules in the private message, then complete CAPTCHA if enabled.' },
                { name: 'Need a hand?', value: 'If verification fails, contact a staff member and they’ll help you get settled.' }
              ],
              footer: { text: 'Rules acceptance + optional CAPTCHA • Does not prove age or identity' }
            }],
            components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: 'verify', label: 'Verify', emoji: { name: '✅' } }] }]
          };
          if(o.getBoolean('preview')) { for(const row of panel.components) for(const component of row.components) component.disabled=true; return await i.editReply(panel); }
          await c.send(panel);
        } else {
          const panel={embeds:[{color:0x9B7BDA,title:'Mara • Here to help',description:'Open a private ticket, choose a category, and tell us what you need. A staff member will take it from there.'}],components:row(kind,'Open a ticket')};
          if(o.getBoolean('preview')) { for(const row of panel.components) for(const component of row.components) component.disabled=true; return await i.editReply(panel); }
          await c.send(panel);
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
      await i.guild.roles.fetch();
      if(!privateChannel(c,i.guild,env.STAFF_ROLE_ID,client.user.id)) throw new Error('Reports are disabled until the log channel permits only the configured staff role, Mara and administrators.');
      const report = `PRIVATE REPORT | reporter ${i.user.id} | member ${o.getUser('user',true).id}\n${reason}`;
      const deliveryId=delivery.enqueue(c.id,logCard(report,client.user.displayAvatarURL()),true);
      store.set(key,Date.now());
      store.addCase({type:'report',target:o.getUser('user',true).id,actor:i.user.id,reason});
      return await i.editReply('Your report is saved for staff delivery. Reference #'+deliveryId+'.');
    }
    if(n==='close') {
      return await tickets.close(i,actor);

    }
    throw new Error('Unknown command.');
  } catch(error) {
    const errorId=i.id;
    store.set('health:interaction',{time:Date.now(),id:errorId,code:String(error.code||error.name)});
    console.error('Interaction failed:',errorId,error.code || error.name);
    const message=Number(error.code)===50035 ? 'Discord rejected the message formatting. This is a Mara formatting issue, not a request to change your permissions. Reference: '+errorId : error.code ? 'Discord could not complete this action. Check Mara’s permissions, role order, and configured IDs. Reference: '+errorId : error.message;
    if(i.deferred || i.replied) await i.editReply({content:message}).catch(()=>{});
    else await i.reply({content:message,flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});
async function reactionRole(reaction,user,add) {
  if(user.bot || !allowed(reaction.message.guild) || reaction.emoji.name!=='✅') return;
  const roleId=store.get(`reaction:${reaction.message.id}`); if(!roleId) return;
  const g=reaction.message.guild, role=await g.roles.fetch(roleId), me=await g.members.fetchMe();
  if(roleId===env.VERIFIED_ROLE_ID) return;
  if(!safeRole(role,me)) return;
  const member=await g.members.fetch(user.id);
  if(add) await member.roles.add(role); else await member.roles.remove(role);
}
client.on('messageReactionAdd',(r,u)=>reactionRole(r,u,true).catch(()=>console.error('Reaction role failed.')));
client.on('messageReactionRemove',(r,u)=>reactionRole(r,u,false).catch(()=>console.error('Reaction role failed.')));
client.on('guildMemberAdd',async m=>{
  if(!allowed(m.guild)) return;
  await audit(m.guild,`JOIN | ${m.user.tag} | ${m.id}`);
  await verification.assignUnverified(m).catch(async()=>{console.error('Unverified role assignment failed. Check role configuration and permissions.');await audit(m.guild,'Unverified role assignment failed for '+m.id+'. Check /config and role hierarchy.');});
  await raidGuard(m).catch(()=>console.error('Raid check failed.'));
  if(env.WELCOME_CHANNEL_ID) await textChannel(m.guild,env.WELCOME_CHANNEL_ID).then(c=>sendWelcome(c,m,config(store).welcomeText)).catch(()=>console.error('Welcome failed.'));
});
client.on('guildMemberRemove',m=>{if(allowed(m.guild)) void audit(m.guild,`LEAVE | ${m.user.tag} | ${m.id}`);});
client.on('messageDelete',m=>{if(allowed(m.guild)&&!m.author?.bot&&m.channelId!==env.LOG_CHANNEL_ID) void audit(m.guild,`DELETE | channel ${m.channelId} | message ${m.id} | author ${m.author?.id||'uncached'}\n${m.content||'[content unavailable]'}`);});
client.on('messageUpdate',(a,b)=>{if(allowed(b.guild)&&!b.author?.bot&&b.channelId!==env.LOG_CHANNEL_ID&&a.content!==b.content) void audit(b.guild,`EDIT | channel ${b.channelId} | message ${b.id}\nBefore: ${(a.content||'[uncached]').slice(0,850)}\nAfter: ${(b.content||'[unavailable]').slice(0,850)}`);});
const timers=[];
client.once('clientReady',c=>{
  console.log(`Mara online as ${c.user.tag}`);
  void backupNow().catch(()=>console.error('Startup backup failed.'));
  void delivery.flush().catch(()=>console.error('Delivery queue processing failed.'));
  timers.push(setInterval(()=>{void delivery.flush().catch(()=>console.error('Delivery queue processing failed.'));},15000));
  timers.push(setInterval(()=>{void backupNow().catch(()=>console.error('Scheduled backup failed.'));},86400000));
  void c.guilds.fetch(env.GUILD_ID).then(g=>g.members.fetchMe().then(me=>setupCheck(g,env,me))).then(card=>console.log('Startup checks:',card.fields.map(f=>f.name+': '+f.value).join(' | '))).catch(()=>console.error('Startup checks failed. Run /setup-check.'));
});
client.on('error',e=>console.error('Discord client error:',e.code||e.name));
let stopping=false;
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,async()=>{
  if(stopping)return;stopping=true;timers.forEach(clearInterval);dashboard?.close();client.destroy();
  try {await backupNow();store.close();} catch {console.error('Shutdown backup failed.');} finally {process.exit(0);}
});
await client.login(env.DISCORD_TOKEN);
