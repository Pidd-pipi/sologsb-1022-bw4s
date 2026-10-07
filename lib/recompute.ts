import type {
  Annotation,
  Chapter,
  ComputedSeries,
  CrossRef,
  FootnoteMap,
  RefStatus,
  ResolvedRef,
  Sentence,
  SeriesDocument,
  TextToken,
  UnclaimedFragment,
  Volume,
  WorkingCopy
} from './types';

/** 一个可用于“重算”的扁平数据源：底本或叠加了工作副本后的稿面 */
export interface RecomputeInput {
  volumes: Volume[];
  chapters: Chapter[];
  annotations: Annotation[];
  crossRefs: CrossRef[];
  unclaimed: UnclaimedFragment[];
  workingCopies?: WorkingCopy[];
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function numberCN(n: number): string {
  if (n <= 10) return CN_DIGITS[n] ?? String(n);
  if (n < 20) return `十${CN_DIGITS[n - 10]}`;
  const tens = Math.floor(n / 10);
  const rest = n % 10;
  return `${CN_DIGITS[tens]}十${rest ? CN_DIGITS[rest] : ''}`;
}

export function volumeLabel(volume?: Volume): string {
  if (!volume) return '未知卷';
  if (volume.unclaimed) return '待认领卷册';
  return volume.number ? `卷${volume.number}` : volume.title;
}

interface Index {
  volumeById: Map<string, Volume>;
  chapterById: Map<string, Chapter>;
  sentenceById: Map<string, Sentence>;
  tokenById: Map<string, TextToken>;
  sentenceChapter: Map<string, Chapter>;
  tokenSentence: Map<string, Sentence>;
}

function buildIndex(volumes: Volume[], chapters: Chapter[]): Index {
  const volumeById = new Map(volumes.map((volume) => [volume.id, volume]));
  const chapterById = new Map<string, Chapter>();
  const sentenceById = new Map<string, Sentence>();
  const tokenById = new Map<string, TextToken>();
  const sentenceChapter = new Map<string, Chapter>();
  const tokenSentence = new Map<string, Sentence>();

  for (const chapter of chapters) {
    chapterById.set(chapter.id, chapter);
    for (const sentenceItem of chapter.sentences) {
      sentenceById.set(sentenceItem.id, sentenceItem);
      sentenceChapter.set(sentenceItem.id, chapter);
      for (const token of sentenceItem.tokens) {
        tokenById.set(token.id, token);
        tokenSentence.set(token.id, sentenceItem);
      }
    }
  }
  return { volumeById, chapterById, sentenceById, tokenById, sentenceChapter, tokenSentence };
}

/** 按 hint 文字在某章/某卷里模糊找回句子 */
function locateByHint(
  ref: CrossRef,
  chapters: Chapter[],
  index: Index
): { chapter?: Chapter; sentence?: Sentence; token?: TextToken } {
  const hint = (ref.target.sentenceHint ?? ref.targetQuote ?? '').trim();
  if (!hint) return {};
  const scopeChapters = ref.target.chapterId
    ? chapters.filter((chapter) => chapter.id === ref.target.chapterId)
    : ref.target.volumeId
      ? chapters.filter((chapter) => chapter.volumeId === ref.target.volumeId)
      : chapters;

  let best: { chapter: Chapter; sentence: Sentence; score: number } | null = null;
  for (const chapter of scopeChapters) {
    for (const sentenceItem of chapter.sentences) {
      let score = 0;
      if (sentenceItem.text === hint) score = 100;
      else if (hint && sentenceItem.text.includes(hint)) score = 60;
      else if (hint.length >= 3 && sentenceItem.text.includes(hint.slice(0, 3))) score = 30;
      if (score && (!best || score > best.score)) best = { chapter, sentence: sentenceItem, score };
    }
  }
  const token = ref.target.tokenId ? index.tokenById.get(ref.target.tokenId) : undefined;
  return { chapter: best?.chapter, sentence: best?.sentence, token };
}

/**
 * 重算单条互见：把指针核对到 卷/章/句。
 * 章节次序调整、句子挪章都通过稳定 id 跟随；指不到则保留为待办。
 */
export function resolveRef(refInput: CrossRef, index: Index, chapters: Chapter[]): ResolvedRef {
  const ref = structuredClone(refInput);
  const targetVolume = ref.target.volumeId ? index.volumeById.get(ref.target.volumeId) : undefined;

  // 旧稿未记卷册 → 待认领
  if (!ref.target.volumeId || targetVolume?.unclaimed) {
    return {
      ref,
      status: 'todo',
      reason: 'unclaimed-volume',
      path: '待认领 · 卷册未定',
      quoteMatches: false
    };
  }

  let chapter = ref.target.chapterId ? index.chapterById.get(ref.target.chapterId) : undefined;
  let sentence = ref.target.sentenceId ? index.sentenceById.get(ref.target.sentenceId) : undefined;
  let token = ref.target.tokenId ? index.tokenById.get(ref.target.tokenId) : undefined;

  // 句子 id 落空（被删/旧稿只有文字）→ 尝试按引文找回
  if (!sentence) {
    const hinted = locateByHint(ref, chapters, index);
    if (hinted.sentence) {
      sentence = hinted.sentence;
      chapter = hinted.chapter ?? chapter;
      token = hinted.token ?? token;
    }
  } else if (!chapter) {
    chapter = index.sentenceChapter.get(sentence.id);
  }

  if (!chapter) {
    return {
      ref,
      status: 'todo',
      reason: ref.target.chapterId ? 'missing-chapter' : 'missing-sentence',
      volume: targetVolume,
      path: `${volumeLabel(targetVolume)} · ${ref.target.chapterHint ?? '章次待考'} · 指不到目标`,
      quoteMatches: false
    };
  }

  if (!sentence) {
    return {
      ref,
      status: 'todo',
      reason: 'missing-sentence',
      volume: targetVolume,
      chapter,
      path: `${volumeLabel(targetVolume)} · ${chapter.title} · 指不到句子`,
      quoteMatches: false
    };
  }

  const path = `${volumeLabel(targetVolume)} · ${chapter.title} · 第 ${sentence.order} 句`;
  const normalize = (value: string) => value.replace(/\s/g, '');
  const current = normalize(sentence.text);
  const quoted = normalize(ref.targetQuote);

  // 建指针时存的是目标整句原文：整句一致才算未漂移。
  // 只有旧稿式“……”残引才按片段包含来核对。
  let quoteMatches: boolean;
  if (!quoted) {
    quoteMatches = true;
  } else if (ref.targetQuote.includes('……')) {
    const fragments = quoted.split(/……+/).filter(Boolean);
    quoteMatches = fragments.every((fragment) => fragment.length >= 2 && current.includes(fragment));
  } else {
    quoteMatches = current === quoted;
  }

  const status: RefStatus = quoteMatches ? 'resolved' : 'quotedrift';

  return {
    ref,
    status,
    volume: targetVolume,
    chapter,
    sentence,
    token,
    path,
    quoteMatches
  };
}

/**
 * 重算脚注编号：章内按句序、句内按词序，给脚注类注释连续编号。
 * 句子挪章、章序一调，编号即随之重算；异文/背景不占脚注号。
 */
export function computeFootnotes(chapters: Chapter[], annotations: Annotation[]): Map<string, FootnoteMap> {
  const byChapter = new Map<string, FootnoteMap>();
  for (const chapter of chapters) {
    const map: FootnoteMap = new Map();
    let counter = 0;
    for (const sentenceItem of chapter.sentences) {
      // 句级脚注先号
      const sentenceNotes = annotations
        .filter((a) => a.anchorType === 'sentence' && a.anchorId === sentenceItem.id && a.kind === 'footnote')
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const note of sentenceNotes) {
        counter += 1;
        map.set(note.id, counter);
      }
      // 词级脚注按 token 在句中的次序
      for (const token of sentenceItem.tokens) {
        const wordNotes = annotations
          .filter((a) => a.anchorType === 'word' && a.anchorId === token.id && a.kind === 'footnote')
          .sort((a, b) => a.id.localeCompare(b.id));
        for (const note of wordNotes) {
          counter += 1;
          map.set(note.id, counter);
        }
      }
    }
    byChapter.set(chapter.id, map);
  }
  return byChapter;
}

export function recompute(input: RecomputeInput): ComputedSeries {
  const { volumes, chapters, annotations, crossRefs, unclaimed } = input;
  const sortedVolumes = [...volumes].sort((a, b) => a.order - b.order);
  const sortedChapters = [...chapters]
    .sort((a, b) => a.volumeId.localeCompare(b.volumeId) || a.order - b.order)
    .map((chapter) => ({
      ...chapter,
      sentences: [...chapter.sentences].sort((a, b) => a.order - b.order)
    }));
  const index = buildIndex(sortedVolumes, sortedChapters);
  const refs = crossRefs.map((ref) => resolveRef(ref, index, sortedChapters));
  const refById = new Map(refs.map((item) => [item.ref.id, item]));
  const todos = refs.filter((item) => item.status === 'todo');
  const footnotesByChapter = computeFootnotes(sortedChapters, annotations);

  const placeholderSeries: SeriesDocument = {
    id: '',
    title: '',
    edition: '',
    volumes: sortedVolumes,
    chapters: sortedChapters,
    annotations,
    crossRefs,
    unclaimed,
    workingCopies: [],
    snapshots: [],
    updatedAt: ''
  };

  return {
    series: placeholderSeries,
    volumes: sortedVolumes,
    chapters: sortedChapters,
    annotations,
    crossRefs,
    refs,
    refById,
    footnotesByChapter,
    todos,
    unclaimed
  };
}

/** 底本视图 */
export function recomputeSeries(series: SeriesDocument): ComputedSeries {
  return { ...recompute(series), series };
}

/**
 * 工作副本视图：把某卷的工作章节叠加到底本之上，
 * 合并该副本改过的互见与注释后整体重算。阅读/校勘/检索/导出都用它。
 */
export function recomputeCopy(series: SeriesDocument, copy: WorkingCopy): ComputedSeries {
  const otherChapters = series.chapters.filter((chapter) => chapter.volumeId !== copy.volumeId);
  const chapters = [...otherChapters, ...structuredClone(copy.chapters)];

  const copyRefIds = new Set(copy.crossRefs.map((ref) => ref.id));
  const crossRefs = [
    ...series.crossRefs.filter((ref) => !copyRefIds.has(ref.id)),
    ...structuredClone(copy.crossRefs)
  ];

  const copyAnnotationIds = new Set(copy.annotations.map((a) => a.id));
  const annotations = [
    ...series.annotations.filter((a) => !copyAnnotationIds.has(a.id)),
    ...structuredClone(copy.annotations)
  ];

  return {
    ...recompute({
      volumes: series.volumes,
      chapters,
      annotations,
      crossRefs,
      unclaimed: series.unclaimed
    }),
    series
  };
}

/** 句序调整后，规范化一章内各句 order（移动/对调后调用） */
export function renumberSentences(chapter: Chapter) {
  [...chapter.sentences]
    .sort((a, b) => a.order - b.order)
    .forEach((sentenceItem, index) => {
      sentenceItem.order = index + 1;
    });
}

export function renumberChapters(volumeChapters: Chapter[]) {
  [...volumeChapters]
    .sort((a, b) => a.order - b.order)
    .forEach((chapter, index) => {
      chapter.order = index + 1;
    });
}
