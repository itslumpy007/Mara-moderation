let csrf='',before=null;
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
async function refresh(){const state=await api('/api/state');el('subtitle').textContent=state.name;el('online').textContent=state.ready?'Connected':'Disconnected';el('uptime').textContent=Math.floor(state.uptime/3600)+'h '+Math.floor(state.uptime%3600/60)+'m';el('queue').textContent=state.queue;el('backup').textContent=state.backup?new Date(state.backup.time).toLocaleDateString():'Not yet';el('delivery').textContent=state.queue?'Pending deliveries retry automatically. '+(state.delivery?.message||''):'';el('pause').textContent=state.pausedUntil>Date.now()?'Verification paused until '+new Date(state.pausedUntil).toLocaleTimeString():'';form('settings-fields',settingsSpec,state.config);form('automod-fields',automodSpec,state.automod);cases(state.cases);el('target').value='';el('reviews').replaceChildren();el('ticket-list').replaceChildren();for(const review of state.reviews)record('reviews','Verification review',review.user,new Date(review.created).toLocaleString());for(const ticket of state.tickets)record('ticket-list',ticket.category+' • '+ticket.status,'Ticket '+ticket.id+' · Member '+ticket.owner+'\nAssigned to '+(ticket.claimedBy||'unclaimed')+(ticket.rating?' · Rating '+ticket.rating+'/5':''));}
function bind(id,event,action){el(id).addEventListener(event,async e=>{e.preventDefault();const button=e.currentTarget.tagName==='BUTTON'?e.currentTarget:e.currentTarget.querySelector('button');if(button)button.disabled=true;try{await action();}catch(error){notice(error.message,true);}finally{if(button)button.disabled=false;}});}
bind('refresh','click',async()=>{await refresh();notice('Updated server status.');});
bind('settings-form','submit',async()=>{await api('/api/config',values('settings-fields',settingsSpec));notice('Server settings saved.');});
bind('automod-form','submit',async()=>{await api('/api/automod',values('automod-fields',automodSpec));notice('Protection settings saved.');});
bind('case-search','submit',async()=>cases((await api('/api/cases?target='+encodeURIComponent(el('target').value.trim()))).cases));
bind('older','click',async()=>cases((await api('/api/cases?target='+encodeURIComponent(el('target').value.trim())+'&before='+before)).cases,true));
bind('logout','click',async()=>{await api('/api/logout',{});location.reload();});
(async()=>{try{const me=await api('/api/me');csrf=me.csrf;el('login').hidden=true;el('logout').hidden=false;if(!me.admin){notice('Your account does not have Manage Server permission.',true);return;}await refresh();el('workspace').hidden=false;notice('Signed in as '+me.name+'. Changes apply immediately.');}catch(error){notice(error.message);}})();
