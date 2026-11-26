import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseFragment } from 'parse5';
import { htmlText, renderDocument } from '../scripts/render.mjs';

const cover = 'https://example.com/cover.png';

test('lead cover is placed after the text inside the summary, including a linked image or a metadata-only cover', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), '51allai-summary-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const variants = [
    `> 摘要文字。\n\n![封面](${cover})`,
    `> 摘要文字。\n[![封面](${cover})](https://example.com/article)`,
    `> 摘要文字。\n>\n> ![封面](${cover})`,
    `---\ntitle: 文章\ncover: ${cover}\n---\n\n> 摘要文字。`,
  ];
  for (const lead of variants) {
    const { article, report } = await renderDocument(`${lead}\n\n## 正文\n\n![其他图片](https://example.com/other.png)`, { outputDir });
    assert.equal(report.complete, true);
    assert.equal(report.images.length, 2);
    const root = parseFragment(article).childNodes[0];
    const [summary, heading, imageParagraph] = root.childNodes.filter(node => node.tagName);
    assert.equal(summary.tagName, 'section');
    assert.equal(summary.childNodes[2].childNodes[0].tagName, 'img');
    assert.equal(heading.tagName, 'h2');
    assert.match(imageParagraph.childNodes[0].attrs.find(attribute => attribute.name === 'src').value, /other\.png$/);
    assert.doesNotMatch(article, /51AllAI|<a[ >]/);
  }
});

test('links become plain labels; bare addresses and generated link lists disappear while code and sources are preserved', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), '51allai-links-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const source = [
    '---', 'sources:', '  - name: 官方文档', '    url: https://example.com/source', '    note: 用于核对功能', '---',
    '', '查看 [**开发指南**][guide]。<a href="https://example.com/inline">更新日志</a>。',
    '', 'https://example.com/bare', '', '<https://example.com/autolink>',
    '', '<p><a href="https://example.com/raw">HTML 说明</a></p>',
    '', '请求 `https://example.com/api`。', '', '[guide]: https://example.com/guide',
  ].join('\n');
  const { article, report } = await renderDocument(source, { outputDir });
  assert.equal(report.complete, true);
  assert.doesNotMatch(article, /<a[ >]|href=|链接地址|\[1\]|example\.com\/(?:source|inline|bare|autolink|raw|guide)/);
  assert.match(htmlText(article), /开发指南。更新日志。\s*HTML 说明/);
  assert.match(htmlText(article), /https:\/\/example\.com\/api/);
  assert.match(htmlText(article), /官方文档 — 用于核对功能/);
});

test('article hashtags merge with the existing tag line and remain last in the copyable body', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), '51allai-tags-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const source = [
    '---', 'sources:', '  - name: 官方文档', '---',
    '', '文章正文。[^1]', '', '\\#AI编程 #GitHub', '', '[^1]: 注释正文。',
  ].join('\n');
  const { files, report } = await renderDocument(source, {
    outputDir, tags: '#github  #GPT-6.2 #开发工具',
  });
  assert.equal(report.complete, true);
  const preview = await readFile(files.preview, 'utf8');
  const copyableBody = preview.match(/<div id="article-body">([\s\S]*?)<\/div>/)[1];
  const root = parseFragment(copyableBody).childNodes[0];
  const elements = root.childNodes.filter(node => node.tagName);
  assert.equal(elements.at(-1).tagName, 'p');
  const bodyText = htmlText(copyableBody).trim();
  assert.match(bodyText, /注释正文。.*官方文档#AI编程 #GitHub #GPT-6\.2 #开发工具$/s);
  assert.equal(bodyText.match(/#AI编程/g).length, 1);
});
