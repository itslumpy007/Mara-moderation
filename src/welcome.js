import {PermissionFlagsBits as P} from 'discord.js';
import {welcomeText} from './config.js';
import {baseName} from './channel-style.js';

export function welcomePayload(member,template,{rules,verification}={}) {
  const avatar=member.user.displayAvatarURL({size:256});
  const icon=member.guild.iconURL?.({size:128});
  const fields=[
    {name:'01  ━  Get to know the community',value:rules?'Read the community rules in <#'+rules.id+'>.':'Take a moment to read our Rules channel.',inline:false},
    {name:'02  ━  Make yourself at home',value:verification?'Head to <#'+verification.id+'> to verify and unlock the community.':'Use the Verification channel to unlock the community.',inline:false},
    {name:'03  ━  Find your people',value:'Once verified, say hello, share what you’re into, and join the conversation.',inline:false}
  ];
  const buttons=[];
  for(const [label,channel] of [['Read the rules',rules],['Go to verification',verification]]) {
    if(channel)buttons.push({type:2,style:5,label,url:'https://discord.com/channels/'+member.guild.id+'/'+channel.id});
  }
  return {
    content:'Welcome aboard, <@'+member.id+'>!',
    embeds:[{
      color:0x9B7BDA,
      author:{name:member.guild.name.slice(0,256),...(icon?{icon_url:icon}:{})},
      title:'✦ Your next chapter starts here.',
      description:welcomeText(template,member),
      thumbnail:{url:avatar},
      fields,
      footer:{text:'Member '+member.guild.memberCount.toLocaleString('en-US')+' • A little more community. A little more you.'}
    }],
    components:buttons.length?[{type:1,components:buttons}]:[],
    allowedMentions:{parse:[],users:[member.id]}
  };
}

export async function makeWelcome(member,template) {
  // Resolve the styled names to real channels, and only link destinations this member can view.
  const channels=await member.guild.channels.fetch().catch(()=>null);
  const find=word=>Array.from(channels?.values()||[]).find(c=>c?.type===0&&baseName(c.name).toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(word)&&c.permissionsFor(member)?.has(P.ViewChannel));
  return welcomePayload(member,template,{rules:find('rules'),verification:find('verification')});
}

export async function sendWelcome(channel,member,template) {
  const me=await member.guild.members.fetchMe();
  if(!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages]))throw Error('Mara cannot post in the welcome channel.');
  const payload=await makeWelcome(member,template);
  if(!channel.permissionsFor(me).has(P.EmbedLinks)) {
    const steps=payload.embeds[0].fields.map(f=>f.name+'\n'+f.value).join('\n\n');
    return channel.send({content:(payload.content+'\n\n'+payload.embeds[0].description+'\n\n'+steps).slice(0,2000),allowedMentions:payload.allowedMentions});
  }
  return channel.send(payload);
}
