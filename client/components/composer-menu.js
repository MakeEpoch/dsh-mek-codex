import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icon.js';
const h = React.createElement;

export const effortLabel = effort => ({ none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: 'Ultra' }[effort] ?? effort);

export function ComposerMenu({ label, trigger, buttonClass = 'cp-icon-btn', align = 'right', disabled, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const button = useRef(null);
  const id = useId();
  const close = (restore = true) => { setOpen(false); if (restore) button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const menu = ref.current.querySelector('[role="menu"]');
    (menu.querySelector('[aria-checked="true"]:not(:disabled)') ?? menu.querySelector('button:not(:disabled),a[href]'))?.focus();
    const outside = event => { if (!ref.current?.contains(event.target)) close(false); };
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !menu.contains(event.target)) return;
      const nodes = [...menu.querySelectorAll('button:not(:disabled),a[href]')];
      if (!nodes.length) return;
      event.preventDefault();
      const current = nodes.indexOf(document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
      nodes[index].focus();
    };
    const focus = event => { if (!ref.current?.contains(event.target)) close(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focus); document.removeEventListener('keydown', key); };
  }, [open]);
  return h('div', { className: 'cp-composer-menu', ref },
    h('button', { type: 'button', ref: button, className: buttonClass, disabled, 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
      onClick: () => setOpen(value => !value), onKeyDown: event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } } }, trigger),
    open ? h('div', { id, role: 'menu', 'aria-label': label, className: `cp-popover cp-composer-popover ${align === 'left' ? 'cp-popover-left' : ''}` }, children(() => close())) : null);
}

export function ApprovalMenu({ reviewer = 'user', onChange, disabled, running }) {
  const automatic = reviewer === 'auto_review' || reviewer === 'guardian_subagent';
  const options = [
    { value: 'user', label: '请求批准', description: '需要批准的操作由你确认', icon: 'hand' },
    { value: 'auto_review', label: '帮我批准', description: '先自动审核风险，必要时再请求批准', icon: 'shield' },
  ];
  return h(ComposerMenu, { label: '审批方式', align: 'left', disabled, buttonClass: 'cp-approval-mode',
    trigger: h(React.Fragment, null, h(Icon, { name: automatic ? 'shield' : 'hand', size: 14 }), automatic ? '帮我批准' : '请求批准') }, close => h(React.Fragment, null,
    h('div', { className: 'cp-composer-menu-heading' }, '应如何批准 Codex 操作？', h('a', { href: 'https://learn.chatgpt.com/docs/app-server#approvals', target: '_blank', rel: 'noreferrer', role: 'menuitem' }, '了解更多')),
    options.map(option => h('button', { key: option.value, type: 'button', role: 'menuitemradio', 'aria-checked': automatic === (option.value === 'auto_review'), disabled,
      onClick: async () => { if (await onChange?.(option.value) !== false) close(); } },
    h(Icon, { name: option.icon, size: 17 }), h('span', { className: 'cp-composer-choice' }, h('strong', null, option.label), h('small', null, option.description)),
    automatic === (option.value === 'auto_review') ? h(Icon, { name: 'check', size: 15 }) : null)),
    running ? h('p', { className: 'cp-composer-menu-note' }, '切换从下一轮生效，当前请求仍按原方式处理。') : null));
}

export function ModelMenu({ models = [], modelId, modelLabel, effort, onChange, disabled, running }) {
  const model = models.find(entry => entry.id === modelId || entry.model === modelId);
  const selectModel = async (entry, close) => {
    if (entry.id === modelId || entry.model === modelId) { close(); return; }
    const efforts = entry.reasoningEfforts ?? [];
    const nextEffort = efforts.includes(effort) ? effort : entry.defaultReasoningEffort ?? efforts[0];
    if (await onChange?.({ model: entry.model ?? entry.id, ...(nextEffort ? { effort: nextEffort } : {}) }) !== false) close();
  };
  return h(ComposerMenu, { label: '模型设置', disabled, buttonClass: 'cp-model-button',
    trigger: h(React.Fragment, null, h('span', { className: 'cp-model-name' }, modelLabel || '默认模型'), effort ? h('span', { className: 'cp-effort-label' }, effortLabel(effort)) : null, h(Icon, { name: 'down', size: 11 })) }, close => h(React.Fragment, null,
    h('div', { className: 'cp-composer-menu-heading' }, '模型与推理'),
    h('div', { className: 'cp-model-choices', role: 'group', 'aria-label': '模型' }, models.length ? models.map(entry => {
      const selected = entry.id === modelId || entry.model === modelId;
      return h('button', { key: entry.id, type: 'button', role: 'menuitemradio', 'aria-checked': selected, disabled, onClick: () => selectModel(entry, close) },
        h('span', { className: 'cp-composer-choice' }, h('strong', null, entry.displayName ?? entry.id)), selected ? h(Icon, { name: 'check', size: 15 }) : null);
    }) : h('p', { className: 'cp-composer-menu-note' }, '模型列表暂不可用')),
    model?.reasoningEfforts?.length ? h(React.Fragment, null, h('div', { className: 'cp-composer-menu-heading cp-composer-menu-divider' }, '推理档'),
      h('div', { role: 'group', 'aria-label': '推理档', className: 'cp-effort-choices' }, model.reasoningEfforts.map(value => h('button', { type: 'button', key: value, role: 'menuitemradio', 'aria-checked': value === effort, disabled,
        onClick: async () => { if (await onChange?.({ effort: value }) !== false) close(); } }, effortLabel(value))))) : null,
    running ? h('p', { className: 'cp-composer-menu-note' }, '设置从下一轮生效。') : null));
}
