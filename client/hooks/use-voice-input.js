import { useEffect, useRef, useState } from 'react';
import { base64Of, openCapture } from '../speech.js';

export function useVoiceInput({ client, threadId, onText, capture = openCapture }) {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const job = useRef(null);
  const generation = useRef(0);
  const callback = useRef(onText);
  callback.current = onText;
  const cancel = () => {
    generation.current++;
    const current = job.current; job.current = null;
    clearTimeout(current?.timer); current?.controller.abort(); current?.capture?.cancel();
    setPhase('idle'); setSeconds(0);
  };
  useEffect(() => { setError(''); return cancel; }, [client, threadId]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const began = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  const finish = async () => {
    const current = job.current;
    if (!current?.capture || current.finishing) return;
    current.finishing = true; clearTimeout(current.timer); setPhase('transcribing');
    try {
      const wave = await current.capture.finish(current.maxSeconds);
      if (job.current !== current) return;
      if (!wave?.length) throw new Error('没有录到声音，请重试。');
      if (wave.byteLength > current.catalog.maxAudioBytes) throw new Error('录音超出语音服务的大小限制，请缩短录音。');
      const result = await current.speech.transcribe({ ...current.catalog.selection, audioBase64: base64Of(wave) }, current.controller.signal);
      if (job.current !== current) return;
      if (!result?.ok) throw new Error(result?.error?.message ?? '语音转写失败');
      const text = String(result.value?.text ?? '').trim();
      if (!text) throw new Error('没有识别到文字，请重试。');
      callback.current(text);
    } catch (cause) { if (job.current === current && cause.name !== 'AbortError') setError(cause.message || String(cause)); }
    finally { if (job.current === current) cancel(); }
  };
  const start = async () => {
    if (job.current) return;
    setError(''); setSeconds(0); setPhase('preparing');
    const own = ++generation.current;
    const current = { controller: new AbortController(), capture: null };
    job.current = current;
    try {
      const speech = client?.speech?.();
      if (!speech) throw new Error('请先在 DSH 中启用并准备好语音输入插件。');
      const result = await speech.catalog();
      if (generation.current !== own) return;
      if (!result?.ok) throw new Error(result?.error?.message ?? '无法读取 DSH 语音服务');
      const catalog = result.value;
      const provider = catalog.providers?.find(entry => entry.id === catalog.selection?.providerId);
      if (!['ready', 'standby', 'waking'].includes(provider?.preparation?.phase)) throw new Error('DSH 语音模型尚未就绪，请先在语音输入插件中准备模型。');
      const maxSeconds = Math.min(catalog.maxDurationSeconds, (catalog.maxAudioBytes - 44) / 32000);
      if (!Number.isFinite(maxSeconds) || maxSeconds < 1) throw new Error('DSH 语音服务返回了无效的录音限制。');
      const opened = await capture({ signal: current.controller.signal });
      if (generation.current !== own) { opened.cancel(); return; }
      Object.assign(current, { capture: opened, speech, catalog, maxSeconds });
      setPhase('recording');
      current.timer = setTimeout(() => void finish(), maxSeconds * 1000);
    } catch (cause) {
      if (generation.current === own) { if (cause.name !== 'AbortError') setError(cause.message || String(cause)); cancel(); }
    }
  };
  return { phase, error, seconds, active: phase !== 'idle', start, finish, cancel };
}
