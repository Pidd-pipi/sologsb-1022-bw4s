import type { ComputedSeries } from './types';
import { volumeLabel } from './recompute';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * 导出完整 HTML 阅读版：互见以“重算后的指路”呈现（卷·章·第几句），
 * 脚注按重算编号；指不到目标的互见单列“待办”。
 */
export function buildHtml(computed: ComputedSeries, seriesTitle: string): string {
  const sections = computed.chapters
    .map((chapter) => {
      const volume = computed.volumes.find((item) => item.id === chapter.volumeId);
      const noteNumbers = computed.footnotesByChapter.get(chapter.id) ?? new Map();
      const sentences = chapter.sentences
        .map((sentenceItem) => {
          const sentenceRefs = computed.refs.filter((item) => item.ref.originAnchorId === sentenceItem.id);
          const refMarks = sentenceRefs
            .map((resolved) =>
              resolved.status === 'todo'
                ? `<sup class="todo" title="${escapeHtml(resolved.ref.note)}">〔待办〕</sup>`
                : `<sup class="ref"><a href="#${escapeHtml(resolved.sentence?.id ?? '')}">→${escapeHtml(resolved.path)}</a></sup>`
            )
            .join('');
          const noteMarks = computed.annotations
            .filter((a) => a.anchorId === sentenceItem.id && a.kind === 'footnote')
            .map((a) => `<sup class="fn">[${noteNumbers.get(a.id)}]</sup>`)
            .join('');
          return `<p id="${escapeHtml(sentenceItem.id)}">${escapeHtml(sentenceItem.text)}${noteMarks}${refMarks}</p>`;
        })
        .join('\n');
      return `<section><h2>${escapeHtml(volumeLabel(volume))} · ${escapeHtml(chapter.title)}</h2><p class="summary">${escapeHtml(chapter.summary)}</p>${sentences}</section>`;
    })
    .join('\n');

  // 各章脚注，编号用重算结果
  const footnotes: string[] = [];
  for (const chapter of computed.chapters) {
    const map = computed.footnotesByChapter.get(chapter.id);
    if (!map) continue;
    for (const [annotationId, number] of Array.from(map.entries()).sort((a, b) => a[1] - b[1])) {
      const annotation = computed.annotations.find((item) => item.id === annotationId);
      if (!annotation) continue;
      footnotes.push(
        `<li><b>[${number}]</b> ${escapeHtml(chapter.title)} · ${escapeHtml(annotation.title)}（${escapeHtml(annotation.source)}）：${escapeHtml(annotation.body)}</li>`
      );
    }
  }

  // 互见指路清单
  const refList = computed.refs
    .map((resolved) => {
      const state = resolved.status === 'todo' ? '待办' : resolved.status === 'quotedrift' ? '引文漂移' : '已核对';
      return `<li class="${escapeHtml(resolved.status)}">[${state}] <b>${escapeHtml(resolved.ref.label)}</b> → ${escapeHtml(resolved.path)} <small>${escapeHtml(resolved.ref.note)}</small></li>`;
    })
    .join('\n');

  const todoOnly = computed.todos
    .map((resolved) => `<li>${escapeHtml(resolved.ref.label)}：${escapeHtml(resolved.path)} —— ${escapeHtml(resolved.ref.note)}</li>`)
    .join('\n');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(seriesTitle)}</title>
<style>body{max-width:800px;margin:48px auto;padding:0 28px;font:17px/1.9 Georgia,"Noto Serif SC",serif;color:#29251f}h1{text-align:center}h2{margin-top:2.4em;border-bottom:1px solid #ddd;padding-bottom:.35em}.summary{color:#6b665d}sup.ref a{color:#047857;text-decoration:none}sup.todo{color:#b91c1c}li.todo{color:#b91c1c}li.quotedrift{color:#b45309}small{color:#777}</style></head>
<body><h1>${escapeHtml(seriesTitle)}</h1>
${sections}
<hr><h2>脚注（按重算编号）</h2><ol>${footnotes.join('\n')}</ol>
<h2>互见指路（卷·章·句）</h2><ol>${refList}</ol>
${computed.todos.length ? `<h2>待办互见</h2><ol>${todoOnly}</ol>` : ''}
<p><small>导出时间：${new Date().toLocaleString('zh-CN')} · 所有互见与脚注编号均按当前稿面重算</small></p></body></html>`;
}

export function buildJson(computed: ComputedSeries, series: unknown): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      series,
      recomputed: {
        refs: computed.refs.map((resolved) => ({
          id: resolved.ref.id,
          label: resolved.ref.label,
          status: resolved.status,
          path: resolved.path,
          quoteMatches: resolved.quoteMatches
        })),
        todos: computed.todos.map((resolved) => resolved.ref.id)
      }
    },
    null,
    2
  );
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
