let csrf='',before=null,tiktokLiveState;
const el=id=>document.getElementById(id);
function notice(text,error=false){el('notice').textContent=text;el('notice').classList.toggle('error',error);}
async function api(path,body){
 const response=await fetch(path,{...(body?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;
}
const settingsSpec=[
 ['LOG_CHANNEL_ID','Log channel ID'],['WELCOME_CHANNEL_ID','Welcome channel ID'],['VERIFIED_ROLE_ID','Verified role ID'],['STAFF_ROLE_ID','Staff role ID'],['TICKET_CATEGORY_ID','Ticket category ID'],
 ['welcomeText','Welcome message','textarea','Use {user}, {server}, {count}.'],
 ['minAccountDays','Minimum account age (days)','number'],['captcha','Require CAPTCHA','checkbox','Requires Railway dashboard and Turnstile credentials.'],
 ['warningThreshold','Warning escalation threshold','number','0 disables automatic warning timeouts.'],['warningTimeoutMinutes','Warning timeout (minutes)','number'],
 ['raidAction','Join-spike response',['off','alert','pause-verification']],['raidJoins','Join threshold','number'],['raidSeconds','Detection window (seconds)','number'],['raidHoldMinutes','Verification pause (minutes)','number'],
 ['ticketCategories','Ticket categories','array','One category per line.'],['aiContextReview','AI context reviews','checkbox','Up to six recent messages from an allowed AI channel may be sent to OpenAI after a flag.']
];
const automodSpec=[['enabled','Enable automod','checkbox'],['action','Rule action',['log','delete']],['blockInvites','Block Discord invites','checkbox'],['mentionLimit','Mention threshold','number'],['spamLimit','Messages per ten seconds','number'],['repeatEnabled','Detect repeated messages','checkbox'],['repeatLimit','Repeat threshold (30 seconds)','number'],['blockSuspiciousLinks','Check unusual URL structures','checkbox'],['blockedWords','Blocked words and phrases','array'],['blockedDomains','Blocked domains','array','One domain per line, without https://.'],['exemptChannels','Exempt channel IDs','array','One channel or category ID per line.']];
function form(container,spec,values){
 el(container).replaceChildren();
 for(const [key,label,type='text',hint] of spec){
  const wrap=document.createElement('label');wrap.append(document.createTextNode(label));let input;
  if(Array.isArray(type)){input=document.createElement('select');for(const value of type){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}}
  else input=document.createElement(['textarea','array'].includes(type)?'textarea':'input');
  if(input.tagName==='INPUT') input.type=type;
  input.name=key;
  if(type==='checkbox')input.checked=values[key]===true;else input.value=type==='array'?(values[key]||[]).join('\n'):values[key]??'';
  wrap.append(input);if(hint){const small=document.createElement('small');small.textContent=hint;wrap.append(small);}el(container).append(wrap);
 }
}
function values(container,spec){const result={};for(const [key,,type='text'] of spec){const input=el(container).querySelector('[name="'+key+'"]');result[key]=type==='checkbox'?input.checked:type==='number'?Number(input.value):type==='array'?input.value.split('\n').map(x=>x.trim()).filter(Boolean):input.value;}return result;}
function record(container,title,text,foot=''){const card=document.createElement('article');card.className='record';for(const [tag,value] of [['h3',title],['p',text],['small',foot]]){const node=document.createElement(tag);node.textContent=value;card.append(node);}el(container).append(card);}
function cases(items,append=false){if(!append)el('cases').replaceChildren();for(const c of items)record('cases','#'+c.id+' • '+c.type+(c.revoked?' • REVOKED':''),'Member '+c.target+' · Staff '+c.actor+'\n'+c.reason+(c.revoked?'\nRevocation: '+c.revoke_reason:''),c.created);before=items.at(-1)?.id;el('older').hidden=!before;if(!items.length&&!append)record('cases','No cases found','Try a different member ID.');}
function tiktokLiveMessage(text,error=false){
 const output=el('tiktok-live-status');output.textContent=text;output.classList.toggle('field-error',error);
}
function readTikTokCreators(){
 return el('tiktok-live-creators').value.split(/[\r\n,]+/).map(value=>value.trim()).filter(Boolean);
}
function resetTikTokPreview(){
 el('tiktok-live-sample').hidden=true;
 const status=el('tiktok-live-preview-status');status.replaceChildren();status.classList.remove('field-error');
}
function updateTikTokPreviewCreators(){
 const select=el('tiktok-live-preview-creator'),current=select.value;
 const handles=[...new Set(readTikTokCreators().map(value=>value.toLowerCase().replace(/^@/,'')))].filter(Boolean);
 select.replaceChildren(...(handles.length?handles.map(creator=>new Option('@'+creator,creator)):[new Option('Add a creator first','')]));
 if(handles.includes(current))select.value=current;
 resetTikTokPreview();
}
function renderTikTokLive(state){
 tiktokLiveState=state;
 const channel=el('tiktok-live-channel');
 const options=[new Option('Choose a text channel','')];
 if(state.channelId&&!state.channels.some(item=>item.id===state.channelId)){
  options.push(new Option('Current channel is unavailable',state.channelId));
 }
 for(const item of state.channels)options.push(new Option('#'+item.name,item.id));
 channel.replaceChildren(...options);
 channel.value=state.channelId;
 el('tiktok-live-creators').value=state.creators.join('\n');updateTikTokPreviewCreators();
 el('tiktok-live-webhook').value=state.webhookUrl;
 el('tiktok-live-enabled').checked=state.enabled;
 if(!state.providerConfigured)tiktokLiveMessage('Add EULER_WEBHOOK_SECRET in Railway to enable alerts.');
 else if(!state.channelsAvailable)tiktokLiveMessage('Could not load Discord channels. Refresh to try again.',true);
 else if(state.enabled&&!state.channels.some(item=>item.id===state.channelId))tiktokLiveMessage('Alerts are enabled, but the selected channel is unavailable.',true);
 else tiktokLiveMessage(state.enabled?'Alerts enabled. Changes apply to new alerts.':'Alerts paused.');
}
async function refreshTikTokLive(){
 try{renderTikTokLive(await api('/api/tiktok-live'));el('tiktok-live-save').disabled=false;}
 catch(error){tiktokLiveState=null;el('tiktok-live-save').disabled=true;tiktokLiveMessage(error.message,true);}
}
async function refresh(){const [state]=await Promise.all([api('/api/state'),refreshTikTokLive()]);el('subtitle').textContent=state.name;el('online').textContent=state.ready?'Connected':'Disconnected';el('uptime').textContent=Math.floor(state.uptime/3600)+'h '+Math.floor(state.uptime%3600/60)+'m';el('queue').textContent=state.queue;el('backup').textContent=state.backup?new Date(state.backup.time).toLocaleDateString():'Not yet';el('delivery').textContent=state.queue?'Pending deliveries retry automatically. '+(state.delivery?.message||''):'';el('pause').textContent=state.pausedUntil>Date.now()?'Verification paused until '+new Date(state.pausedUntil).toLocaleTimeString():'';form('settings-fields',settingsSpec,state.config);form('automod-fields',automodSpec,state.automod);cases(state.cases);el('target').value='';el('reviews').replaceChildren();el('ticket-list').replaceChildren();for(const review of state.reviews)record('reviews','Verification review',review.user,new Date(review.created).toLocaleString());for(const ticket of state.tickets)record('ticket-list',ticket.category+' • '+ticket.status,'Ticket '+ticket.id+' · Member '+ticket.owner+'\nAssigned to '+(ticket.claimedBy||'unclaimed')+(ticket.rating?' · Rating '+ticket.rating+'/5':''));}
function bind(id,event,action){el(id).addEventListener(event,async e=>{e.preventDefault();const button=e.currentTarget.tagName==='BUTTON'?e.currentTarget:e.currentTarget.querySelector('button');if(button)button.disabled=true;try{await action();}catch(error){notice(error.message,true);}finally{if(button)button.disabled=false;}});}
bind('refresh','click',async()=>{await refresh();notice('Updated server status.');});
bind('settings-form','submit',async()=>{await api('/api/config',values('settings-fields',settingsSpec));notice('Server settings saved.');});
bind('automod-form','submit',async()=>{await api('/api/automod',values('automod-fields',automodSpec));notice('Protection settings saved.');});
bind('tiktok-live-form','submit',async()=>{
 if(!tiktokLiveState)return;
 try{
  const saved=await api('/api/tiktok-live',{
   enabled:el('tiktok-live-enabled').checked,channelId:el('tiktok-live-channel').value,
   creators:readTikTokCreators()
  });
  renderTikTokLive({...tiktokLiveState,...saved});
  const output=el('tiktok-live-status');output.textContent='Saved. '+output.textContent;
 }catch(error){tiktokLiveMessage(error.message,true);}
});
el('tiktok-live-creators').addEventListener('input',updateTikTokPreviewCreators);
el('tiktok-live-preview-creator').addEventListener('change',resetTikTokPreview);
el('tiktok-live-channel').addEventListener('change',resetTikTokPreview);
async function runTikTokAlertAction(test){
 if(!tiktokLiveState)return;
 const creator=el('tiktok-live-preview-creator').value,channel=el('tiktok-live-channel');
 const status=el('tiktok-live-preview-status');
 status.replaceChildren();status.classList.remove('field-error');
 try{
  if(!creator)throw Error('Add a TikTok creator first.');
  if(test){
   if(!channel.value)throw Error('Choose a Discord alert channel first.');
   const posted=await api('/api/tiktok-live/test',{creator,channelId:channel.value});
   const link=document.createElement('a');link.href=posted.url;link.textContent='View test in Discord';
   link.target='_blank';link.rel='noopener noreferrer';
   status.append('Test alert sent. ',link);
   return;
  }
  const preview=await api('/api/tiktok-live/preview',{creator});
  if(el('tiktok-live-preview-creator').value!==creator)return;
  const selected=tiktokLiveState.channels.find(item=>item.id===channel.value);
  el('tiktok-live-sample-label').textContent=selected?'Preview in #'+selected.name:'Alert preview';
  el('tiktok-live-sample-handle').textContent=preview.handle;
  el('tiktok-live-sample-text').textContent=preview.announcement;
  const watch=el('tiktok-live-sample-url');watch.href=preview.watchUrl;watch.textContent=preview.watchLabel;
  el('tiktok-live-sample').hidden=false;
 }catch(error){status.textContent=error.message;status.classList.add('field-error');}
}
bind('tiktok-live-preview','click',()=>runTikTokAlertAction(false));
bind('tiktok-live-test','click',()=>runTikTokAlertAction(true));
bind('case-search','submit',async()=>cases((await api('/api/cases?target='+encodeURIComponent(el('target').value.trim()))).cases));
bind('older','click',async()=>cases((await api('/api/cases?target='+encodeURIComponent(el('target').value.trim())+'&before='+before)).cases,true));
bind('logout','click',async()=>{await api('/api/logout',{});location.reload();});
(async()=>{try{const me=await api('/api/me');csrf=me.csrf;el('login').hidden=true;el('logout').hidden=false;if(!me.admin){notice('Your account does not have Manage Server permission.',true);return;}await refresh();el('workspace').hidden=false;notice('Signed in as '+me.name+'. Changes apply immediately.');}catch(error){notice(error.message);}})();
