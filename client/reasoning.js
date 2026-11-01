// Summary and raw reasoning are distinct protocol fields, each with indexed parts.
export function reasoningText(parts) {
  if (typeof parts === 'string') return parts;
  return Array.isArray(parts) ? parts.map(part => typeof part === 'string' ? part : part?.text ?? '').filter(text => text.trim()).join('\n\n') : '';
}

export function reasoningView(item) {
  const summary = reasoningText(item?.summary);
  if (summary.trim()) return { label: '思考摘要', text: summary };
  const content = reasoningText(item?.content) || reasoningText(item?.text);
  return content.trim() ? { label: '思考过程', text: content } : null;
}

export function appendReasoningDelta(previous, params, field) {
  const parts = [...(previous?.[field] ?? [])];
  const index = field === 'summary' ? params.summaryIndex : params.contentIndex;
  const position = Number.isInteger(index) && index >= 0 ? index : 0;
  parts[position] = (parts[position] ?? '') + (params.delta ?? '');
  return { ...previous, [field]: parts };
}
