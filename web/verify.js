let csrf='',challengeToken='',widget;
const el=id=>document.getElementById(id);
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
window.addEventListener('load',async()=>{try{const me=await api('/api/me');csrf=me.csrf;el('login').hidden=true;el('verify-form').hidden=false;el('account').textContent='Signed in as '+me.name;
 if(me.captcha){if(!window.turnstile||!me.siteKey)throw Error('Challenge unavailable. Please request staff review.');widget=window.turnstile.render('#challenge',{sitekey:me.siteKey,action:'mara_verify',callback:t=>{challengeToken=t;},'expired-callback':()=>{challengeToken='';}});}
 }catch(e){el('notice').textContent=e.message;}});
for(const [id,path] of [['verify','/api/verify'],['review','/api/review']])el(id).addEventListener('click',async()=>{el(id).disabled=true;try{const data=await api(path,{accepted:el('accepted').checked,token:challengeToken});el('notice').textContent=data.message;}catch(e){el('notice').textContent=e.message;}finally{el(id).disabled=false;if(widget!==undefined){window.turnstile.reset(widget);challengeToken='';}}});
