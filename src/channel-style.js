import { PermissionFlagsBits as P, escapeMarkdown } from 'discord.js';

export const nameStyles = [
  {name:'Plain',value:'plain'},
  {name:'Small caps · ɢᴇɴᴇʀᴀʟ',value:'small-caps'},
  {name:'Bold serif · 𝐠𝐞𝐧𝐞𝐫𝐚𝐥',value:'bold'},
  {name:'Monospace · 𝚐𝚎𝚗𝚎𝚛𝚊𝚕',value:'mono'}
];
export const nameDecorations = [
  {name:'None',value:'none'}, {name:'Star · ✦・',value:'star'},
  {name:'Flower · ❀・',value:'flower'}, {name:'Diamond · ◇・',value:'diamond'}
];
export const nameChannelTypes = [0,2,4,5,13,15,16];
const prefixes = {none:'',star:'✦・',flower:'❀・',diamond:'◇・'};
const smallCaps = Array.from('ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ');

export function styledName(name,style='plain',decoration='none',type=0) {
  if(!nameStyles.some(s=>s.value===style)||!Object.hasOwn(prefixes,decoration)) throw Error('Choose a supported name style and decoration.');
  if(!nameChannelTypes.includes(type)) throw Error('Choose a server channel or category, not a thread.');
  if(typeof name!=='string'||/[\p{Cc}\p{Cf}]/u.test(name)) throw Error('Enter a name without control or invisible formatting characters.');
  let base=name.trim();
  if(!base) throw Error('Enter a name first.');
  if([0,5,15,16].includes(type)) base=base.toLowerCase().replace(/\s+/gu,'-');
  const letters=Array.from(base,c=>{
    if(style==='small-caps'&&/[a-z]/i.test(c)) return smallCaps[c.toLowerCase().charCodeAt(0)-97];
    if((style==='bold'||style==='mono')&&/[a-zA-Z0-9]/.test(c)) {
      const start=style==='bold'?[0x1d400,0x1d41a,0x1d7ce]:[0x1d670,0x1d68a,0x1d7f6];
      const code=c.charCodeAt(0);
      return String.fromCodePoint(code>=97?start[1]+code-97:code>=65?start[0]+code-65:start[2]+code-48);
    }
    return c;
  }).join('');
  const result=prefixes[decoration]+letters;
  if(result.length>100) throw Error('The styled name is too long. Use a shorter name (maximum 100 UTF-16 units including decoration).');
  return result;
}

export async function styleChannel(i,actor,audit) {
  const selected=i.options.getChannel('channel',true);
  const channel=await i.guild.channels.fetch(selected.id);
  if(!channel||channel.guildId!==i.guild.id||!nameChannelTypes.includes(channel.type)) throw Error('Choose an existing channel or category in this server.');
  if(!channel.permissionsFor(actor)?.has([P.ViewChannel,P.ManageChannels])) throw Error('You need View Channel and Manage Channels on the selected channel or category.');
  const name=styledName(i.options.getString('name',true),i.options.getString('style',true),i.options.getString('decoration')||'none',channel.type);
  const oldName=channel.name;
  if(i.options.getBoolean('apply')!==true) return 'Name preview: '+escapeMarkdown(oldName)+' → '+escapeMarkdown(name)+'\nRun the same command with apply:True to rename this channel or category. Decorative letters may look different across devices.';
  const me=await i.guild.members.fetchMe();
  if(!channel.permissionsFor(me)?.has([P.ViewChannel,P.ManageChannels])) throw Error('Mara needs View Channel and Manage Channels on the selected channel or category.');
  if(oldName===name) return 'This channel or category already has that name.';
  const updated=await channel.setName(name,'Name styling by '+actor.id);
  await audit(i.guild,'Channel name updated | channel '+channel.id+' | staff '+actor.id+'\n'+oldName+' → '+updated.name);
  return 'Renamed '+escapeMarkdown(oldName)+' → '+escapeMarkdown(updated.name)+'.';
}
