import React from 'react';
const h = React.createElement;
import { STATUS } from '../constants.js';
import { presenceLabel } from '../helpers.js';

export function StatusPill({ status }) {
  const meta = STATUS[status] ?? { label: status || '未知', tone: 'warn' };
  return h('span', { className: `cp-pill ${meta.tone}` }, meta.label);
}

export function PresencePill({ presence, occupied }) {
  const meta = presenceLabel(presence, occupied);
  return h('span', { className: `cp-presence ${meta.tone}` }, meta.text);
}

export function Center({ title, children }) {
  return h('div', { className: 'cp-center' }, title ? h('strong', null, title) : null, children ? h('div', null, children) : null);
}

export function ErrorBox({ message, onRetry }) {
  return h(
    'div',
    { className: 'cp-error-box', role: 'alert' },
    message,
    onRetry ? h('div', null, h('button', { type: 'button', className: 'cp-btn', onClick: onRetry }, '重试')) : null,
  );
}

export function NoticeBox({ children, onDismiss, action }) {
  return h(
    'div',
    { className: 'cp-notice-box', role: 'status' },
    h('span', null, children),
    h('span', { className: 'cp-spacer' }),
    action ?? null,
    onDismiss ? h('button', { type: 'button', className: 'cp-btn', onClick: onDismiss }, '知道了') : null,
  );
}

export function SkeletonRows({ count = 8 }) {
  return h('div', null, Array.from({ length: count }, (_, index) => h('div', { key: index, className: 'cp-skeleton' })));
}
