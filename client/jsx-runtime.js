// DSH supplies React. Every JSX element must come from that same runtime:
// bundling React 19's JSX runtime breaks React 18 renderers in the host.
import React from 'react';
export const Fragment = React.Fragment;
export function jsx(type, props, key) {
  return React.createElement(type, key === undefined ? props : { ...props, key });
}
export const jsxs = jsx;
export const jsxDEV = jsx;
