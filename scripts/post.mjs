import YAML from 'yaml';
import { styles as S, leaf, wrap } from './theme.mjs';

export const site = 'https://51allai.com/';

export function webUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function firstLabel(value) {
  const label = Array.isArray(value) ? value[0] : value;
  return typeof label === 'string' ? label.trim() : '';
}

export function readPost(source, warnings) {
  const raw = source.replace(/^\uFEFF/, '');
  const header = raw.match(/^---\r?\n([\s\S]+?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  let meta = {};
  let body = raw;
  let lineOffset = 0;
  if (header && /^\s*[\w-]+\s*:/m.test(header[1])) {
    try {
      const parsed = YAML.parse(header[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = parsed;
        body = raw.slice(header[0].length);
        lineOffset = (header[0].match(/\n/g) || []).length;
      }
    } catch {
      warnings.push({ type: 'metadata', message: '开头的 YAML 无法解析，已作为 Markdown 原文排版' });
    }
  }

  // Split a cover written immediately after the quote into its own Markdown
  // block so the renderer can place it after the summary text.
  const opening = body.match(/^((?:[ \t]*\r?\n)*(?:#[ \t]+[^\r\n]+\r?\n(?:[ \t]*\r?\n)*)?(?:>[^\r\n]*\r?\n)+)(?=\[?!\[)/);
  const splitLine = opening ? opening[0].split('\n').length - 1 : 0;
  if (opening) body = `${opening[0]}\n${body.slice(opening[0].length)}`;
  const sourceLine = line => line + lineOffset - (opening && line > splitLine ? 1 : 0);

  const permalink = webUrl(meta.permalink, site);
  const baseUrl = permalink.startsWith(site) ? permalink : site;
  const sources = Array.isArray(meta.sources) ? meta.sources.map(entry => ({
    name: firstLabel(typeof entry === 'string' ? entry : entry?.name),
    note: firstLabel(entry?.note),
  })) : [];

  const date = typeof meta.date === 'string' ? meta.date.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '' : '';
  return {
    body, sourceLine, sources, baseUrl, date,
    title: firstLabel(meta.title),
    author: firstLabel(meta.author),
    cover: firstLabel(meta.cover),
  };
}

function inlineText(token) {
  return (token?.children || []).map(child => {
    if (['softbreak', 'hardbreak'].includes(child.type)) return ' ';
    return child.type === 'html_inline' ? '' : child.content;
  }).join('').trim();
}

export function identifyLead(tokens, post) {
  if (tokens[0]?.type === 'heading_open' && tokens[0].tag === 'h1' &&
      tokens[1].children.every(token => !['image', 'math_inline', 'link_open', 'html_inline'].includes(token.type))) {
    const title = inlineText(tokens[1]);
    if (title && (!post.title || title === post.title)) {
      post.title = title;
      tokens.splice(0, 3);
    }
  }

  let summaryEnd = -1;
  if (tokens[0]?.type === 'blockquote_open') {
    const end = tokens.findIndex(t => t.type === 'blockquote_close' && t.level === 0);
    const inner = tokens.slice(1, end);
    const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.test(inlineText(inner[1]));
    if (end > 0 && !alert && inner.length && inner.every(t => ['paragraph_open', 'inline', 'paragraph_close'].includes(t.type))) {
      tokens[0].meta = { summary: true };
      tokens[end].meta = { summary: true };
      for (const t of inner.filter(t => t.type === 'paragraph_open')) t.meta = { summary: true };
      inner.at(-3).meta.summaryLast = true;
      summaryEnd = end;
    }
  }

  function markCover(paragraphIndex, inSummary) {
    const paragraph = tokens[paragraphIndex];
    const contents = tokens[paragraphIndex + 1]?.children;
    if (paragraph?.type !== 'paragraph_open' || contents?.length !== 1 || contents[0].type !== 'image') return false;
    const image = contents[0];
    const src = image.attrGet('src');
    const coverUrl = webUrl(post.cover, post.baseUrl);
    if (post.cover && src !== post.cover && !(coverUrl && webUrl(src, post.baseUrl) === coverUrl)) return false;
    image.meta = { ...image.meta, cover: true };
    paragraph.meta = { ...paragraph.meta, cover: true, inSummary };
    return true;
  }

  if (summaryEnd >= 0) {
    if (!markCover(summaryEnd - 3, true) && markCover(summaryEnd + 1, true)) {
      const coverBlock = tokens.splice(summaryEnd + 1, 3);
      for (const token of coverBlock) token.level++;
      tokens.splice(summaryEnd, 0, ...coverBlock);
    }
  } else if (post.cover) {
    markCover(0, false);
  }
  return tokens.some((token, index) => token.type === 'heading_open' && /^(原始来源|参考资料|参考来源|参考链接|Sources|References)$/i.test(inlineText(tokens[index + 1])));
}

export function sourcesHTML(sources) {
  const items = sources.map(({ name, note }) => wrap('li', 'margin:0 0 13px;padding-left:4px;color:#151226;',
    (name ? wrap('strong', 'font-weight:650;', leaf(name)) : '') +
    (note ? leaf(name ? ` — ${note}` : note) : '')
  )).join('');
  const label = wrap('h2', S.sourceHeading, leaf('原始来源'));
  const intro = wrap('p', `margin:0 0 12px;${S.sourceNote}`, leaf('以下资料用于核对本文信息；价格、开放范围与产品状态请以来源的最新说明为准。'));
  return wrap('section', S.sources, label + intro + wrap('ol', `margin:0;padding-left:22px;${S.sourceNote}`, items));
}
