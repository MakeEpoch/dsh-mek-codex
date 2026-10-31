import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const h = React.createElement;
export function Markdown({ text }) {
  return h('div', { className: 'cp-markdown' }, h(ReactMarkdown, {
    remarkPlugins: [remarkGfm], skipHtml: true,
    components: { a: props => h('a', { href: props.href, target: '_blank', rel: 'noreferrer noopener' }, props.children) },
  }, typeof text === 'string' ? text : ''));
}
