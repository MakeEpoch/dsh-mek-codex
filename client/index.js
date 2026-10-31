import React from 'react';
const h = React.createElement;
import { PLUGIN_NAME, PANEL_ID } from '../shared/identity.js';
import { createClient } from './rpc.js';
import { Panel } from './panel.js';
import * as helpers from './helpers.js';

const Icon = ({ size = 20 }) =>
  h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': 'true' },
    h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
    h('path', { d: 'M7 9h10M7 13h6' }),
    h('path', { d: 'M14.5 16.5 17 15l-2.5-1.5' }),
  );

export function apply(ctx) {
  const client = createClient(ctx.connection);
  const Main = () => h(Panel, { client });
  ctx.effect(() => {
    const disposers = [];
    disposers.push(ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Main)));
    disposers.push(
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => 'Codex 会话' }, Icon),
      ),
    );
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose?.();
        } catch {
          /* already gone */
        }
      }
    };
  }, 'codex-panel: client');
}

export const name = PLUGIN_NAME;
export const inject = ['connection', 'slots'];
export const __test = helpers;
