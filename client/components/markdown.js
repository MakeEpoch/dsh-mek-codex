import React, { useContext, useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileContext } from '../file-context.js';
import { parseFileLink } from '../../shared/file-links.js';
const h = React.createElement;
export function Markdown({ text }) {
  const files = useContext(FileContext);
  const components = useMemo(() => ({
      a: props => {
        const local = files.openFile && parseFileLink(props.href);
        return h('a', { href: local && files.fileUrl ? files.fileUrl({ href: props.href, baseDirectory: files.baseDirectory }) : props.href, target: local ? undefined : '_blank', rel: 'noreferrer noopener', onClick: local ? event => { event.preventDefault(); files.openFile({ href: props.href, baseDirectory: files.baseDirectory }, event.currentTarget); } : undefined }, props.children);
      },
      img: props => {
        const local = parseFileLink(props.src);
        const src = local && files.fileUrl ? files.fileUrl({ href: props.src, baseDirectory: files.baseDirectory }) : local ? undefined : props.src;
        return h('img', { src, alt: props.alt || '', loading: 'lazy', onClick: local && files.openFile ? event => files.openFile({ href: props.src, baseDirectory: files.baseDirectory }, event.currentTarget) : undefined });
      },
    }), [files.openFile, files.fileUrl, files.baseDirectory]);
  return h('div', { className: 'cp-markdown' }, h(ReactMarkdown, {
    remarkPlugins: [remarkGfm], skipHtml: true, components,
    urlTransform: url => files.openFile && parseFileLink(url) ? url : defaultUrlTransform(url),
  }, typeof text === 'string' ? text : ''));
}
