// DSH's speech Remote accepts complete 16 kHz mono PCM16 WAV recordings.
export function waveBytes(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at, text) => [...text].forEach((value, index) => bytes[at + index] = value.charCodeAt(0));
  ascii(0, 'RIFF'); ascii(8, 'WAVEfmt '); ascii(36, 'data');
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); });
  return bytes;
}

export function base64Of(bytes) {
  let value = '';
  for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return window.btoa(value);
}

export async function openCapture({ signal } = {}) {
  const devices = window.navigator.mediaDevices;
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  const Offline = window.OfflineAudioContext;
  if (!devices?.getUserMedia || !window.MediaRecorder || !Audio || !Offline) throw new Error('当前页面无法使用麦克风，请通过 HTTPS 或本机地址打开。');
  let stream;
  try { stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
  catch (error) { throw new Error(error?.name === 'NotAllowedError' ? '麦克风权限未开启，请在浏览器中允许使用麦克风。' : `无法使用麦克风：${error.message}`); }
  let recorder, audio, closed = false;
  const chunks = [];
  const cancel = () => {
    closed = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach(track => track.stop());
    if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
    signal?.removeEventListener('abort', cancel);
  };
  if (signal?.aborted) { cancel(); throw Object.assign(new Error('录音已取消'), { name: 'AbortError' }); }
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    recorder = new window.MediaRecorder(stream);
    recorder.ondataavailable = event => { if (!closed && event.data.size) chunks.push(event.data); };
    recorder.start();
  } catch (error) { cancel(); throw error; }
  return { cancel, async finish(maxSeconds) {
    if (closed) return null;
    try {
      await new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(event.error ?? new Error('录音失败')); recorder.stop(); });
      stream.getTracks().forEach(track => track.stop());
      if (closed) return null;
      const blob = new window.Blob(chunks, { type: recorder.mimeType });
      if (!blob.size) return null;
      audio = new Audio();
      const decoded = await audio.decodeAudioData(await blob.arrayBuffer());
      if (closed) return null;
      const length = Math.max(1, Math.floor(Math.min(decoded.duration, maxSeconds) * 16000));
      const offline = new Offline(1, length, 16000);
      const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
      const rendered = await offline.startRendering();
      return closed ? null : waveBytes(rendered.getChannelData(0));
    } finally { cancel(); }
  } };
}
