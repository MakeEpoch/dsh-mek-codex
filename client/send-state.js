export function sendWarning(presence, failure) {
  // These are acknowledgements from the host, independent of turn completion.
  if (['sending', 'confirmed', 'idle'].includes(presence?.sendStatus)) return null;
  return failure ?? (presence?.resumeSafe === false ? { message: '上一轮发送尚未确认' } : null);
}
