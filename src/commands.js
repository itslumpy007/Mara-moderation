import { PermissionFlagsBits as P } from 'discord.js';
const str = (name, description, required = true) => ({type:3,name,description,required,max_length:1500});
const user = {type:6,name:'user',description:'Member',required:true};
const channel = {type:7,name:'channel',description:'Destination text channel',required:true,channel_types:[0]};
const command = (name, description, options=[], permission) => ({name,description,options,dm_permission:false,...(permission ? {default_member_permissions:String(permission)} : {})});
export const commands = [
  command('config','Set Mara channels and roles without editing Railway variables',[
    {type:3,name:'setting',description:'Setting to change',required:true,choices:['LOG_CHANNEL_ID','WELCOME_CHANNEL_ID','VERIFIED_ROLE_ID','STAFF_ROLE_ID','TICKET_CATEGORY_ID'].map(value=>({name:value,value}))},
    str('id','Channel or role ID; use - to clear')
  ],P.ManageGuild),
  command('welcome','Customize and preview welcome messages',[str('text','Use {user}, {server}, {count}; omit to preview',false)],P.ManageGuild),
  command('protection','Configure additional automod protections',[
    {type:5,name:'repeats',description:'Detect repeated messages',required:false},
    {type:5,name:'suspicious-links',description:'Flag unusual URL structures',required:false},
    str('blocked-domains','Comma-separated domains; - clears',false),
    str('exempt-channels','Comma-separated channel IDs; - clears',false)
  ],P.ManageGuild),
  command('verification','Configure verification requirements',[
    {type:4,name:'minimum-days',description:'Minimum account age in days; 0 disables',min_value:0,max_value:365,required:false},
    {type:5,name:'captcha',description:'Require the configured web CAPTCHA',required:false},
    str('rules','Rules displayed before a member accepts verification',false)
  ],P.ManageGuild),
  command('verification-review','Approve or deny a requested verification exception',[
    user,{type:3,name:'action',description:'Decision',required:true,choices:[{name:'Approve',value:'approve'},{name:'Deny',value:'deny'}]},str('reason','Reason')
  ],P.ManageGuild),
  command('raid','Configure join-spike responses',[
    {type:3,name:'action',description:'Response',required:false,choices:['off','alert','pause-verification'].map(value=>({name:value,value}))},
    {type:4,name:'joins',description:'Join threshold',min_value:3,max_value:100,required:false},
    {type:4,name:'seconds',description:'Detection window',min_value:5,max_value:300,required:false},
    {type:4,name:'pause-minutes',description:'Verification pause length',min_value:1,max_value:60,required:false},
    {type:5,name:'resume',description:'End the current verification pause',required:false}
  ],P.ManageGuild),
  command('escalation','Configure optional warning timeouts',[
    {type:4,name:'warnings',description:'Active warning threshold; 0 disables',required:true,min_value:0,max_value:20},
    {type:4,name:'minutes',description:'Timeout duration',required:false,min_value:1,max_value:40320}
  ],P.ManageGuild),
  command('case','View a numbered moderation case',[{type:4,name:'number',description:'Case number',required:true,min_value:1}],P.ModerateMembers),
  command('history','Search a member’s moderation history',[user,{type:4,name:'before',description:'Show cases older than this number',required:false,min_value:1}],P.ModerateMembers),
  command('warn-remove','Revoke an active warning without erasing its history',[{type:4,name:'number',description:'Warning case number',required:true,min_value:1},str('reason','Reason')],P.ModerateMembers),
  command('unban','Unban a user by Discord ID',[str('id','User ID'),str('reason','Reason')],P.BanMembers),
  command('backup','Create a database backup on Mara’s storage volume',[],P.ManageGuild),
  command('ticket-claim','Assign this ticket to yourself',[],P.ManageChannels),
  command('ticket-transcript','Export this ticket as a text file'),
  command('ticket-ai','Summarize this ticket or draft a staff reply',[
    {type:3,name:'mode',description:'AI task; sends recent ticket text to OpenAI',required:true,choices:[{name:'Summary',value:'summary'},{name:'Suggested reply',value:'reply'}]}
  ],P.ManageChannels),
  command('ticket-feedback','Rate your closed ticket',[str('ticket','Ticket channel ID'),{type:4,name:'rating',description:'1 (poor) to 5 (excellent)',required:true,min_value:1,max_value:5}]),
  command('ticket-categories','Set ticket categories',[str('names','Comma-separated category names')],P.ManageGuild),
  command('ai-context','Enable or disable contextual reviews of flagged messages',[{type:5,name:'enabled',description:'Send up to six messages from allowed AI channels for context',required:true}],P.ManageGuild),
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
  command('panel','Post verification or ticket buttons',[channel,{type:3,name:'kind',description:'Panel type',required:true,choices:[{name:'Verification',value:'verify'},{name:'Tickets',value:'ticket'}]},{type:5,name:'preview',description:'Show a private preview without posting',required:false}],P.ManageGuild),
  command('rolepanel','Create a one-role reaction panel',[channel,{type:8,name:'role',description:'Safe self-assignable role',required:true},str('text','Panel text')],P.ManageGuild),
  command('custom-set','Create or replace a saved response',[str('name','Response name'),str('text','Response text')],P.ManageGuild),
  command('custom-delete','Delete a saved response',[str('name','Response name')],P.ManageGuild),
  command('custom','Use a saved response',[str('name','Response name')]),
  command('report','Privately report a member to staff',[user,str('reason','Explain the issue')]),
  command('close','Close this ticket; preserves the channel for staff')
];
