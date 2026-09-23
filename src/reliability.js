import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PermissionFlagsBits as P, ChannelType } from 'discord.js';
export function privateChannel(channel,guild,staffRoleId,botId) {
  if(channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) return false;
  for(const overwrite of channel.permissionOverwrites.cache.values()) {
    if(!overwrite.allow.has(P.ViewChannel)) continue;
    if(overwrite.id===staffRoleId||overwrite.id===botId) continue;
    const role=guild.roles.cache.get(overwrite.id);
    if(role?.permissions.has(P.Administrator)||role?.tags?.botId===botId) continue;
    return false;
  }
  return true;
}
export function createDelivery({store,client,env}) {
  let busy=false;
  async function flush() {
    if(busy||!client.isReady()) return;
    busy=true;
    try {
      for(const item of store.pending()) {
        try {
          const guild=await client.guilds.fetch(env.GUILD_ID);
          const channel=await guild.channels.fetch(item.channel);
          if(!channel||channel.type!==ChannelType.GuildText) throw Error('Log channel unavailable');
          await guild.roles.fetch();
          if(item.private&&!privateChannel(channel,guild,env.STAFF_ROLE_ID,client.user.id)) throw Error('Private delivery blocked by channel permissions');
          const payload=JSON.parse(item.payload);
          const me=await guild.members.fetchMe();
          if(payload.embeds&&!channel.permissionsFor(me)?.has(P.EmbedLinks)) {
            payload.content=payload.embeds.map(e=>[e.title,e.description,...(e.fields||[]).map(f=>f.name+': '+f.value)].filter(Boolean).join('\n')).join('\n').slice(0,2000);
            delete payload.embeds;
          }
          await channel.send({...payload,allowedMentions:{parse:[]}});
          store.delivered(item.id);
        } catch { store.failed(item.id,item.attempts+1); store.set('health:delivery',{time:Date.now(),message:'Delivery pending. Check channel access and staff-only permissions.'}); }
      }
    } finally { busy=false; }
  }
  return { flush, enqueue(channel,payload,isPrivate=false) {
    if(!channel) throw Error('Configure the log channel first with /config.');
    if(store.queueSize()>=10000) throw Error('Delivery queue is full. Staff must fix log delivery first.');
    const id=store.enqueue(channel,payload,isPrivate); void flush().catch(()=>console.error('Delivery queue processing failed.')); return id;
  }};
}
export function createBackups(store,dataDir) {
  let running=null;
  return () => {
    if(running) return running;
    running=(async()=>{
      const dir=join(dataDir,'backups'); await mkdir(dir,{recursive:true});
      const name='mara-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite';
      await store.backup(join(dir,name));
      const files=(await readdir(dir)).filter(f=>/^mara-[\dTZ-]+\.sqlite$/.test(f)).sort().reverse();
      for(const old of files.slice(7)) await unlink(join(dir,old));
      store.set('health:backup',{time:Date.now(),name}); return name;
    })().finally(()=>{running=null;});
    return running;
  };
}
