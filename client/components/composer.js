import React, { useRef, useState } from 'react';
import { Icon } from './icon.js';
const h = React.createElement;
export function Composer({ draft, setDraft, attachments, setAttachments, busy, running, blocked, modelLabel, effortLabel, queueCount, onSend, onSteer, onQueue, onQueueList, onInterrupt, onFiles, onSettings }) {
  const file = useRef(null);
  const [menu, setMenu] = useState(false);
  return h('div', { className: 'cp-composer-shell' },
    h('div', { className: 'cp-composer' },
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
          if (busy || !draft.trim() && !attachments.length) return;
          if (running) void onSteer(); else if (!blocked) void onSend();
        },
      }),
      h('div', { className: 'cp-composer-row' },
        h('input', { ref: file, type: 'file', accept: 'image/*', multiple: true, tabIndex: -1, hidden: true, onChange: event => { void onFiles([...event.target.files]); event.target.value = ''; } }),
        h('button', { className: 'cp-icon-btn', onClick: () => file.current?.click(), disabled: busy, 'aria-label': '添加图片', title: '添加图片，也可以直接粘贴' }, h(Icon, { name: 'plus', size: 21 })),
        h('span', { className: 'cp-approval-mode', title: '命令与文件修改由你审批' }, h(Icon, { name: 'check', size: 14 }), '人工审批'),
        h('span', { className: 'cp-spacer' }),
        h('button', { className: 'cp-model-button', onClick: onSettings, 'aria-label': '模型设置', title: '选择模型和推理档' }, modelLabel || '默认模型', effortLabel ? ` · ${effortLabel}` : '', h(Icon, { name: 'chevron', size: 12 })),
        h('div', { className: 'cp-composer-options' },
          h('button', { className: 'cp-icon-btn', onClick: () => setMenu(value => !value), 'aria-label': '发送选项', 'aria-expanded': menu }, h(Icon, { name: 'more' })),
          menu ? h('div', { className: 'cp-popover cp-send-menu' },
            h('button', { disabled: busy || !draft.trim(), onClick: () => { setMenu(false); void onQueue(); } }, '排队发送'),
            h('button', { onClick: () => { setMenu(false); void onQueueList(); } }, `查看队列${queueCount ? ` · ${queueCount}` : ''}`)) : null),
        running ? h('button', { className: 'cp-send', onClick: onInterrupt, disabled: busy, 'aria-label': '中断', title: '中断当前执行' }, h(Icon, { name: 'stop', size: 17 }))
          : h('button', { className: 'cp-send', onClick: onSend, disabled: busy || blocked || !draft.trim() && !attachments.length, 'aria-label': '发送', title: '发送' }, h(Icon, { name: 'arrow', size: 20 }))),
      running ? h('div', { className: 'cp-running-hint' }, h('span', { className: 'cp-spinner' }), '正在处理', h('span', { className: 'cp-spacer' }), draft.trim() ? h('button', { className: 'cp-link', onClick: onSteer, disabled: busy }, '发送补充') : '可继续输入补充要求') : null),
    h('p', { className: 'cp-composer-hint' }, running ? 'Enter 发送补充 · Shift + Enter 换行' : 'Enter 发送 · Shift + Enter 换行'));
}
