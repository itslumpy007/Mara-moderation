import { PermissionFlagsBits as P } from 'discord.js';
const str = (name, description, required = true) => ({type:3,name,description,required,max_length:1500});
const user = {type:6,name:'user',description:'Member',required:true};
const channel = {type:7,name:'channel',description:'Destination text channel',required:true,channel_types:[0]};
const command = (name, description, options=[], permission) => ({name,description,options,dm_permission:false,...(permission ? {default_member_permissions:String(permission)} : {})});
export const commands = [
  command('setup-check','Check Mara’s channels, role order and permissions',[],P.ManageGuild),
  command('untimeout','Remove a member’s timeout',[user,str('reason','Reason')],P.ModerateMembers),
  command('automod','View or configure Mara automod',[
    {type:5,name:'enabled',description:'Enable message checks',required:false},
    {type:3,name:'action',description:'Action for local rule matches',required:false,choices:[{name:'Log only',value:'log'},{name:'Delete message',value:'delete'}]},
    {type:5,name:'block-invites',description:'Block Discord invite links',required:false},
    {type:4,name:'mention-limit',description:'Maximum mentions before triggering (inclusive)',required:false,min_value:2,max_value:50},
    {type:4,name:'spam-limit',description:'Messages in 10 seconds before triggering (inclusive)',required:false,min_value:3,max_value:30},
    str('blocked-words','Comma-separated phrases; use - to clear',false)
  ],P.ManageGuild),
  command('ai-summary','Privately summarize report text with AI',[str('text','Report text to send to OpenAI for a staff review draft')],P.ModerateMembers),
  command('help','Meet Mara and see her commands'),
  command('warn','Record a warning',[user,str('reason','Reason')],P.ModerateMembers),
  command('warnings','View member warnings',[user],P.ModerateMembers),
  command('timeout','Temporarily mute a member',[user,{type:4,name:'minutes',description:'1 to 40320 minutes',required:true,min_value:1,max_value:40320},str('reason','Reason')],P.ModerateMembers),
  command('kick','Remove a member',[user,str('reason','Reason')],P.KickMembers),
  command('ban','Ban a member without deleting message history',[user,str('reason','Reason')],P.BanMembers),
  command('purge','Delete up to 100 recent messages',[{type:4,name:'count',description:'Number of messages',required:true,min_value:1,max_value:100}],P.ManageMessages),
  command('announce','Post an announcement',[channel,str('text','Announcement')],P.ManageGuild),
  command('panel','Post verification or ticket buttons',[channel,{type:3,name:'kind',description:'Panel type',required:true,choices:[{name:'Verification',value:'verify'},{name:'Tickets',value:'ticket'}]}],P.ManageGuild),
  command('rolepanel','Create a one-role reaction panel',[channel,{type:8,name:'role',description:'Safe self-assignable role',required:true},str('text','Panel text')],P.ManageGuild),
  command('custom-set','Create or replace a saved response',[str('name','Response name'),str('text','Response text')],P.ManageGuild),
  command('custom-delete','Delete a saved response',[str('name','Response name')],P.ManageGuild),
  command('custom','Use a saved response',[str('name','Response name')]),
  command('report','Privately report a member to staff',[user,str('reason','Explain the issue')]),
  command('close','Close this ticket; preserves the channel for staff')
];
