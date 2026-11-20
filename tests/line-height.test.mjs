import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { htmlText, renderDocument, validateArticle } from '../scripts/render.mjs';

test('footnote numbers inherit line height while original subscript and superscript retain their tags', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), '51allai-line-height-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const source = '[文档](https://example.com/docs)，含脚注[^a]、H~2~O 和 x^2^。\n\n[^a]: 注释。';
  const { article, report } = await renderDocument(source, { outputDir });

  assert.equal(report.complete, true);
  assert.match(htmlText(article), /文档，含脚注\[注1\]/);
  assert.match(article, /<span style="[^"]*white-space:nowrap;">\s*<span leaf="">\[注1\]<\/span>/);
  assert.match(article, /<sub[^>]*><span leaf="">2<\/span><\/sub>/);
  assert.match(article, /<sup[^>]*><span leaf="">2<\/span><\/sup>/);
  assert.doesNotMatch(article, /line-height:\s*0\s*;/);
});

test('validation catches a collapsed text line box and permits image-only containers', () => {
  const bad = '<p><sup style="font-size:75%;line-height:0;"><span leaf="">[1]</span></sup></p>';
  const image = '<section style="line-height:0;"><img src="cover.png" alt="封面"></section>';
  assert.match(validateArticle(bad).errors.join('\n'), /文字行高过小/);
  assert.deepEqual(validateArticle(image).errors, []);
});
