import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { config } from './config.js';
export function isTicketStaff(member,env) { return member.permissions.has(P.ManageChannels)||member.roles.cache.has(env.STAFF_ROLE_ID); }
export async function collectTranscript(channel,limit=5000) {
  let before, messages=[];
  while(messages.length<limit) {
    const batch=await channel.messages.fetch({limit:Math.min(100,limit-messages.length),...(before?{before}:{})});
    if(!batch.size) break;
    const ordered=[...batch.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
    messages.push(...ordered); before=ordered[0].id;
    if(batch.size<100) break;
  }
  messages.sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
  return {count:messages.length,truncated:messages.length===limit,text:messages.map(m=>new Date(m.createdTimestamp).toISOString()+' | '+m.author.tag+' ('+m.author.id+')\n'+(m.content||'[no text]')+'\n'+[...m.attachments.values()].map(a=>a.url).join('\n')).join('\n\n')};
}
export function createTickets({store,env,client,audit,ai,dataDir}) {
  const locks=new Set();
  function metadata(channelId) {
    return store.get('ticket-meta:'+channelId) || (store.get('owner:'+channelId)?{owner:store.get('owner:'+channelId),status:'open',category:'General support'}:null);
  }
  const check=(i,actor,staffOnly=false)=>{
    const info=metadata(i.channelId);
    if(!info) throw Error('Use this command inside a Mara ticket.');
    if(staffOnly?!isTicketStaff(actor,env):(info.owner!==actor.id&&!isTicketStaff(actor,env))) throw Error('You do not have access to manage this ticket.');
    if(!i.channel.permissionsFor(actor)?.has([P.ViewChannel,P.ReadMessageHistory])) throw Error('You cannot read this ticket.');
    return info;
  };
  async function transcript(i,actor) {
    check(i,actor);
    if(locks.has('export:'+i.channelId)) throw Error('A transcript is already being prepared.');
    locks.add('export:'+i.channelId);
    try {
      const result=await collectTranscript(i.channel), dir=join(dataDir,'transcripts');
      await mkdir(dir,{recursive:true});
      const maxCharacters=1500000;
      const text='Mara ticket '+i.channelId+'\nExported: '+new Date().toISOString()+'\n'+(result.truncated?'Limited to the most recent 5000 messages.\n':'')+(result.text.length>maxCharacters?'Text additionally limited to 1.5 million characters.\n':'')+'Attachment links may expire; attachments are not downloaded.\n\n'+result.text.slice(0,maxCharacters);
      await writeFile(join(dir,i.channelId+'.txt'),text,'utf8');
      return {attachment:Buffer.from(text),name:'ticket-'+i.channelId+'.txt'};
    } finally {locks.delete('export:'+i.channelId);}
  }
  return {
    metadata, transcript,
    async open(i,category) {
      const key='ticket:'+i.user.id;
      if(locks.has(key)) throw Error('Your ticket is being created.');
      locks.add(key);
      try {
        const existing=store.get(key);
        if(existing&&await i.guild.channels.fetch(existing).catch(()=>null)) return await i.editReply('Your existing ticket: <#'+existing+'>');
        const staff=await i.guild.roles.fetch(env.STAFF_ROLE_ID||'0');
        if(!staff||staff.id===i.guild.id) throw Error('Configure STAFF_ROLE_ID with /config first.');
        const categories=config(store).ticketCategories;
        if(!categories.includes(category)) throw Error('That category changed. Open the ticket panel again.');
        const channel=await i.guild.channels.create({name:'ticket-'+i.user.id,type:ChannelType.GuildText,parent:env.TICKET_CATEGORY_ID||undefined,permissionOverwrites:[
          {id:i.guild.id,deny:[P.ViewChannel]},
          {id:i.user.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles]},
          {id:staff.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory]},
          {id:client.user.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.ManageChannels]}
        ]});
        store.set(key,channel.id); store.set('owner:'+channel.id,i.user.id);
        store.set('ticket-meta:'+channel.id,{owner:i.user.id,status:'open',category,created:Date.now(),claimedBy:null});
        await channel.send({embeds:[{color:0x9B7BDA,title:'Mara • '+category,description:'Tell us what happened and how we can help.\nStaff: use /ticket-claim.\nUse /close when you are ready to finish.'}],allowedMentions:{parse:[]}}).catch(()=>{});
        await audit(i.guild,'Ticket opened by '+i.user.tag+': '+channel.id);
        return await i.editReply('Your private ticket: <#'+channel.id+'>');
      } finally {locks.delete(key);}
    },
    async claim(i,actor) {
      const info=check(i,actor,true);
      if(info.status!=='open') throw Error('This ticket is closed.');
      if(info.claimedBy&&info.claimedBy!==actor.id) throw Error('This ticket is already claimed by another staff member.');
      info.claimedBy=actor.id; store.set('ticket-meta:'+i.channelId,info);
      await audit(i.guild,'Ticket '+i.channelId+' claimed by '+actor.id);
      return await i.editReply('Ticket assigned to you.');
    },
    async close(i,actor,confirmed=false) {
      const info=check(i,actor);
      if(info.status!=='open') return await i.editReply('This ticket is already closed.');
      if(!confirmed) return await i.editReply({content:'Close this ticket? Mara will save a text transcript and keep the channel for staff.',components:[{type:1,components:[{type:2,style:4,custom_id:'ticket-confirm-close',label:'Confirm close'}]}]});
      if(locks.has('close:'+i.channelId)) throw Error('This ticket is already closing.');
      locks.add('close:'+i.channelId);
      try {
        const file=await transcript(i,actor);
        await i.channel.permissionOverwrites.edit(info.owner,{ViewChannel:false,SendMessages:false});
        info.status='closed'; info.closedAt=Date.now(); info.closedBy=actor.id;
        store.set('ticket-meta:'+i.channelId,info);
        store.delete('owner:'+i.channelId);
        if(store.get('ticket:'+info.owner)===i.channelId) store.delete('ticket:'+info.owner);
        await i.channel.setName('closed-'+info.owner).catch(()=>{});
        await audit(i.guild,'Ticket '+i.channelId+' closed by '+actor.id+'; transcript saved.');
        await client.users.fetch(info.owner).then(u=>u.send('Your Mara ticket is closed. Rate your experience in the server with /ticket-feedback ticket:'+i.channelId+' rating:1–5.')).catch(()=>{});
        return await i.editReply({content:'Ticket closed. Transcript saved for staff; keep this copy if you need it.',files:[file],components:[]});
      } finally {locks.delete('close:'+i.channelId);}
    },
    async feedback(i) {
      const id=i.options.getString('ticket',true), info=metadata(id);
      if(!info||info.status!=='closed'||info.owner!==i.user.id) throw Error('You can only rate your own closed ticket.');
      if(info.rating) throw Error('You already rated this ticket.');
      info.rating=i.options.getInteger('rating',true); store.set('ticket-meta:'+id,info);
      return await i.editReply('Thank you. Your '+info.rating+'/5 feedback has been saved.');
    },
    async assist(i,actor,mode) {
      check(i,actor,true);
      const history=await collectTranscript(i.channel,50);
      const draft=await ai.summarize(history.text.slice(-4000),mode);
      return await i.editReply('AI draft — review before using:\n'+draft);
    }
  };
}
