import { PermissionFlagsBits as P, escapeMarkdown } from 'discord.js';

export const nameStyles = [
  {name:'Plain',value:'plain'},
  {name:'Small caps · ɢᴇɴᴇʀᴀʟ',value:'small-caps'},
  {name:'Bold serif · 𝐠𝐞𝐧𝐞𝐫𝐚𝐥',value:'bold'},
  {name:'Monospace · 𝚐𝚎𝚗𝚎𝚛𝚊𝚕',value:'mono'},
  {name:'Italic · 𝑔𝑒𝑛𝑒𝑟𝑎𝑙',value:'italic'},
  {name:'Bold italic · 𝒈𝒆𝒏𝒆𝒓𝒂𝒍',value:'bold-italic'},
  {name:'Script · 𝓰𝓮𝓷𝓮𝓻𝓪𝓵',value:'script'},
  {name:'Gothic · 𝖌𝖊𝖓𝖊𝖗𝖆𝖑',value:'gothic'},
  {name:'Double-struck · 𝕘𝕖𝕟𝕖𝕣𝕒𝕝',value:'double-struck'},
  {name:'Sans bold · 𝗴𝗲𝗻𝗲𝗿𝗮𝗹',value:'sans-bold'},
  {name:'Fullwidth · ｇｅｎｅｒａｌ',value:'fullwidth'}
];
export const nameDecorations = [
  {name:'None',value:'none'}, {name:'Star · ✦・',value:'star'},
  {name:'Flower · ❀・',value:'flower'}, {name:'Diamond · ◇・',value:'diamond'}
];
export const categoryDividers = [
  {name:'None',value:'none'},
  {name:'Lines · ━━ Community ━━',value:'lines'},
  {name:'Stars · ━━ ✦ Community ✦ ━━',value:'stars'},
  {name:'Brackets · ╭── Community ──╮',value:'brackets'}
];
const dividerFrames={none:['',''],lines:['━━ ',' ━━'],stars:['━━ ✦ ',' ✦ ━━'],brackets:['╭── ',' ──╮']};
function withoutDivider(name) {
  // Match the more specific star frame before the plain line frame.
  for(const key of ['stars','brackets','lines']) {
    const [left,right]=dividerFrames[key];
    if(name.startsWith(left)&&name.endsWith(right)) return name.slice(left.length,-right.length);
  }
  return name;
}
export const nameChannelTypes = [0,2,4,5,13,15,16];
const prefixes = {none:'',star:'✦・',flower:'❀・',diamond:'◇・'};
const smallCaps = Array.from('ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function lettering(upper,lower,digits=48,exceptions={}) {
  return new Map(Array.from(alphabet,c=>{
    const cp=c.charCodeAt(0);
    return [c,exceptions[c]||String.fromCodePoint(cp>=97?lower+cp-97:cp>=65?upper+cp-65:digits+cp-48)];
  }));
}
const letterMaps={
  bold:lettering(0x1d400,0x1d41a,0x1d7ce),
  mono:lettering(0x1d670,0x1d68a,0x1d7f6),
  italic:lettering(0x1d434,0x1d44e,48,{h:'ℎ'}),
  'bold-italic':lettering(0x1d468,0x1d482),
  script:lettering(0x1d4d0,0x1d4ea),
  gothic:lettering(0x1d56c,0x1d586),
  'double-struck':lettering(0x1d538,0x1d552,0x1d7d8,{C:'ℂ',H:'ℍ',N:'ℕ',P:'ℙ',Q:'ℚ',R:'ℝ',Z:'ℤ'}),
  'sans-bold':lettering(0x1d5d4,0x1d5ee,0x1d7ec),
  fullwidth:lettering(0xff21,0xff41,0xff10)
};
// Share the same mappings for encoding and decoding so bulk restyling is reversible.
const ordinaryLetters=new Map(Object.values(letterMaps).flatMap(map=>Array.from(map,([plain,styled])=>[styled,plain])));


export function styledName(name,style='plain',decoration='none',type=0,divider='none') {
  if(!nameStyles.some(s=>s.value===style)||!Object.hasOwn(prefixes,decoration)) throw Error('Choose a supported name style and decoration.');
  if(!Object.hasOwn(dividerFrames,divider)) throw Error('Choose a supported category divider.');
  if(divider!=='none'&&type!==4) throw Error('Dividers are for categories only.');
  if(!nameChannelTypes.includes(type)) throw Error('Choose a server channel or category, not a thread.');
  if(typeof name!=='string'||/[\p{Cc}\p{Cf}]/u.test(name)) throw Error('Enter a name without control or invisible formatting characters.');
  let base=type===4?withoutDivider(name.trim()):name.trim();
  if(!base) throw Error('Enter a name first.');
  if([0,5,15,16].includes(type)) base=base.toLowerCase().replace(/\s+/gu,'-');
  const letters=Array.from(base,c=>{
    if(style==='small-caps'&&/[a-z]/i.test(c)) return smallCaps[c.toLowerCase().charCodeAt(0)-97];
    return letterMaps[style]?.get(c)||c;
  }).join('');
  const [left,right]=dividerFrames[divider];
  const result=left+prefixes[decoration]+letters+right;
  if(result.length>100) throw Error('The styled name is too long. Use a shorter name (maximum 100 UTF-16 units including decoration and divider).');
  return result;
}

export async function styleChannel(i,actor,audit) {
  const selected=i.options.getChannel('channel',true);
  const channel=await i.guild.channels.fetch(selected.id);
  if(!channel||channel.guildId!==i.guild.id||!nameChannelTypes.includes(channel.type)) throw Error('Choose an existing channel or category in this server.');
  if(!channel.permissionsFor(actor)?.has([P.ViewChannel,P.ManageChannels])) throw Error('You need View Channel and Manage Channels on the selected channel or category.');
  const name=styledName(i.options.getString('name',true),i.options.getString('style',true),i.options.getString('decoration')||'none',channel.type,i.options.getString('divider')||'none');
  const oldName=channel.name;
  if(i.options.getBoolean('apply')!==true) return 'Name preview: '+escapeMarkdown(oldName)+' → '+escapeMarkdown(name)+'\nRun the same command with apply:True to rename this channel or category. Decorative letters may look different across devices.';
  const me=await i.guild.members.fetchMe();
  if(!channel.permissionsFor(me)?.has([P.ViewChannel,P.ManageChannels])) throw Error('Mara needs View Channel and Manage Channels on the selected channel or category.');
  if(oldName===name) return 'This channel or category already has that name.';
  const updated=await channel.setName(name,'Name styling by '+actor.id);
  await audit(i.guild,'Channel name updated | channel '+channel.id+' | staff '+actor.id+'\n'+oldName+' → '+updated.name);
  return 'Renamed '+escapeMarkdown(oldName)+' → '+escapeMarkdown(updated.name)+'.';
}

// Decode only lettering and prefixes supported by Mara; preserve other symbols.
export function baseName(name) {
  name=withoutDivider(name);
  for(const prefix of Object.values(prefixes).filter(Boolean)) {
    while(name.startsWith(prefix)) name=name.slice(prefix.length);
  }
  return Array.from(name,c=>{
    const small=smallCaps.indexOf(c);
    if(small>=0) return String.fromCharCode(97+small);
    return ordinaryLetters.get(c)||c;
  }).join('');
}

const bulkRuns=new Set();
export async function styleChannels(i,actor,audit) {
  const scope=i.options.getString('scope',true),style=i.options.getString('style',true);
  const decoration=i.options.getString('decoration')||'none',apply=i.options.getBoolean('apply')===true;
  const category=i.options.getChannel('category');
  const divider=i.options.getString('divider')||'none';
  if(divider!=='none'&&!['all','categories'].includes(scope)) throw Error('Choose All categories or All channels and categories to use dividers.');
  if(!['all','channels','categories','category'].includes(scope)) throw Error('Choose a valid scope.');
  if(scope==='category'&&!category) throw Error('Select a category for this scope.');
  if(scope!=='category'&&category) throw Error('Use the Within one category scope when selecting a category.');
  styledName('check',style,decoration,4,divider);
  if(bulkRuns.has(i.guild.id)) throw Error('A bulk rename is already running in this server. Wait for it to finish.');
  if(apply) bulkRuns.add(i.guild.id);
  try {
    const channels=await i.guild.channels.fetch();
    if(category) {
      const parent=channels.get(category.id);
      if(!parent||parent.type!==4||!parent.permissionsFor(actor)?.has([P.ViewChannel,P.ManageChannels])) throw Error('Select a category you can view and manage.');
    }
    const me=await i.guild.members.fetchMe();
    const plan=[],report=[];
    let skipped=0,unchanged=0,changed=0,failed=0;
    for(const channel of channels.values()) {
      if(!channel||channel.guildId!==i.guild.id||!nameChannelTypes.includes(channel.type)) continue;
      if(scope==='channels'&&channel.type===4||scope==='categories'&&channel.type!==4||scope==='category'&&channel.parentId!==category.id) continue;
      if(!channel.permissionsFor(actor)?.has([P.ViewChannel,P.ManageChannels])) {skipped++;continue;}
      if(!channel.permissionsFor(me)?.has([P.ViewChannel,P.ManageChannels])) {skipped++;report.push('SKIPPED '+channel.name+': Mara needs View Channel and Manage Channels.');continue;}
      try {
        const name=styledName(baseName(channel.name),style,decoration,channel.type,channel.type===4?divider:'none');
        if(name===channel.name) {unchanged++;continue;}
        plan.push({id:channel.id,before:channel.name,name});
      } catch(error) {skipped++;report.push('SKIPPED '+channel.name+': '+error.message);}
    }
    if(!apply) {
      report.unshift(...plan.map(p=>p.before+' → '+p.name));
    } else {
      await i.editReply({content:'Applying styles to '+plan.length+' channels/categories. Discord rate limits may slow this down. Please wait before starting another bulk change.',allowedMentions:{parse:[]}});
      const started=Date.now();
      for(let index=0;index<plan.length;index++) {
        const p=plan[index];
        if(Date.now()-started>8*60*1000) {
          skipped+=plan.length-index;
          report.push('STOPPED: time limit reached. Preview and run again to finish remaining names.');break;
        }
        try {
          const channel=await i.guild.channels.fetch(p.id,{force:true});
          const currentActor=await i.guild.members.fetch({user:actor.id,force:true});
          const currentBot=await i.guild.members.fetchMe();
          if(!channel||channel.name!==p.before||scope==='category'&&channel.parentId!==category.id) throw Error('Channel changed since planning; run a new preview.');
          if(!channel.permissionsFor(currentActor)?.has([P.ViewChannel,P.ManageChannels])||!channel.permissionsFor(currentBot)?.has([P.ViewChannel,P.ManageChannels])) throw Error('View Channel and Manage Channels are required.');
          const updated=await channel.setName(p.name,'Bulk name styling by '+actor.id);
          changed++;
          report.push('RENAMED '+p.before+' → '+updated.name+' ['+p.id+']');
        } catch(error) {failed++;report.push('FAILED '+p.before+' ['+p.id+']: '+(error.code?'Discord could not rename this channel.':error.message));}
      }
      await audit(i.guild,'Bulk channel styling | staff '+actor.id+' | scope '+scope+' | renamed '+changed+' | failed '+failed+' | skipped '+skipped);
    }
    const content=(apply?'Bulk styling finished: '+changed+' renamed, '+failed+' failed.':'Preview: '+plan.length+' names would change. Repeat with apply:True to apply.')+' '+unchanged+' unchanged, '+skipped+' skipped. Full details attached.';
    await i.editReply({content,files:[{attachment:Buffer.from(report.join('\n')||'No name changes needed.'),name:apply?'channel-style-results.txt':'channel-style-preview.txt'}],allowedMentions:{parse:[]}});
  } finally {if(apply) bulkRuns.delete(i.guild.id);}
}
