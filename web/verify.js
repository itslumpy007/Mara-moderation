let csrf='',challengeToken='',widget,me;
const el=id=>document.getElementById(id);
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
window.addEventListener('load',async()=>{try{
 me=await api('/api/me');csrf=me.csrf;el('login').hidden=true;el('verify-form').hidden=false;el('account').textContent='Signed in as '+me.name;el('rules').textContent=me.rules||'Staff have not configured the server rules yet.';el('accept-rules').disabled=!me.rules?.trim();
}catch(e){el('notice').textContent=e.message;}});
el('accepted').addEventListener('change',()=>{el('challenge-step').hidden=true;el('accept-rules').hidden=false;challengeToken='';if(widget!==undefined)window.turnstile.reset(widget);});
el('accept-rules').addEventListener('click',()=>{
 try{
  if(!el('accepted').checked)throw Error('Read and accept the rules first.');
  if(me.captcha){
   if(!window.turnstile||!me.siteKey)throw Error('Challenge unavailable. Please request staff review.');
   if(widget===undefined)widget=window.turnstile.render('#challenge',{sitekey:me.siteKey,action:'mara_verify',callback:t=>{challengeToken=t;},'expired-callback':()=>{challengeToken='';},'error-callback':()=>{challengeToken='';el('notice').textContent='Challenge failed. Please try again.';}});
  }
  el('challenge-step').hidden=false;el('accept-rules').hidden=true;el('notice').textContent=me.captcha?'Complete the challenge, then finish verification.':'Rules accepted. Finish verification below.';
 }catch(e){el('notice').textContent=e.message;}
});
for(const [id,path] of [['verify','/api/verify'],['review','/api/review']])el(id).addEventListener('click',async()=>{
 el(id).disabled=true;
 try{
  if(id==='verify'&&(!el('accepted').checked||el('challenge-step').hidden))throw Error('Accept the rules first.');
  if(id==='verify'&&me.captcha&&!challengeToken)throw Error('Complete the CAPTCHA first.');
  const data=await api(path,{accepted:el('accepted').checked,token:challengeToken,rulesVersion:me.rulesVersion});el('notice').textContent=data.message;
  if(id==='verify')el('verify-form').hidden=true;
 }catch(e){el('notice').textContent=e.message;}
 finally{el(id).disabled=false;if(widget!==undefined){window.turnstile.reset(widget);challengeToken='';}}
});
