import type {
  Annotation,
  AnnotationKind,
  Chapter,
  ComputedSeries,
  ConflictGroup,
  CrossRef,
  EditorState,
  ResolvedRef,
  SearchResult,
  Sentence,
  SeriesDocument,
  TextToken,
  Volume,
  WorkspaceState,
  WorkingCopy
} from './types';

export const STORAGE_KEY = 'sologsb-1022/congshu-annotator/v2';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createInitialWorkspace(series: SeriesDocument): WorkspaceState {
  const firstVolume = series.volumes.find((volume) => !volume.unclaimed) ?? series.volumes[0];
  const firstChapter = series.chapters.find((chapter) => chapter.volumeId === firstVolume?.id);
  return {
    series: clone(series),
    mode: 'reading',
    role: 'chief',
    activeCopyId: null,
    selectedVolumeId: firstVolume?.id ?? '',
    selectedChapterId: firstChapter?.id ?? '',
    selectedSentenceId: firstChapter?.sentences[0]?.id ?? '',
    selectedAnnotationId: null,
    query: '',
    dirty: false
  };
}

export function createInitialEditorState(series: SeriesDocument): EditorState {
  return {
    workspace: createInitialWorkspace(series),
    past: [],
    future: [],
    lastAction: '已载入丛书整理底本'
  };
}

function pushHistory(state: EditorState, next: WorkspaceState, label: string): EditorState {
  return {
    workspace: next,
    past: [...state.past.slice(-39), clone(state.workspace)],
    future: [],
    lastAction: label
  };
}

export interface CommitContext {
  series: SeriesDocument;
  copy?: WorkingCopy;
}

export type EditorAction =
  | { type: 'hydrate'; workspace: WorkspaceState }
  | {
      type: 'commit';
      label: string;
      /** 在当前生效稿面（底本或活动工作副本）上改动 */
      mutate: (ctx: CommitContext) => void;
    }
  | { type: 'selectChapter'; volumeId: string; chapterId: string }
  | { type: 'selectSentence'; volumeId: string; chapterId: string; sentenceId: string }
  | { type: 'selectAnnotation'; annotationId: string | null }
  | { type: 'setMode'; mode: WorkspaceState['mode'] }
  | { type: 'setQuery'; query: string }
  | { type: 'setRole'; role: WorkspaceState['role'] }
  | { type: 'setActiveCopy'; copyId: string | null }
  | { type: 'replaceSeries'; series: SeriesDocument; label: string }
  | { type: 'undo' }
  | { type: 'redo' };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'hydrate':
      return { workspace: action.workspace, past: [], future: [], lastAction: '已恢复离线草稿' };
    case 'commit': {
      const next = clone(state.workspace);
      const copy = next.series.workingCopies.find((item) => item.id === next.activeCopyId);
      action.mutate({ series: next.series, copy });
      next.series.updatedAt = new Date().toISOString();
      if (copy) copy.updatedAt = new Date().toISOString();
      next.dirty = true;
      return pushHistory(state, next, action.label);
    }
    case 'selectChapter': {
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedVolumeId: action.volumeId,
          selectedChapterId: action.chapterId,
          selectedAnnotationId: null
        }
      };
    }
    case 'selectSentence':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedVolumeId: action.volumeId,
          selectedChapterId: action.chapterId,
          selectedSentenceId: action.sentenceId,
          selectedAnnotationId: null
        }
      };
    case 'selectAnnotation':
      return { ...state, workspace: { ...state.workspace, selectedAnnotationId: action.annotationId } };
    case 'setMode':
      return { ...state, workspace: { ...state.workspace, mode: action.mode } };
    case 'setQuery':
      return { ...state, workspace: { ...state.workspace, query: action.query } };
    case 'setRole': {
      // 切换角色后，退出不属于该角色的工作副本
      const activeCopy = state.workspace.series.workingCopies.find(
        (copy) => copy.id === state.workspace.activeCopyId
      );
      const keepCopy =
        action.role === 'chief' ? null : activeCopy?.role === action.role ? activeCopy.id : null;
      return {
        ...state,
        workspace: { ...state.workspace, role: action.role, activeCopyId: keepCopy }
      };
    }
    case 'setActiveCopy':
      return { ...state, workspace: { ...state.workspace, activeCopyId: action.copyId } };
    case 'replaceSeries':
      return pushHistory(
        state,
        { ...state.workspace, series: action.series, dirty: true },
        action.label
      );
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        workspace: clone(previous),
        past: state.past.slice(0, -1),
        future: [clone(state.workspace), ...state.future].slice(0, 40),
        lastAction: '已撤销上一步操作'
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        workspace: clone(next),
        past: [...state.past, clone(state.workspace)].slice(-40),
        future: state.future.slice(1),
        lastAction: '已重做上一步操作'
      };
    }
    default:
      return state;
  }
}

export function getSentence(computed: ComputedSeries, sentenceId: string): Sentence | undefined {
  return computed.chapters.flatMap((chapter) => chapter.sentences).find((item) => item.id === sentenceId);
}

export function findChapterOfSentence(computed: ComputedSeries, sentenceId: string): Chapter | undefined {
  return computed.chapters.find((chapter) => chapter.sentences.some((item) => item.id === sentenceId));
}

export function findToken(computed: ComputedSeries, tokenId: string): TextToken | undefined {
  for (const chapter of computed.chapters) {
    for (const sentenceItem of chapter.sentences) {
      const token = sentenceItem.tokens.find((item) => item.id === tokenId);
      if (token) return token;
    }
  }
  return undefined;
}

export function getTargetLabel(computed: ComputedSeries, annotation: Annotation): string {
  if (annotation.anchorType === 'chapter') {
    const chapter = computed.chapters.find((item) => item.id === annotation.anchorId);
    return chapter ? `${volumeOf(computed, chapter.volumeId)?.number ? `卷${volumeOf(computed, chapter.volumeId)!.number} · ` : ''}${chapter.title}` : '未知章节';
  }
  if (annotation.anchorType === 'sentence') {
    const sentence = getSentence(computed, annotation.anchorId);
    const chapter = findChapterOfSentence(computed, annotation.anchorId);
    if (sentence && chapter) return `卷${volumeOf(computed, chapter.volumeId)?.number ?? '?'} · ${chapter.title} · 第 ${sentence.order} 句`;
  } else {
    for (const chapter of computed.chapters) {
      for (const sentenceItem of chapter.sentences) {
        const token = sentenceItem.tokens.find((item) => item.id === annotation.anchorId);
        if (token) return `卷${volumeOf(computed, chapter.volumeId)?.number ?? '?'} · ${chapter.title} · “${token.text.trim()}”`;
      }
    }
  }
  return '引用目标已迁移到所属句';
}

export function volumeOf(computed: ComputedSeries, volumeId: string): Volume | undefined {
  return computed.volumes.find((volume) => volume.id === volumeId);
}

export function anchorChapterId(computed: ComputedSeries, annotation: Annotation): string {
  if (annotation.anchorType === 'chapter') return annotation.anchorId;
  return findChapterOfSentence(
    computed,
    annotation.anchorType === 'sentence'
      ? annotation.anchorId
      : computed.chapters
          .flatMap((chapter) => chapter.sentences)
          .find((sentenceItem) => sentenceItem.tokens.some((token) => token.id === annotation.anchorId))?.id ?? ''
  )?.id ?? computed.chapters[0]?.id ?? '';
}

/** 全文检索：正文、注释、来源、互见指路，全部基于重算后的稿面 */
export function collectSearchResults(computed: ComputedSeries, query: string): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const results: SearchResult[] = [];

  for (const chapter of computed.chapters) {
    const volume = volumeOf(computed, chapter.volumeId);
    const volPrefix = volume ? `卷${volume.number ?? '?'} · ` : '';
    if (chapter.title.toLocaleLowerCase().includes(normalized)) {
      results.push({
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        title: `${volPrefix}${chapter.title}`,
        excerpt: chapter.summary,
        kind: 'text'
      });
    }
    for (const sentenceItem of chapter.sentences) {
      if (sentenceItem.text.toLocaleLowerCase().includes(normalized)) {
        results.push({
          volumeId: chapter.volumeId,
          chapterId: chapter.id,
          sentenceId: sentenceItem.id,
          title: `${volPrefix}${chapter.title} · 第 ${sentenceItem.order} 句`,
          excerpt: sentenceItem.text,
          kind: 'text'
        });
      }
    }
  }

  for (const annotation of computed.annotations) {
    const searchable = `${annotation.title} ${annotation.body} ${annotation.source}`.toLocaleLowerCase();
    if (searchable.includes(normalized)) {
      const chapterId = anchorChapterId(computed, annotation);
      const chapter = computed.chapters.find((item) => item.id === chapterId);
      results.push({
        volumeId: chapter?.volumeId ?? '',
        chapterId,
        annotationId: annotation.id,
        title: annotation.title,
        excerpt: `${annotation.source} · ${annotation.body}`,
        kind: 'annotation'
      });
    }
  }

  for (const resolved of computed.refs) {
    const ref = resolved.ref;
    const searchable = `${ref.label} ${ref.note} ${resolved.path}`.toLocaleLowerCase();
    if (searchable.includes(normalized)) {
      results.push({
        volumeId: resolved.chapter?.volumeId ?? ref.target.volumeId ?? '',
        chapterId: resolved.chapter?.id ?? ref.target.chapterId ?? '',
        sentenceId: resolved.sentence?.id,
        crossRefId: ref.id,
        title: `互见 · ${ref.label} → ${resolved.path}`,
        excerpt: resolved.status === 'todo' ? `待办：${ref.note}` : ref.note,
        kind: resolved.status === 'todo' ? 'todo' : 'crossref'
      });
    }
  }

  return results.slice(0, 30);
}

export function getConflictGroups(computed: ComputedSeries): ConflictGroup[] {
  const groups = new Map<string, Annotation[]>();
  for (const annotation of computed.annotations) {
    if (annotation.conflictState === 'resolved') continue;
    const key = `${annotation.anchorId}:${annotation.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), annotation]);
  }
  return Array.from(groups.entries())
    .filter(([, items]) => new Set(items.map((item) => item.body.trim())).size > 1)
    .map(([key, items]) => {
      const first = items[0];
      const sentence = first.anchorType === 'sentence' ? getSentence(computed, first.anchorId) : undefined;
      const token = first.anchorType === 'word' ? findToken(computed, first.anchorId) : undefined;
      return {
        key,
        anchorId: first.anchorId,
        anchorType: first.anchorType,
        kind: first.kind,
        anchorLabel: sentence ? `“${sentence.text}”` : token ? `“${token.text.trim()}”` : '文本片段',
        annotations: items
      };
    });
}

export function kindLabel(kind: AnnotationKind) {
  return { footnote: '脚注', variant: '异文', background: '背景' }[kind];
}

/** 修订句子正文；词级引用落空时迁移到所属句 */
export function updateSentenceText(
  chapters: Chapter[],
  sentenceId: string,
  text: string,
  tokenize: (value: string, id: string, existing: Sentence['tokens']) => Sentence['tokens'],
  annotations: Annotation[]
): number {
  let remapped = 0;
  for (const chapter of chapters) {
    const sentenceItem = chapter.sentences.find((item) => item.id === sentenceId);
    if (!sentenceItem) continue;
    const previousIds = new Set(sentenceItem.tokens.map((token) => token.id));
    sentenceItem.text = text;
    sentenceItem.tokens = tokenize(text, sentenceItem.id, sentenceItem.tokens);
    const remainingIds = new Set(sentenceItem.tokens.map((token) => token.id));
    for (const annotation of annotations) {
      if (
        annotation.anchorType === 'word' &&
        previousIds.has(annotation.anchorId) &&
        !remainingIds.has(annotation.anchorId)
      ) {
        annotation.anchorId = sentenceItem.id;
        annotation.anchorType = 'sentence';
        annotation.title = `${annotation.title}（引用已随修订迁移）`;
        remapped += 1;
      }
    }
    break;
  }
  return remapped;
}

/** 在同卷两章之间移动句子（章节次序调过/句子挪章），稳定 id 不变，随后重算 */
export function moveSentence(
  chapters: Chapter[],
  sentenceId: string,
  toChapterId: string,
  position: 'start' | 'end'
) {
  let moved: Sentence | undefined;
  for (const chapter of chapters) {
    const index = chapter.sentences.findIndex((item) => item.id === sentenceId);
    if (index >= 0) {
      [moved] = chapter.sentences.splice(index, 1);
      chapter.sentences.forEach((item, i) => (item.order = i + 1));
      break;
    }
  }
  const target = chapters.find((chapter) => chapter.id === toChapterId);
  if (moved && target) {
    if (position === 'start') target.sentences.unshift(moved);
    else target.sentences.push(moved);
    target.sentences.forEach((item, i) => (item.order = i + 1));
  }
}

/** 句序上移/下移（可能跨章边界） */
export function shiftSentence(chapters: Chapter[], sentenceId: string, direction: -1 | 1) {
  const ordered = chapters.flatMap((chapter) =>
    [...chapter.sentences].sort((a, b) => a.order - b.order).map((sentenceItem) => ({ chapter, sentence: sentenceItem }))
  );
  const index = ordered.findIndex((item) => item.sentence.id === sentenceId);
  const swap = ordered[index + direction];
  const current = ordered[index];
  if (!swap || !current) return;
  if (swap.chapter.id === current.chapter.id) {
    const list = current.chapter.sentences;
    const a = list.findIndex((item) => item.id === current.sentence.id);
    const b = list.findIndex((item) => item.id === swap.sentence.id);
    [list[a], list[b]] = [list[b], list[a]];
    list.forEach((item, i) => (item.order = i + 1));
  } else {
    moveSentence(chapters, sentenceId, swap.chapter.id, direction === -1 ? 'end' : 'start');
  }
}

export function removeAnnotationReferences(annotations: Annotation[], removedId: string) {
  for (const annotation of annotations) {
    annotation.references = annotation.references.filter((id) => id !== removedId);
  }
}

/** 起点锚点所在的重算互见（供正文行内展示指路角标） */
export function refsAtAnchor(computed: ComputedSeries, anchorId: string): ResolvedRef[] {
  return computed.refs.filter(
    (item) => item.ref.originAnchorId === anchorId
  );
}

export function nextSentence(computed: ComputedSeries, currentId: string) {
  const ordered = computed.chapters.flatMap((chapter) =>
    [...chapter.sentences].sort((a, b) => a.order - b.order).map((sentenceItem) => ({ chapter, sentence: sentenceItem }))
  );
  const index = ordered.findIndex((item) => item.sentence.id === currentId);
  const target = ordered[index + 1];
  return target ? { volumeId: target.chapter.volumeId, chapterId: target.chapter.id, sentenceId: target.sentence.id } : null;
}

export function previousSentence(computed: ComputedSeries, currentId: string) {
  const ordered = computed.chapters.flatMap((chapter) =>
    [...chapter.sentences].sort((a, b) => a.order - b.order).map((sentenceItem) => ({ chapter, sentence: sentenceItem }))
  );
  const index = ordered.findIndex((item) => item.sentence.id === currentId);
  const target = ordered[index - 1];
  return target ? { volumeId: target.chapter.volumeId, chapterId: target.chapter.id, sentenceId: target.sentence.id } : null;
}

export type { CrossRef };
