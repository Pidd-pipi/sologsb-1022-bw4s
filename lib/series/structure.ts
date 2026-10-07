import type { SeriesChapter, SeriesDocument, SeriesSentence, Volume } from './types';
import { nextOrder, uid } from './engine';

// 所有改动都只认稳定 ID；order 仅作排序线索。
// 改完不在这里“修文字”，交由 recompute 统一重算指路与编号；
// 句子一旦被删，指向它的互见/脚注自然查无此 ID，落入待办。

export function touch(doc: SeriesDocument): void {
  doc.revision += 1;
  doc.updatedAt = new Date().toISOString();
}

export function findVolume(doc: SeriesDocument, volumeId: string): Volume | undefined {
  return doc.volumes.find((v) => v.id === volumeId);
}

export function findChapter(doc: SeriesDocument, chapterId: string): SeriesChapter | undefined {
  for (const volume of doc.volumes) {
    const chapter = volume.chapters.find((c) => c.id === chapterId);
    if (chapter) return chapter;
  }
  return undefined;
}

export function findChapterOwner(doc: SeriesDocument, chapterId: string): Volume | undefined {
  return doc.volumes.find((v) => v.chapters.some((c) => c.id === chapterId));
}

export function findSentence(
  doc: SeriesDocument,
  sentenceId: string
): { volume: Volume; chapter: SeriesChapter; sentence: SeriesSentence } | undefined {
  for (const volume of doc.volumes) {
    for (const chapter of volume.chapters) {
      const sentence = chapter.sentences.find((s) => s.id === sentenceId);
      if (sentence) return { volume, chapter, sentence };
    }
  }
  return undefined;
}

/** 重排后把每一层 order 压成连续序号 */
function normalizeOrders(doc: SeriesDocument): void {
  [...doc.volumes].sort((a, b) => a.order - b.order).forEach((v, i) => {
    v.order = i + 1;
    [...v.chapters].sort((a, b) => a.order - b.order).forEach((c, i2) => {
      c.order = i2 + 1;
      [...c.sentences].sort((a, b) => a.order - b.order).forEach((s, i3) => {
        s.order = i3 + 1;
      });
    });
  });
}

export function addVolume(doc: SeriesDocument, title: string, editorId?: string): Volume {
  const volume: Volume = {
    id: uid('vol'),
    order: nextOrder(doc.volumes),
    title: title.trim() || '新卷',
    editorId,
    chapters: []
  };
  doc.volumes.push(volume);
  touch(doc);
  return volume;
}

export function addChapter(doc: SeriesDocument, volumeId: string, title: string): SeriesChapter | undefined {
  const volume = findVolume(doc, volumeId);
  if (!volume) return undefined;
  const chapter: SeriesChapter = {
    id: uid('ch'),
    order: nextOrder(volume.chapters),
    title: title.trim() || '新章',
    sentences: []
  };
  volume.chapters.push(chapter);
  touch(doc);
  return chapter;
}

export function addSentence(doc: SeriesDocument, chapterId: string, text: string): SeriesSentence | undefined {
  const chapter = findChapter(doc, chapterId);
  if (!chapter) return undefined;
  const sentence: SeriesSentence = {
    id: uid('s'),
    order: nextOrder(chapter.sentences),
    text: text.trim()
  };
  chapter.sentences.push(sentence);
  touch(doc);
  return sentence;
}

export function updateSentenceText(doc: SeriesDocument, sentenceId: string, text: string): void {
  const hit = findSentence(doc, sentenceId);
  if (!hit) return;
  hit.sentence.text = text.trim();
  touch(doc);
}

export function renameChapter(doc: SeriesDocument, chapterId: string, title: string): void {
  const chapter = findChapter(doc, chapterId);
  if (!chapter) return;
  chapter.title = title.trim() || chapter.title;
  touch(doc);
}

export function renameVolume(doc: SeriesDocument, volumeId: string, title: string): void {
  const volume = findVolume(doc, volumeId);
  if (!volume) return;
  volume.title = title.trim() || volume.title;
  touch(doc);
}

/** 章在卷内（或卷间）移动：句子 ID 不变，互见自动指向新位置，编号重算 */
export function moveChapter(
  doc: SeriesDocument,
  chapterId: string,
  destination: { volumeId: string; beforeChapterId?: string }
): void {
  const from = findChapterOwner(doc, chapterId);
  const to = findVolume(doc, destination.volumeId);
  const chapter = findChapter(doc, chapterId);
  if (!from || !to || !chapter) return;
  if (from.id !== to.id) {
    from.chapters = from.chapters.filter((c) => c.id !== chapterId);
    to.chapters.push(chapter);
  }
  // 用临时 order 排序后整体压实
  const targetIndex = destination.beforeChapterId
    ? to.chapters.findIndex((c) => c.id === destination.beforeChapterId)
    : to.chapters.length - 1;
  to.chapters = to.chapters.filter((c) => c.id !== chapterId);
  to.chapters.splice(targetIndex < 0 ? to.chapters.length : targetIndex, 0, chapter);
  normalizeOrders(doc);
  touch(doc);
}

/** 句子挪进别的章：ID 不变，所以所有互见/脚注仍然挂得住 */
export function moveSentence(
  doc: SeriesDocument,
  sentenceId: string,
  destination: { chapterId: string; beforeSentenceId?: string }
): void {
  const hit = findSentence(doc, sentenceId);
  const to = findChapter(doc, destination.chapterId);
  if (!hit || !to) return;
  hit.chapter.sentences = hit.chapter.sentences.filter((s) => s.id !== sentenceId);
  to.sentences.push(hit.sentence);
  to.sentences = to.sentences.filter((s) => s.id !== sentenceId);
  const targetIndex = destination.beforeSentenceId
    ? to.sentences.findIndex((s) => s.id === destination.beforeSentenceId)
    : to.sentences.length - 1;
  to.sentences.splice(targetIndex < 0 ? to.sentences.length : targetIndex, 0, hit.sentence);
  normalizeOrders(doc);
  touch(doc);
}

/** 章内调序，direction 为 -1/+1 */
export function shiftSentence(doc: SeriesDocument, sentenceId: string, direction: -1 | 1): void {
  const hit = findSentence(doc, sentenceId);
  if (!hit) return;
  const list = [...hit.chapter.sentences].sort((a, b) => a.order - b.order);
  const index = list.findIndex((s) => s.id === sentenceId);
  const swapWith = list[index + direction];
  if (!swapWith) return;
  const tmp = hit.sentence.order;
  hit.sentence.order = swapWith.order;
  swapWith.order = tmp;
  touch(doc);
}

export function shiftChapter(doc: SeriesDocument, chapterId: string, direction: -1 | 1): void {
  const owner = findChapterOwner(doc, chapterId);
  const chapter = findChapter(doc, chapterId);
  if (!owner || !chapter) return;
  const list = [...owner.chapters].sort((a, b) => a.order - b.order);
  const index = list.findIndex((c) => c.id === chapterId);
  const swapWith = list[index + direction];
  if (!swapWith) return;
  const tmp = chapter.order;
  chapter.order = swapWith.order;
  swapWith.order = tmp;
  touch(doc);
}

/** 删除句子：指路不文字修补，重算时相关互见/脚注变为待办 */
export function deleteSentence(doc: SeriesDocument, sentenceId: string): void {
  const hit = findSentence(doc, sentenceId);
  if (!hit) return;
  hit.chapter.sentences = hit.chapter.sentences.filter((s) => s.id !== sentenceId);
  normalizeOrders(doc);
  touch(doc);
}

export function deleteChapter(doc: SeriesDocument, chapterId: string): void {
  const owner = findChapterOwner(doc, chapterId);
  if (!owner) return;
  owner.chapters = owner.chapters.filter((c) => c.id !== chapterId);
  normalizeOrders(doc);
  touch(doc);
}
