import { config } from './config.js';
export async function escalateWarning({store,target,caseId,botId,now=Date.now}) {
  const cfg=config(store),count=store.warningCount(target.id);
  if(cfg.warningThreshold===0||count===0||count%cfg.warningThreshold!==0) return '';
  if(!target.moderatable) return ' Warning saved; escalation skipped because Mara cannot timeout this member.';
  try {
    const duration=Math.max(cfg.warningTimeoutMinutes*60000,(target.communicationDisabledUntilTimestamp||0)-now());
    await target.timeout(duration,'Warning threshold reached after case #'+caseId);
    const escalationId=store.addCase({type:'auto-timeout',target:target.id,actor:botId,reason:'Warning threshold reached after case #'+caseId});
    return ' Automatic timeout applied (case #'+escalationId+').';
  } catch { return ' Warning saved; automatic timeout failed. Check Mara’s permissions.'; }
}
