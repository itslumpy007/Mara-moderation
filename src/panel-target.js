export function panelTargetId(i) {
  const selected=i.options.getChannel('channel');
  const raw=i.options.getString('channel-id');
  if(selected&&raw) throw Error('Choose a channel OR enter a channel ID, not both.');
  if(raw!==null&&raw!==undefined) {
    const match=raw.trim().match(/^(?:<#!?(\d{17,20})>|(\d{17,20}))$/);
    if(!match) throw Error('Enter a valid channel ID or channel mention.');
    return match[1]||match[2];
  }
  const id=selected?.id||i.channelId;
  if(!id) throw Error('Choose a destination channel.');
  return id;
}
