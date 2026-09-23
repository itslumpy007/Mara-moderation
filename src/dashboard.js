import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PermissionFlagsBits as P } from 'discord.js';
import { config, configurableIds, saveConfig } from './config.js';
import { rulesVersion } from './verification.js';
import { settings, validateAutomod } from './automod.js';

const token=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(p=>p.length===2));
export async function readJSON(req) {
  let data='',bytes=0;
  for await(const chunk of req) { bytes+=chunk.length; if(bytes>16384) throw Error('Request is too large.'); data+=chunk; }
  try { const parsed=JSON.parse(data); if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw Error(); return parsed; } catch { throw Error('Invalid JSON request.'); }
}
export async function validateChallenge(response,env,fetchImpl=fetch) {
  if(typeof response!=='string'||!response||response.length>2048) throw Error('Complete the CAPTCHA first.');
  const res=await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response}),signal:AbortSignal.timeout(10000)});
  if(!res.ok) throw Error('CAPTCHA service unavailable. Try again.');
  const result=await res.json();
  if(!result.success||result.hostname!==new URL(env.PUBLIC_BASE_URL).hostname||result.action!=='mara_verify') throw Error('CAPTCHA failed or expired. Refresh the challenge.');
}
export function createDashboard({client,store,env,verification,audit,fetchImpl=fetch,now=Date.now}) {
  const origin=new URL(env.PUBLIC_BASE_URL);
  if(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname)) throw Error('PUBLIC_BASE_URL must use HTTPS.');
  if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash) throw Error('PUBLIC_BASE_URL must be a plain origin, without a path.');
  if(!env.CLIENT_ID||!env.DISCORD_CLIENT_SECRET) throw Error('Dashboard requires CLIENT_ID and DISCORD_CLIENT_SECRET.');
  const base=origin.origin, secure=origin.protocol==='https:'?'; Secure':'';
  const states=new Map(),sessions=new Map(),rates=new Map();
  function cookie(name,value,seconds) { return name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+seconds+secure; }
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  async function apiFetch(url,options) {
    const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw Error('Discord login unavailable. Try again.');
    return response.json();
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,base),time=now();
      for(const map of [states,sessions]) for(const [id,value] of map) if(value.expires<=time) map.delete(id);
      for(const [id,value] of rates) if(value.until<=time) rates.delete(id);
      const ip=req.socket.remoteAddress||'unknown',rate=rates.get(ip)||{count:0,until:time+60000};
      rate.count++; rates.set(ip,rate);
      if(rate.count>180) return json(res,429,{error:'Too many requests. Try again in one minute.'});
      if(url.pathname==='/health') return json(res,client.isReady()?200:503,{ready:client.isReady()});
      const files={'/':'index.html','/verify':'verify.html','/app.js':'app.js','/verify.js':'verify.js','/style.css':'style.css'};
      if(req.method==='GET'&&Object.hasOwn(files,url.pathname)) {
        const file=files[url.pathname];
        res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');
        return res.end(await readFile(new URL('../web/'+file,import.meta.url)));
      }
      if(req.method==='GET'&&url.pathname==='/login') {
        if(states.size>=1000) return json(res,503,{error:'Login is busy. Try again later.'});
        const state=token(); states.set(state,{expires:time+600000,next:url.searchParams.get('next')==='/verify'?'/verify':'/'});
        res.setHeader('Set-Cookie',cookie('mara_oauth',state,600));
        const params=new URLSearchParams({client_id:env.CLIENT_ID,redirect_uri:base+'/oauth/callback',response_type:'code',scope:'identify',state});
        res.writeHead(302,{Location:'https://discord.com/oauth2/authorize?'+params}); return res.end();
      }
      if(req.method==='GET'&&url.pathname==='/oauth/callback') {
        const state=url.searchParams.get('state'),flow=states.get(state);
        if(!flow||!equal(state,cookies(req).mara_oauth)) return json(res,403,{error:'Login session expired or invalid. Start login again.'});
        states.delete(state);
        const code=url.searchParams.get('code'); if(!code||code.length>2000) throw Error('Discord login was cancelled.');
        const oauth=await apiFetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:base+'/oauth/callback'})});
        const user=await apiFetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+oauth.access_token}});
        const guild=await client.guilds.fetch(env.GUILD_ID);
        await guild.members.fetch({user:user.id,force:true});
        if(sessions.size>=1000) throw Error('Login is busy. Try again later.');
        const id=token(); sessions.set(id,{userId:user.id,name:user.username,csrf:token(),expires:time+3600000});
        res.setHeader('Set-Cookie',[cookie('mara_session',id,3600),cookie('mara_oauth','',0)]);
        res.writeHead(302,{Location:flow.next}); return res.end();
      }
      if(!url.pathname.startsWith('/api/')) return json(res,404,{error:'Not found'});
      const sid=cookies(req).mara_session,session=sessions.get(sid);
      if(!session) return json(res,401,{error:'Sign in with Discord to continue.'});
      const guild=await client.guilds.fetch(env.GUILD_ID);
      await guild.roles.fetch();
      const member=await guild.members.fetch({user:session.userId,force:true}).catch(()=>null);
      if(!member) {sessions.delete(sid);return json(res,403,{error:'Server membership is required.'});}
      const admin=member.permissions.has(P.ManageGuild);
      if(req.method==='POST') {
        if(req.headers.origin!==base||!equal(req.headers['x-csrf-token'],session.csrf)) return json(res,403,{error:'Refresh the page before saving.'});
        if(!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'JSON required.'});
      } else if(req.method!=='GET') return json(res,405,{error:'Method not allowed'});
      if(req.method==='GET'&&url.pathname==='/api/me') return json(res,200,{name:session.name,admin,csrf:session.csrf,rules:config(store).verificationRules,rulesVersion:rulesVersion(config(store).verificationRules),captcha:config(store).captcha,siteKey:env.TURNSTILE_SITE_KEY||''});
      if(req.method==='POST'&&url.pathname==='/api/logout') {
        sessions.delete(sid);res.setHeader('Set-Cookie',cookie('mara_session','',0));return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/verify') {
        const body=await readJSON(req); if(body.accepted!==true) throw Error('Accept the server rules first.');
        const cfg=config(store);
        if(!cfg.verificationRules.trim() || body.rulesVersion!==rulesVersion(cfg.verificationRules)) throw Error('Refresh and read the current server rules before accepting.');
        if(cfg.captcha) await validateChallenge(body.token,env,fetchImpl);
        const result=await verification.grant(member,{captchaPassed:cfg.captcha});
        return json(res,200,{message:result});
      }
      if(req.method==='POST'&&url.pathname==='/api/review') return json(res,200,{message:await verification.request(member)});
      if(!admin) return json(res,403,{error:'Manage Server is required to use the staff dashboard.'});
      if(req.method==='GET'&&url.pathname==='/api/state') {
        const effective={...config(store)}; for(const key of configurableIds) effective[key]=env[key]||'';
        return json(res,200,{name:guild.name,ready:client.isReady(),uptime:Math.floor(process.uptime()),config:effective,automod:settings(store),cases:store.cases(),queue:store.queueSize(),backup:store.get('health:backup'),delivery:store.get('health:delivery'),pausedUntil:store.get('raid:pausedUntil',0),reviews:store.list('verify-review:').map(r=>({user:r.key.slice(14),...r.value})),tickets:store.list('ticket-meta:').slice(-100).map(r=>({id:r.key.slice(12),...r.value}))});
      }
      if(req.method==='GET'&&url.pathname==='/api/cases') {
        const target=url.searchParams.get('target')||'',before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
        if(target&&!/^\d{17,20}$/.test(target)||!Number.isSafeInteger(before)||before<1) throw Error('Invalid case filter.');
        return json(res,200,{cases:store.cases({target,before})});
      }
      if(req.method==='POST'&&url.pathname==='/api/config') {
        const saved=await saveConfig(store,await readJSON(req),guild,member,env);
        await audit(guild,'Dashboard settings updated by '+member.id);
        return json(res,200,{config:saved});
      }
      if(req.method==='POST'&&url.pathname==='/api/automod') {
        const patch=validateAutomod(await readJSON(req));
        if(patch.enabled&&!env.LOG_CHANNEL_ID) throw Error('Configure a log channel first.');
        store.set('automod',{...settings(store),...patch});
        await audit(guild,'Dashboard automod settings updated by '+member.id);
        return json(res,200,{automod:settings(store)});
      }
      return json(res,404,{error:'Not found'});
    } catch(error) {
      if(!res.headersSent) json(res,400,{error:error.code?'Discord could not complete the request. Check bot permissions.':error instanceof SyntaxError?'Invalid request.':error.message?.slice(0,300)||'Request failed.'});
      else res.end();
    }
  });
  server.requestTimeout=20000;server.headersTimeout=15000;
  return server;
}
