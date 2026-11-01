import React, { useRef } from 'react';
import { Icon } from './icon.js';
import { ApprovalMenu, ComposerMenu, ModelMenu } from './composer-menu.js';
import { useVoiceInput } from '../hooks/use-voice-input.js';
const h = React.createElement;
export function Composer({ client, threadId, draft, setDraft, attachments, setAttachments, busy, running, blocked, settingsDisabled, modelLabel, modelId, models, effort, reviewer, approvalBlocked, queueCount, onSend, onSteer, onQueue, onQueueList, onInterrupt, onFiles, onApplySettings }) {
  const file = useRef(null);
  const voice = useVoiceInput({ client, threadId, onText: text => setDraft(previous => previous ? `${previous}${/\s$/.test(previous) ? '' : '\n'}${text}` : text) });
  return h('div', { className: 'cp-composer-shell' },
    h('div', { className: 'cp-composer' },
      voice.active ? h('div', { className: 'cp-voice-status', role: 'status' }, h('span', null, voice.phase === 'preparing' ? '正在连接 DSH 语音服务…' : voice.phase === 'recording' ? `正在录音 · ${voice.seconds} 秒` : '正在转写…'),
        h('button', { className: 'cp-link', onClick: voice.cancel }, '取消'), voice.phase === 'recording' ? h('button', { className: 'cp-btn', onClick: voice.finish }, '完成录音') : null) : null,
      voice.error ? h('div', { className: 'cp-voice-status cp-voice-error', role: 'alert' }, h('span', null, voice.error), client?.openVoiceSettings ? h('button', { className: 'cp-link', onClick: () => client.openVoiceSettings() }, '语音设置') : null) : null,
      attachments.length ? h('div', { className: 'cp-chips' }, attachments.map((image, index) => h('span', { className: 'cp-chip', key: image.path },
        h(Icon, { name: 'folder', size: 14 }), image.name,
        h('button', { 'aria-label': `移除 ${image.name}`, onClick: () => setAttachments(previous => previous.filter((_, i) => i !== index)) }, '×')))) : null,
      h('textarea', {
        value: draft, 'aria-label': '消息', placeholder: running ? '继续补充要求…' : '与 Codex 协作',
        onChange: event => setDraft(event.target.value),
        onPaste: event => {
          const images = [...(event.clipboardData?.files ?? [])].filter(item => item.type.startsWith('image/'));
          if (images.length) { event.preventDefault(); void onFiles(images); }
        },
        onKeyDown: event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (busy || voice.active || !draft.trim() && !attachments.length) return;
          if (running) void onSteer(); else if (!blocked) void onSend();
        },
      }),
      h('div', { className: 'cp-composer-row' },
        h('input', { ref: file, type: 'file', accept: 'image/*', multiple: true, tabIndex: -1, hidden: true, onChange: event => { void onFiles([...event.target.files]); event.target.value = ''; } }),
        h(ComposerMenu, { label: '添加内容', align: 'left', disabled: busy, trigger: h(Icon, { name: 'plus', size: 21 }) }, close => h(React.Fragment, null,
          h('button', { role: 'menuitem', onClick: () => { close(); file.current?.click(); } }, h(Icon, { name: 'folder', size: 16 }), '添加图片'),
          h('button', { role: 'menuitem', disabled: busy || !draft.trim() || voice.active, onClick: () => { close(); void onQueue?.(); } }, h(Icon, { name: 'down', size: 16 }), '排队发送'),
          h('button', { role: 'menuitem', onClick: () => { close(); void onQueueList?.(); } }, `查看队列${queueCount ? ` · ${queueCount}` : ''}`))),
        h(ApprovalMenu, { reviewer, running, disabled: busy || settingsDisabled || approvalBlocked, onChange: value => onApplySettings?.({ approvalsReviewer: value }) }),
        h('span', { className: 'cp-spacer' }),
        h(ModelMenu, { models, modelId, modelLabel, effort, running, disabled: busy || settingsDisabled, onChange: onApplySettings }),
        h('button', { className: `cp-icon-btn${voice.active ? ' cp-voice-active' : ''}`, onClick: voice.phase === 'recording' ? voice.finish : voice.start, disabled: busy || voice.phase === 'preparing' || voice.phase === 'transcribing', 'aria-label': voice.phase === 'recording' ? '完成录音' : '语音输入', 'aria-pressed': voice.active, title: voice.phase === 'recording' ? '完成录音并转写' : '使用 DSH 语音输入' }, h(Icon, { name: voice.phase === 'recording' ? 'check' : 'mic', size: 18 })),
        running ? h('button', { className: 'cp-send', onClick: onInterrupt, disabled: busy, 'aria-label': '中断', title: '中断当前执行' }, h(Icon, { name: 'stop', size: 17 }))
          : h('button', { className: 'cp-send', onClick: onSend, disabled: busy || voice.active || blocked || !draft.trim() && !attachments.length, 'aria-label': '发送', title: '发送' }, h(Icon, { name: 'arrow', size: 20 }))),
      running ? h('div', { className: 'cp-running-hint' }, h('span', { className: 'cp-spinner' }), '正在处理', h('span', { className: 'cp-spacer' }), draft.trim() ? h('button', { className: 'cp-link', onClick: onSteer, disabled: busy }, '发送补充') : '可继续输入补充要求') : null),
    h('p', { className: 'cp-composer-hint' }, running ? 'Enter 发送补充 · Shift + Enter 换行' : 'Enter 发送 · Shift + Enter 换行'));
}
