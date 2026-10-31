import React from 'react';
const h = React.createElement;
import { approvalTitle, decisionLabel } from '../helpers.js';

export function ApprovalCard({ request, busy, onDecide }) {
  const isAccept = (decision) =>
    decision === 'accept' || (decision && typeof decision === 'object' && Boolean(decision.acceptWithExecpolicyAmendment));
  return h(
    'div',
    { className: 'cp-approval', role: 'alert' },
    h('h4', null, approvalTitle(request)),
    request.command ? h('pre', null, request.command) : null,
    (request.changes ?? []).length
      ? h('pre', null, request.changes.map((change) => change.path ?? JSON.stringify(change)).join('\n'))
      : null,
    request.cwd ? h('div', { className: 'cp-approval-meta' }, `工作目录：${request.cwd}`) : null,
    request.reason ? h('div', { className: 'cp-approval-meta' }, `原因：${request.reason}`) : null,
    h('div', { className: 'cp-approval-meta' }, `线程 ${String(request.threadId ?? '').slice(0, 8)}… / 轮次 ${String(request.turnId ?? '').slice(0, 8)}…`),
    h(
      'div',
      { className: 'cp-approval-actions' },
      (request.available ?? []).map((decision, index) =>
        h(
          'button',
          {
            key: index,
            type: 'button',
            className: `cp-btn${isAccept(decision) ? ' primary' : ''}${decision === 'cancel' ? ' danger' : ''}`,
            disabled: busy,
            onClick: () => onDecide(request.requestId, decision),
          },
          decisionLabel(decision),
        ),
      ),
    ),
  );
}
