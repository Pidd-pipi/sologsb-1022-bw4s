import type {
  CrossRef,
  OrderedVolume,
  ResolvedCrossRef,
  ResolvedNote,
  SearchHit,
  SentenceLocation,
  SeriesChapter,
  SeriesDocument,
  SeriesIndex,
  TodoItem,
  Volume
} from './types';

// 一切“人读地址”和脚注号都在这里重算：
// 章节调序、句子挪章之后，只要稳定 ID 不变，指路与编号自动跟着走；
// 指不到目标的不猜、不硬指，统一落进待办。

export function orderedVolumes(doc: SeriesDocument): OrderedVolume[] {
  return [...doc.volumes]
    .sort((a, b) => a.order - b.order)
    .map((volume) => ({
      ...volume,
      chapters: [...volume.chapters]
        .sort((a, b) => a.order - b.order)
        .map((chapter) => ({
          ...chapter,
          sentences: [...chapter.sentences].sort((a, b) => a.order - b.order)
        }))
    }));
}

export function buildLocationMap(volumes: OrderedVolume[]): Map<string, SentenceLocation> {
  const locations = new Map<string, SentenceLocation>();
  volumes.forEach((volume, volumeIndex) => {
    volume.chapters.forEach((chapter, chapterIndex) => {
      chapter.sentences.forEach((sentence, sentenceIndex) => {
        locations.set(sentence.id, {
          volume,
          chapter,
          sentence,
          volumeIndex,
          chapterIndex,
          sentenceIndex
        });
      });
    });
  });
  return locations;
}

export function addressOf(loc: Pick<SentenceLocation, 'volume' | 'chapter' | 'sentenceIndex'>): string {
  return `《${loc.volume.title}》· ${loc.chapter.title} · 第 ${loc.sentenceIndex + 1} 句`;
}

export function chapterAddressOf(loc: { volume: Volume; chapter: SeriesChapter }): string {
  return `《${loc.volume.title}》· ${loc.chapter.title}`;
}

export function excerptOf(text: string, max = 22): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** 稳定 ID -> 当前句；找不到返回 undefined（不做文字猜测） */
export function locate(locations: Map<string, SentenceLocation>, sentenceId?: string): SentenceLocation | undefined {
  if (!sentenceId) return undefined;
  return locations.get(sentenceId);
}

function resolveCrossref(ref: CrossRef, locations: Map<string, SentenceLocation>): ResolvedCrossRef {
  const anchor = ref.anchorSentenceId ? locations.get(ref.anchorSentenceId) : undefined;
  const target = ref.targetSentenceId ? locations.get(ref.targetSentenceId) : undefined;
  const base = {
    ...ref,
    anchorAddress: anchor ? addressOf(anchor) : '（起点句已找不到）',
    anchorExcerpt: anchor ? excerptOf(anchor.sentence.text) : ref.label,
    targetAddress: '',
    targetExcerpt: ''
  };

  // 未记卷册：迁移件，待认领，不进正文指路
  if (!ref.targetVolumeId) {
    return {
      ...base,
      status: 'unclaimed',
      targetAddress: '旧稿未记卷册 · 待认领',
      reason: '旧稿迁移时没有记录卷册，需要人工认领后才能指路'
    };
  }

  if (!target) {
    const volume = ref.targetVolumeId
      ? [...locations.values()].find((loc) => loc.volume.id === ref.targetVolumeId)?.volume
      : undefined;
    const chapterHint = ref.targetChapterId
      ? [...locations.values()].find((loc) => loc.chapter.id === ref.targetChapterId)?.chapter.title
      : undefined;
    const tail = volume ? `《${volume.title}》` : '原记卷册';
    const targetAddress = `${tail}${chapterHint ? ` · ${chapterHint}` : ''} · 目标句已不在`;
    return {
      ...base,
      status: 'dangling',
      targetAddress,
      targetExcerpt: ref.label,
      reason: '按稳定 ID 在当前重排后的卷章中找不到目标句（可能被删除或挪走）'
    };
  }

  return {
    ...base,
    status: 'linked',
    targetAddress: addressOf(target),
    targetExcerpt: excerptOf(target.sentence.text)
  };
}

function resolveNotes(doc: SeriesDocument, locations: Map<string, SentenceLocation>): ResolvedNote[] {
  const resolved: ResolvedNote[] = doc.notes.map((note) => {
    const loc = locations.get(note.sentenceId);
    return {
      ...note,
      status: loc ? 'linked' : 'dangling',
      number: null,
      address: loc ? addressOf(loc) : '（注所附的句子已找不到）',
      excerpt: loc ? excerptOf(loc.sentence.text) : note.title
    };
  });
  // 编号按正文遍历顺序统一给出（章节调序、句子挪章后随之重算）
  return renumberNotes(resolved, locations);
}

/** 按正文遍历顺序给脚注重编号（异文保持 null） */
export function renumberNotes(
  notes: ResolvedNote[],
  locations: Map<string, SentenceLocation>
): ResolvedNote[] {
  const order = new Map<string, number>();
  let cursor = 0;
  for (const loc of locations.values()) order.set(loc.sentence.id, cursor++);

  const chapterCounters = new Map<string, number>();
  const sorted = [...notes].sort((a, b) => {
    const oa = order.get(a.sentenceId) ?? Number.MAX_SAFE_INTEGER;
    const ob = order.get(b.sentenceId) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    // 同一句内：脚注在异文前，同类型按创建次序（id 稳定）
    if (a.kind !== b.kind) return a.kind === 'footnote' ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted.map((note) => {
    const loc = locations.get(note.sentenceId);
    if (note.kind !== 'footnote' || !loc) return { ...note, number: null };
    const n = (chapterCounters.get(loc.chapter.id) ?? 0) + 1;
    chapterCounters.set(loc.chapter.id, n);
    return { ...note, number: n };
  });
}

function buildTodos(
  crossrefs: ResolvedCrossRef[],
  notes: ResolvedNote[],
  doc: SeriesDocument
): TodoItem[] {
  const todos: TodoItem[] = [];
  for (const ref of crossrefs) {
    if (ref.status === 'dangling') {
      todos.push({
        id: `todo-x-${ref.id}`,
        kind: 'dangling-crossref',
        title: `互见指空：${ref.label}`,
        detail: `${ref.anchorAddress} → ${ref.targetAddress}。${ref.reason ?? ''}`,
        sentenceId: ref.anchorSentenceId
      });
    }
  }
  for (const note of notes) {
    if (note.status === 'dangling') {
      todos.push({
        id: `todo-n-${note.id}`,
        kind: 'dangling-note',
        title: `${note.kind === 'footnote' ? '脚注' : '异文'}失附：${note.title}`,
        detail: `${note.source}：${note.body}`
      });
    }
  }
  for (const item of doc.unclaimed) {
    todos.push({
      id: `todo-u-${item.id}`,
      kind: 'unclaimed',
      title: `待认领：${item.label}`,
      detail: item.quote ? `引句“${item.quote}”${item.volumeHint ? `（原记：${item.volumeHint}）` : ''}` : item.raw,
      unclaimedId: item.id
    });
  }
  return todos;
}

/** 唯一入口：章节/句子任何改动后调用，全部视图都消费这份结果 */
export function recompute(doc: SeriesDocument): SeriesIndex {
  const volumes = orderedVolumes(doc);
  const locations = buildLocationMap(volumes);
  const crossrefs = doc.crossrefs.map((ref) => resolveCrossref(ref, locations));
  const notes = resolveNotes(doc, locations);
  const todos = buildTodos(crossrefs, notes, doc);
  return { revision: doc.revision, volumes, locations, crossrefs, notes, todos };
}

// ---- 检索：只在重算结果上进行 ----

export function searchIndex(index: SeriesIndex, query: string): SearchHit[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const loc of index.locations.values()) {
    if (loc.sentence.text.toLocaleLowerCase().includes(q)) {
      hits.push({
        volumeId: loc.volume.id,
        chapterId: loc.chapter.id,
        sentenceId: loc.sentence.id,
        title: `${loc.chapter.title} · 第 ${loc.sentenceIndex + 1} 句`,
        excerpt: loc.sentence.text,
        address: addressOf(loc),
        matchKind: '正文'
      });
    }
  }
  for (const note of index.notes) {
    const hay = `${note.title} ${note.body} ${note.source}`.toLocaleLowerCase();
    if (hay.includes(q)) {
      const loc = index.locations.get(note.sentenceId);
      hits.push({
        volumeId: loc?.volume.id ?? '',
        chapterId: loc?.chapter.id ?? '',
        sentenceId: note.status === 'linked' ? note.sentenceId : undefined,
        title: note.title,
        excerpt: `${note.source} · ${note.body}`,
        address: note.address,
        matchKind: note.kind === 'footnote' ? '脚注' : '异文'
      });
    }
  }
  for (const ref of index.crossrefs) {
    const hay = `${ref.label} ${ref.targetAddress}`.toLocaleLowerCase();
    if (hay.includes(q)) {
      const loc = index.locations.get(ref.anchorSentenceId);
      hits.push({
        volumeId: loc?.volume.id ?? '',
        chapterId: loc?.chapter.id ?? '',
        sentenceId: ref.status === 'linked' ? ref.anchorSentenceId : undefined,
        title: `互见 · ${ref.label}`,
        excerpt: `${ref.anchorAddress} → ${ref.targetAddress}`,
        address: ref.anchorAddress,
        matchKind: '互见'
      });
    }
  }
  return hits.slice(0, 40);
}

// ---- 句子级便捷查询 ----

export function crossrefsOn(index: SeriesIndex, sentenceId: string): ResolvedCrossRef[] {
  return index.crossrefs.filter((ref) => ref.anchorSentenceId === sentenceId);
}

export function notesOn(index: SeriesIndex, sentenceId: string): ResolvedNote[] {
  return index.notes.filter((note) => note.sentenceId === sentenceId);
}

export function incomingCrossrefs(index: SeriesIndex, sentenceId: string): ResolvedCrossRef[] {
  return index.crossrefs.filter((ref) => ref.targetSentenceId === sentenceId && ref.status === 'linked');
}

export function chapterFootnotes(index: SeriesIndex, chapterId: string): ResolvedNote[] {
  return index.notes.filter((note) => {
    const loc = index.locations.get(note.sentenceId);
    return loc?.chapter.id === chapterId && note.kind === 'footnote';
  });
}

export function chapterVariants(index: SeriesIndex, chapterId: string): ResolvedNote[] {
  return index.notes.filter((note) => {
    const loc = index.locations.get(note.sentenceId);
    return loc?.chapter.id === chapterId && note.kind === 'variant';
  });
}

export function nextOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), 0) + 1;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

