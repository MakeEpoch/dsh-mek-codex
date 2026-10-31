import React, { useEffect, useRef } from 'react';
import { Icon } from './icon.js';
const h = React.createElement;
export function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const el = ref.current;
    (el?.querySelector('input,select,textarea') ?? el?.querySelector('button'))?.focus();
    const keydown = event => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab') {
        const nodes = [...el.querySelectorAll('input,button,select,textarea,[tabindex="0"]')].filter(node => !node.disabled);
        if (!nodes.length) return;
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return h('div', { className: 'cp-dialog-shade', onMouseDown: event => { if (event.target === event.currentTarget) onClose(); } },
    h('section', { ref, className: 'cp-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': title },
      h('header', null, h('h3', null, title), h('button', { className: 'cp-icon-btn', onClick: onClose, 'aria-label': '关闭' }, h(Icon, { name: 'close' }))), children));
}
