import {PermissionFlagsBits as P} from 'discord.js';
import {baseName} from './channel-style.js';

const mask=names=>names.reduce((value,name)=>value|P[name],0n);
const read=mask(['ViewChannel','ReadMessageHistory']);
const write=mask(['SendMessages','AddReactions','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads','SendVoiceMessages','SendPolls']);
const participate=read|write|mask(['EmbedLinks','AttachFiles','UseApplicationCommands','Connect','Speak','Stream','UseVAD']);
const manage=[P.ViewChannel,P.ManageChannels,P.ManageRoles];
const key=guildId=>'category-permissions:backup:'+guildId;
const running=new Set();
const overwrite=(id,type,allow=0n,deny=0n)=>({id,type,allow:String(allow),deny:String(deny)});
export const snapshotOverwrites=channel=>Array.from(channel.permissionOverwrites.cache.values(),o=>overwrite(o.id,o.type,o.allow.bitfield,o.deny.bitfield));
export const sameOverwrites=(a,b)=>JSON.stringify([...a].sort((x,y)=>x.id.localeCompare(y.id)))===JSON.stringify([...b].sort((x,y)=>x.id.localeCompare(y.id)));

export function categoryKind(name) {
  const words=baseName(name).toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const kinds=['info','community','voice','staff'].filter(kind=>words.includes(kind));
  return kinds.length===1?kinds[0]:null;
}
export function presetOverwrites(kind,{guildId,verifiedId,staffId,botId}) {
  const info=kind==='info';
  const rows=[overwrite(guildId,0,info?read:0n,(info?write|P.Connect:P.ViewChannel|P.Connect)|P.MentionEveryone)];
  if(kind==='community'||kind==='voice')rows.push(overwrite(verifiedId,0,participate));
  rows.push(overwrite(staffId,0,participate),overwrite(botId,1,participate|P.ManageChannels|P.ManageRoles));
  return rows;
}
export function permissionPlan(channels,ids,{ticketCategoryId,ticketIds=[]}={}) {
  const targets=[],skipped=[];
  const tickets=new Set(ticketIds);
  for(const category of channels.values()) {
    if(category?.type!==4)continue;
    const kind=categoryKind(category.name);
    if(!kind){skipped.push(category.name+': unrecognized or ambiguous category name');continue;}
    const children=Array.from(channels.values()).filter(c=>c?.parentId===category.id);
    if(category.id===ticketCategoryId||children.some(c=>tickets.has(c.id)||/^ticket-/i.test(baseName(c.name)))) {
      skipped.push(category.name+': ticket area; private ticket permissions are preserved');continue;
    }
    if(children.some(c=>![0,2,5,13,15,16].includes(c.type))) {
      skipped.push(category.name+': contains an unsupported channel type');continue;
    }
    const after=presetOverwrites(kind,ids);
    for(const channel of [category,...children])targets.push({id:channel.id,name:channel.name,type:channel.type,parentId:channel.parentId??null,kind,before:snapshotOverwrites(channel),after});
  }
  // Change categories first; Discord can automatically propagate their overwrites.
  targets.sort((a,b)=>(a.type===4?0:1)-(b.type===4?0:1));
  return {targets,skipped};
}

async function checkedContext(i,actor,env,restoring=false) {
  const fresh=await i.guild.members.fetch({user:actor.id,force:true});
  if(!fresh.permissions.has(P.Administrator))throw Error('Administrator is required to replace category and channel permissions.');
  await i.guild.roles.fetch();
  const me=await i.guild.members.fetchMe();
  if(!me.permissions.has([P.ManageChannels,P.ManageRoles]))throw Error('Mara needs Manage Channels and Manage Roles.');
  if(restoring)return {me};
  const verified=i.guild.roles.cache.get(env.VERIFIED_ROLE_ID),staff=i.guild.roles.cache.get(env.STAFF_ROLE_ID);
  if(!verified||!staff||verified.id===staff.id||[verified,staff].some(role=>role.id===i.guild.id||role.managed))throw Error('Configure separate, existing Verified and Staff roles with /config first.');
  if(verified.permissions.has(P.Administrator)||verified.permissions.has(P.ManageRoles)||verified.permissions.has(P.ManageChannels))throw Error('The Verified role must not have administrator or permission-management powers.');
  return {me,ids:{guildId:i.guild.id,verifiedId:verified.id,staffId:staff.id,botId:me.id}};
}
async function preflight(guild,targets,me,restoring=false) {
  const live=await guild.channels.fetch();
  for(const t of targets) {
    const c=live.get(t.id);
    if(!c||c.type!==t.type||(c.parentId??null)!==t.parentId)throw Error('A target was deleted or moved. Preview again before changing permissions.');
    if(!c.permissionsFor(me)?.has(manage))throw Error('Mara needs View Channel, Manage Channels and Manage Roles in '+t.name+'.');
    const current=snapshotOverwrites(c);
    const parentOriginal=targets.find(p=>p.id===t.parentId)?.before;
    if(!sameOverwrites(current,t.before)&&!(restoring&&(sameOverwrites(current,t.after)||(parentOriginal&&sameOverwrites(current,parentOriginal)))))throw Error('Permissions changed in '+t.name+'. Review them before continuing.');
  }
}
export async function categoryPermissions(i,actor,{env,store,audit}) {
  const action=i.options.getString('action')||'preview';
  if(!['preview','apply','restore'].includes(action))throw Error('Choose preview, apply, or restore.');
  if(running.has(i.guild.id))throw Error('A category permission update is already running.');
  running.add(i.guild.id);
  try {
    const {me,ids}=await checkedContext(i,actor,env,action==='restore');
    let plan,backup;
    if(action==='restore') {
      backup=store.get(key(i.guild.id));
      if(!backup||backup.restored)throw Error('There is no permission backup to restore.');
      plan={targets:backup.targets,skipped:[]};
    } else {
      const channels=await i.guild.channels.fetch();
      plan=permissionPlan(channels,ids,{ticketCategoryId:env.TICKET_CATEGORY_ID,ticketIds:store.list('ticket-meta:').map(r=>r.key.slice(12))});
    }
    if(!plan.targets.length)throw Error('No eligible Info, Community, Voice or Staff categories were found.');
    await preflight(i.guild,plan.targets,me,action==='restore');
    const changed=plan.targets.filter(t=>!sameOverwrites(t.before,t.after));
    const report=[
      'Info: everyone can read; only Staff and Mara can post.',
      'Community and Voice: Verified members, Staff and Mara can view and participate.',
      'Staff: only Staff and Mara can view and participate.',
      'Administrator roles and the server owner always bypass channel restrictions.',
      'Applying replaces ALL role/member overrides in listed categories and channels, including individual exceptions. Child channels become synced.',
      'Ticket areas and unknown categories are skipped. No server roles or role memberships are changed.',
      ...plan.targets.map(t=>t.kind.toUpperCase()+' | '+t.name+' ['+t.id+'] | '+(sameOverwrites(t.before,t.after)?'already correct':'replace '+t.before.length+' overwrites')),
      ...plan.skipped.map(s=>'SKIPPED '+s)
    ];
    if(action==='preview') {
      await i.editReply({content:'Permission preview: '+changed.length+' of '+plan.targets.length+' categories/channels need changes. Read the attached plan, then use /category-permissions action:apply. Individual channel exceptions will be replaced.',files:[{attachment:Buffer.from(report.join('\n')),name:'category-permissions-preview.txt'}],allowedMentions:{parse:[]}});return;
    }
    if(action==='apply'&&!changed.length) {
      await i.editReply({content:'The recognized categories and channels already match the preset. Your previous backup was kept.',allowedMentions:{parse:[]}});return;
    }
    if(action==='apply') {
      const old=store.get(key(i.guild.id));
      if(old?.status==='partial')throw Error('The previous update was interrupted. Restore its backup before applying again.');
      backup={guildId:i.guild.id,actor:actor.id,created:Date.now(),status:'partial',targets:plan.targets};
      store.set(key(i.guild.id),backup);
    }
    await i.editReply({content:(action==='restore'?'Restoring':'Applying')+' category permissions. Please wait. A backup is saved for /category-permissions action:restore.',allowedMentions:{parse:[]}});
    let updated=0;
    const started=Date.now();
    try {
      for(const t of plan.targets) {
        if(Date.now()-started>8*60*1000)throw Error('Time limit reached. Restore the saved backup before retrying.');
        const freshActor=await i.guild.members.fetch({user:actor.id,force:true});
        if(!freshActor.permissions.has(P.Administrator))throw Error('Administrator permission was removed; stopped.');
        const c=await i.guild.channels.fetch(t.id,{force:true});
        if(!c||c.type!==t.type||(c.parentId??null)!==t.parentId)throw Error('A target was moved or deleted; stopped.');
        const current=snapshotOverwrites(c),parentOriginal=plan.targets.find(p=>p.id===t.parentId)?.before;
        if(!sameOverwrites(current,t.before)&&!sameOverwrites(current,t.after)&&!(action==='restore'&&parentOriginal&&sameOverwrites(current,parentOriginal)))throw Error('Permissions changed during the run; stopped rather than replacing the new edits.');
        const desired=action==='restore'?t.before:t.after;
        if(!sameOverwrites(snapshotOverwrites(c),desired)) {
          await c.permissionOverwrites.set(desired.map(o=>({...o,allow:BigInt(o.allow),deny:BigInt(o.deny)})),'Category permission '+action+' by '+actor.id);
          updated++;
        }
      }
      const verified=await i.guild.channels.fetch();
      if(plan.targets.some(t=>!verified.get(t.id)||!sameOverwrites(snapshotOverwrites(verified.get(t.id)),action==='restore'?t.before:t.after)))throw Error('Some permissions could not be verified. Restore the backup before retrying.');
      backup.status=action==='restore'?'restored':'complete';backup.restored=action==='restore';
      store.set(key(i.guild.id),backup);
      await audit(i.guild,'Category permissions '+action+' | staff '+actor.id+' | targets '+plan.targets.length);
      await i.editReply({content:action==='restore'?'Previous category and channel permissions restored.':'Permissions applied and verified for '+plan.targets.length+' categories/channels. '+plan.skipped.length+' categories skipped. Undo with /category-permissions action:restore.',files:[{attachment:Buffer.from(JSON.stringify(backup,null,2)),name:'category-permissions-backup.json'}],allowedMentions:{parse:[]}});
    } catch(error) {
      backup.status='partial';store.set(key(i.guild.id),backup);
      await i.editReply({content:'Permission update stopped after '+updated+' direct changes; category changes may also have synced children. '+(error.code?'Discord rejected a permission change.':error.message)+' Backup saved. Use /category-permissions action:restore to undo.',files:[{attachment:Buffer.from(JSON.stringify(backup,null,2)),name:'category-permissions-backup.json'}],allowedMentions:{parse:[]}});
    }
  } finally {running.delete(i.guild.id);}
}
