import type { SeriesDocument, SeriesIndex } from './types';
import { chapterFootnotes, chapterVariants, crossrefsOn, incomingCrossrefs, notesOn } from './engine';

// 导出只吃重算结果：脚注号、互见地址与界面完全一致；
// 指不到的互见不会被静默导出为正文，而是统一列进“待办”。

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function buildReadingHtml(doc: SeriesDocument, index: SeriesIndex): string {
  const volumeSections = index.volumes
    .map((volume) => {
      const chapters = volume.chapters
        .map((chapter) => {
          const paragraphs = chapter.sentences
            .map((sentence) => {
              const footnotes = notesOn(index, sentence.id).filter((n) => n.kind === 'footnote');
              const refs = crossrefsOn(index, sentence.id).filter((r) => r.status === 'linked');
              const markers = [
                ...footnotes.map((n) => `<sup class="fn-ref" title="${escapeHtml(n.title)}">[${n.number}]</sup>`),
                ...refs.map(
                  (r) =>
                    `<sup class="xref-ref" title="互见：${escapeHtml(r.targetAddress)}">〈互见：${escapeHtml(
                      r.targetAddress
                    )}〉</sup>`
                )
              ].join('');
              return `<p id="${escapeHtml(sentence.id)}">${escapeHtml(sentence.text)}${markers}</p>`;
            })
            .join('\n');

          const footnoteItems = chapterFootnotes(index, chapter.id)
            .map(
              (n) =>
                `<li id="fn-${escapeHtml(n.id)}"><b>[${n.number}] ${escapeHtml(n.title)}</b>（${escapeHtml(
                  n.source
                )}）：${escapeHtml(n.body)}</li>`
            )
            .join('\n');
          const variantItems = chapterVariants(index, chapter.id)
            .map((n) => `<li><b>${escapeHtml(n.title)}</b>（${escapeHtml(n.source)}）：${escapeHtml(n.body)}</li>`)
            .join('\n');

          const incoming = index.crossrefs.filter(
            (r) => r.status === 'linked' && index.locations.get(r.targetSentenceId ?? '')?.chapter.id === chapter.id
          );
          const incomingList = incoming
            .map((r) => `<li>${escapeHtml(r.label)}：来自 ${escapeHtml(r.anchorAddress)}</li>`)
            .join('\n');

          return `<section class="chapter"><h3>${escapeHtml(chapter.title)}</h3>${paragraphs}
${footnoteItems ? `<h4>脚注</h4><ol class="footnotes">${footnoteItems}</ol>` : ''}
${variantItems ? `<h4>异文校记</h4><ul class="variants">${variantItems}</ul>` : ''}
${incomingList ? `<h4>他卷互见至此</h4><ul class="incoming">${incomingList}</ul>` : ''}
</section>`;
        })
        .join('\n');
      return `<section class="volume"><h2>${escapeHtml(volume.title)}</h2>${chapters}</section>`;
    })
    .join('\n');

  const todoList = index.todos
    .map((todo) => `<li class="todo-${escapeHtml(todo.kind)}"><b>${escapeHtml(todo.title)}</b>：${escapeHtml(todo.detail)}</li>`)
    .join('\n');

  const allXrefs = index.crossrefs
    .map(
      (r) =>
        `<tr class="xref-${r.status}"><td>${escapeHtml(r.label)}</td><td>${escapeHtml(
          r.anchorAddress
        )}</td><td>${escapeHtml(r.targetAddress)}</td><td>${r.status === 'linked' ? '可核对' : r.status === 'dangling' ? '指空·待办' : '待认领'}</td></tr>`
    )
    .join('\n');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}（阅读版）</title>
<meta name="generator" content="jigutang-series; revision ${doc.revision}">
<style>
body{max-width:820px;margin:48px auto;padding:0 28px;font:17px/1.9 Georgia,"Noto Serif SC",serif;color:#29251f}
h1{text-align:center}h2{margin-top:2.4em;border-bottom:2px solid #c8a96a;padding-bottom:.3em}h3{margin-top:2em;color:#5a3e1b}
h4{margin:1.4em 0 .4em;font-size:.95em;color:#7a6a50}.footnotes,.variants,.incoming{font-size:.9em;color:#4a443b}
.fn-ref{color:#9a6a1f;margin-left:.2em}.xref-ref{color:#2f6b4f;font-size:.75em;margin-left:.2em}
table{border-collapse:collapse;width:100%;font-size:.85em;margin-top:1em}td,th{border:1px solid #d8d2c4;padding:.4em .6em;text-align:left}
tr.xref-dangling td{background:#fdf0ec}tr.xref-unclaimed td{background:#fdf7e3}
.todo-dangling-crossref{color:#a33} .todo-unclaimed{color:#9a6a1f} .todo-dangling-note{color:#a33}
small{color:#777}</style></head>
<body>
<h1>${escapeHtml(doc.title)}</h1>
<p style="text-align:center">阅读版按重算结果（revision ${doc.revision}）生成：脚注编号与互见地址均可核对</p>
${volumeSections}
<hr><h2>互见指路表</h2>
<table><thead><tr><th>互见</th><th>起自</th><th>指向</th><th>核对</th></tr></thead><tbody>${allXrefs}</tbody></table>
<h2>待办（指不到目标 / 待认领）</h2>
${todoList ? `<ul>${todoList}</ul>` : '<p>无。</p>'}
<p><small>导出时间：${new Date().toLocaleString('zh-CN')} · 稽古堂丛书分卷整理台</small></p>
</body></html>`;
}

export function buildCriticalHtml(doc: SeriesDocument, index: SeriesIndex): string {
  const sections = index.volumes
    .map((volume) => {
      const chapters = volume.chapters
        .map((chapter) => {
          const body = chapter.sentences
            .map((sentence) => {
              const variants = notesOn(index, sentence.id).filter((n) => n.kind === 'variant');
              const refs = crossrefsOn(index, sentence.id);
              const incoming = incomingCrossrefs(index, sentence.id);
              if (!variants.length && !refs.length && !incoming.length) return '';
              return `<div class="unit"><p class="st">${escapeHtml(sentence.text)}</p>
${variants.map((v) => `<p class="v"><b>异文｜${escapeHtml(v.source)}</b>：${escapeHtml(v.body)}</p>`).join('\n')}
${refs
  .map(
    (r) =>
      `<p class="x ${r.status}">互见｜${escapeHtml(r.label)} → ${escapeHtml(r.targetAddress)}${
        r.status === 'linked' ? `（${escapeHtml(r.targetExcerpt)}）` : ` <em>[${r.status === 'dangling' ? '指空·待办' : '待认领'}]</em>`
      }</p>`
  )
  .join('\n')}
${incoming.map((r) => `<p class="in">他处互见至此｜${escapeHtml(r.label)}，来自 ${escapeHtml(r.anchorAddress)}</p>`).join('\n')}
</div>`;
            })
            .filter(Boolean)
            .join('\n');
          return `<section><h3>${escapeHtml(volume.title)} · ${escapeHtml(chapter.title)}</h3>${body}</section>`;
        })
        .join('\n');
      return chapters;
    })
    .join('\n');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}（校勘版）</title>
<style>body{max-width:820px;margin:40px auto;padding:0 28px;font:15px/1.8 "Noto Serif SC",serif}.unit{border-left:3px solid #c8a96a;padding:6px 14px;margin:16px 0}.st{font-weight:bold}.v{color:#7a4a00}.x.dangling,.x.unclaimed{color:#a33}.in{color:#2f6b4f}</style>
</head><body><h1>${escapeHtml(doc.title)}·校勘版</h1><p>revision ${doc.revision}；互见地址重算自当前卷章次序</p>${sections}</body></html>`;
}

export function buildJsonExport(doc: SeriesDocument, index: SeriesIndex): string {
  // JSON 导出同时给出原始稳定 ID 数据与重算视图，便于外部系统核对
  return JSON.stringify(
    {
      schema: 'jigutang-series/v1',
      generatedAt: new Date().toISOString(),
      revision: doc.revision,
      document: doc,
      resolved: {
        crossrefs: index.crossrefs.map((r) => ({
          id: r.id,
          label: r.label,
          status: r.status,
          anchor: r.anchorAddress,
          target: r.targetAddress,
          reason: r.reason ?? null
        })),
        footnotes: index.notes
          .filter((n) => n.kind === 'footnote')
          .map((n) => ({ id: n.id, number: n.number, address: n.address, title: n.title, status: n.status })),
        todos: index.todos
      }
    },
    null,
    2
  );
}

export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
