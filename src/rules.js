import { PermissionFlagsBits as P } from 'discord.js';

export const communityRules=[
  [
    "Respect everyone",
    "Treat members with respect. No harassment, bullying, threats, discrimination, or hate speech."
  ],
  [
    "Keep the chat welcoming",
    "No spam, message flooding, scams, malicious links, or unsolicited advertising."
  ],
  [
    "Protect personal privacy",
    "Never share someone’s personal information, private messages, or photos without permission."
  ],
  [
    "Keep content appropriate",
    "No sexual content, graphic violence, or illegal content. Keep usernames, profiles, and uploads appropriate too."
  ],
  [
    "Use the right channels",
    "Stay on topic and follow each channel’s purpose. Give others room to join the conversation."
  ],
  [
    "Follow Discord’s rules",
    "Follow Discord’s Terms of Service and Community Guidelines."
  ],
  [
    "Work with the staff team",
    "Follow staff directions. Report problems or appeal a decision through a private ticket, respectfully."
  ]
];
export const defaultRules=communityRules.map(([title,text],index)=>String(index+1).padStart(2,'0')+' • '+title+'\n'+text).join('\n\n');

export function publicRulesPanel(settings) {
  const text=settings.verificationRules;
  if(typeof text!=='string'||!text.trim()) throw Error('Set server rules with /verification rules first.');
  const standard=text===defaultRules;
  return {
    embeds:[{
      color:0x9B7BDA,
      author:{name:'THE BLACKLISTED • COMMUNITY GUIDE'},
      title:'✦ A good community starts with us.',
      description:standard?'Welcome to **The Blacklisted**. Make yourself at home, look out for one another, and keep these rules in mind.':text,
      ...(standard?{fields:communityRules.map(([title,value],index)=>({name:String(index+1).padStart(2,'0')+'  ━  '+title,value,inline:false}))}:{}),
      footer:{text:'Need help? Open a private ticket • Mara is here to guide you.'}
    }],
    components:[{type:1,components:[{type:2,style:3,custom_id:'verify',label:'Read & accept the rules',emoji:{name:'✦'}}]}],
    allowedMentions:{parse:[]}
  };
}

export async function postRulesPanel(i,channel,actor,me,settings) {
  if(!actor.permissions.has(P.ManageGuild)||!channel.permissionsFor(actor)?.has([P.ViewChannel,P.SendMessages])) throw Error('You need Manage Server and permission to post in this channel.');
  const panel=publicRulesPanel(settings);
  if(i.options.getBoolean('preview')) {
    panel.components[0].components[0].disabled=true;
    await i.editReply(panel);
    return false;
  }
  if(!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks])) throw Error('Mara needs View Channel, Send Messages, and Embed Links in the rules channel.');
  await channel.send(panel);
  return true;
}
