export const font = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
export const mono = "'SFMono-Regular',Consolas,'Liberation Mono',monospace";
export const colors = { ink: '#151226', text: '#332F42', purple: '#7C3AED', muted: '#625D72', line: '#E6E0F0', lilac: '#F4EFFC' };
const { ink, text, purple, muted, line, lilac } = colors;
export const styles = {
  root: `background:#FFFFFF;color:${text};font-size:16px;line-height:1.85;text-align:left;overflow-wrap:anywhere;font-family:${font};`,
  summary: `background:${lilac};border-left:3px solid #AB81F0;padding:12px 13px 13px;margin:0 0 16px;border-radius:0 5px 5px 0;`,
  summaryLabel: 'margin:0 0 4px;color:#6230AA;font-size:12px;font-weight:700;letter-spacing:1px;',
  summaryText: 'margin:0 0 8px;font-size:15px;line-height:1.82;color:#402D57;',
  summaryLast: 'margin:0;font-size:15px;line-height:1.82;color:#402D57;',
  p: 'margin:0 0 16px;',
  h1: `margin:33px 0 14px;color:${ink};font-size:23px;font-weight:750;line-height:1.42;`,
  h2: `border-left:3px solid ${purple};padding-left:11px;margin:35px 0 13px;color:${ink};font-size:20px;font-weight:700;line-height:1.48;`,
  h3: 'margin:24px 0 9px;color:#4B267E;font-size:18px;font-weight:700;line-height:1.55;',
  h4: `margin:21px 0 8px;color:${ink};font-size:17px;font-weight:700;line-height:1.6;`,
  h5: `margin:19px 0 7px;color:${ink};font-size:16px;font-weight:700;line-height:1.6;`,
  h6: `margin:17px 0 7px;color:${muted};font-size:15px;font-weight:700;line-height:1.6;`,
  strong: 'color:#54249A;font-weight:700;', em: 'font-style:italic;',
  s: 'text-decoration:line-through;', mark: `background:${lilac};color:#4B267E;padding:1px 3px;`,
  ins: `text-decoration:underline;text-decoration-color:${purple};text-underline-offset:3px;`,
  sub: 'font-size:75%;vertical-align:sub;', sup: 'font-size:75%;vertical-align:super;',
  reference: `font-size:80%;color:${muted};white-space:nowrap;`,
  code: `font-family:${mono};font-size:0.86em;background:${lilac};color:#55269B;padding:2px 4px;border-radius:3px;overflow-wrap:anywhere;`,
  codeBox: 'background:#252031;border-radius:6px;padding:12px 14px;margin:14px 0 22px;',
  codeLabel: `font-family:${mono};font-size:11px;line-height:1.5;color:#D8C7FF;margin:0 0 9px;padding:0 0 7px;border-bottom:1px solid #484157;`,
  pre: `margin:0;color:#F7F2FF;font-family:${mono};font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;tab-size:2;`,
  quote: `margin:18px 0 22px;padding:12px 14px 1px;border-left:2px solid ${purple};background:${lilac};`,
  ul: 'margin:10px 0 21px;padding-left:23px;list-style-type:disc;',
  ol: 'margin:10px 0 22px;padding-left:24px;list-style-type:decimal;',
  li: 'margin:0 0 9px;padding-left:4px;',
  table: `width:100%;border-collapse:collapse;table-layout:fixed;margin:12px 0 22px;font-size:13px;line-height:1.55;color:${ink};`,
  th: `background:${lilac};color:#3E2166;border:1px solid ${line};font-weight:700;padding:9px 7px;text-align:left;overflow-wrap:anywhere;`,
  td: `border:1px solid ${line};padding:9px 7px;vertical-align:top;overflow-wrap:anywhere;`,
  wide: 'margin:12px 0 22px;', row: `margin:9px 0;padding:10px 13px;background:#FAF8FE;border:1px solid ${line};border-radius:6px;`,
  cover: 'display:block;max-width:100%;height:auto;margin:0 auto;border-radius:6px;',
  summaryCover: 'margin:12px 0 0;',
  image: 'display:block;max-width:100%;height:auto;margin:18px auto 7px;border-radius:6px;',
  caption: `display:block;font-size:13px;line-height:1.65;color:${muted};text-align:center;margin:3px 0 18px;`,
  placeholder: `display:block;text-align:center;padding:13px 10px;border:1px dashed #C8B6E1;border-radius:6px;background:#FAF8FE;color:${muted};font-size:13px;line-height:1.65;`,
  hr: `border:0;border-top:1px solid ${line};margin:27px 0;`,
  sources: `border-top:1px solid ${line};padding:18px 0 0;margin:33px 0 0;`,
  sourceHeading: `margin:0 0 9px;font-size:17px;line-height:1.45;color:${ink};`,
  sourceNote: `font-size:13px;line-height:1.65;color:${muted};`,
  dl: 'margin:16px 0 22px;', dt: 'font-weight:700;color:#54249A;margin:12px 0 5px;',
  dd: `margin:0 0 12px;padding:10px 14px;border-left:2px solid #AB81F0;background:${lilac};`,
  footnote: `font-size:13px;color:${muted};line-height:1.65;`,
};

export const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const leaf = value => `<span leaf="">${esc(value)}</span>`;
export const wrap = (tag, style, inner, attrs = '') => `<${tag}${style ? ` style="${esc(style)}"` : ''}${attrs}>${inner}</${tag}>`;

const syntax = {
  keyword: '#D6B2FF', literal: '#D6B2FF', built_in: '#B4E1FF', type: '#B4E1FF',
  string: '#A8E4C3', regexp: '#A8E4C3', quote: '#A8E4C3', number: '#FFD69A', symbol: '#FFD69A',
  comment: '#C1B7CE', title: '#C7B4FF', attr: '#A5D8EB', operator: '#D6B2FF',
};
export function syntaxStyle(classes = '') {
  const key = classes.split(' ').find(name => name.startsWith('hljs-'))?.slice(5);
  return syntax[key] ? `color:${syntax[key]};` : '';
}
