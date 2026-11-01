import React from 'react';
const h = React.createElement;
const paths = {
  folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12H3V7Z M3 9h18',
  plus: 'M12 5v14M5 12h14',
  search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  edit: 'M14 5l5 5M4 20l5-1L21 7l-4-4L5 15l-1 5Z',
  sidebar: 'M9 4v16M4 4h16v16H4Z',
  chevron: 'M9 5l7 7-7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  arrow: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  stop: 'M7 7h10v10H7Z',
  check: 'M5 12l4 4L19 6',
  mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5ZM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8',
  hand: 'M8 13V6a2 2 0 0 1 4 0v6M12 10V4a2 2 0 0 1 4 0v8M16 10V7a2 2 0 0 1 4 0v8c0 4-2 7-6 7h-1c-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 3',
  shield: 'M12 3l8 4v5c0 5-5 8-8 10-3-2-8-5-8-10V7l8-4ZM8 12l3 3 5-6',
  close: 'M6 6l12 12M6 18 18 6',
  command: 'M5 7l5 5-5 5M13 17h6',
  filter: 'M4 7h16M7 12h10M10 17h4',
};
export function Icon({ name, size = 18, ...props }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...props }, h('path', { d: paths[name] ?? paths.command }));
}
