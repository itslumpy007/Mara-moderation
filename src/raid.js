import { config } from './config.js';
export function createRaidGuard({store,audit,now=Date.now}) {
  let joins=[],lastAlert=0;
  return async member=>{
    const cfg=config(store); if(cfg.raidAction==='off'||member.user.bot) return;
    const time=now(); joins=joins.filter(t=>t>time-cfg.raidSeconds*1000); joins.push(time);
    if(joins.length<cfg.raidJoins||time-lastAlert<cfg.raidSeconds*1000) return;
    lastAlert=time;
    if(cfg.raidAction==='pause-verification') store.set('raid:pausedUntil',time+cfg.raidHoldMinutes*60000);
    await audit(member.guild,'Join spike detected: '+joins.length+' members in '+cfg.raidSeconds+' seconds. '+(cfg.raidAction==='pause-verification'?'Verification paused for '+cfg.raidHoldMinutes+' minutes.':'Alert only; no members punished.'));
  };
}
