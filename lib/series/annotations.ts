import type { CrossRef, Note, SeriesDocument } from './types';
import { findSentence, touch } from './structure';
import { uid } from './engine';

// 互见的创建/修订都只接受“卷 ID + 章 ID + 句 ID”的显式指路，
// 不再允许照抄一句文字就算互见。

export interface CrossRefTarget {
  volumeId: string;
  chapterId: string;
  sentenceId: string;
}

export function addCrossref(
  doc: SeriesDocument,
  input: { anchorSentenceId: string; label: string; target: CrossRefTarget; editorId?: string }
): CrossRef | undefined {
  const anchor = findSentence(doc, input.anchorSentenceId);
  const target = findSentence(doc, input.target.sentenceId);
  if (!anchor || !target) return undefined;
  const ref: CrossRef = {
    id: uid('x'),
    anchorSentenceId: input.anchorSentenceId,
    label: input.label.trim() || `互见 →《${target.volume.title}》${target.chapter.title}`,
    targetVolumeId: target.volume.id,
    targetChapterId: target.chapter.id,
    targetSentenceId: target.sentence.id,
    editorId: input.editorId,
    updatedAt: new Date().toISOString()
  };
  doc.crossrefs.push(ref);
  touch(doc);
  return ref;
}

export function updateCrossrefTarget(
  doc: SeriesDocument,
  crossrefId: string,
  patch: Partial<Pick<CrossRef, 'label' | 'editorId'>> & { target?: CrossRefTarget }
): void {
  const ref = doc.crossrefs.find((item) => item.id === crossrefId);
  if (!ref) return;
  if (patch.label !== undefined) ref.label = patch.label.trim() || ref.label;
  if (patch.editorId !== undefined) ref.editorId = patch.editorId;
  if (patch.target) {
    const target = findSentence(doc, patch.target.sentenceId);
    if (!target) return;
    ref.targetVolumeId = target.volume.id;
    ref.targetChapterId = target.chapter.id;
    ref.targetSentenceId = target.sentence.id;
  }
  ref.updatedAt = new Date().toISOString();
  touch(doc);
}

export function deleteCrossref(doc: SeriesDocument, crossrefId: string): void {
  doc.crossrefs = doc.crossrefs.filter((item) => item.id !== crossrefId);
  touch(doc);
}

export function addNote(
  doc: SeriesDocument,
  input: { sentenceId: string; kind: Note['kind']; title: string; body: string; source: string }
): Note | undefined {
  if (!findSentence(doc, input.sentenceId)) return undefined;
  const note: Note = {
    id: uid('n'),
    kind: input.kind,
    sentenceId: input.sentenceId,
    title: input.title.trim() || '新注',
    body: input.body.trim(),
    source: input.source.trim() || '未署名'
  };
  doc.notes.push(note);
  touch(doc);
  return note;
}

export function updateNote(doc: SeriesDocument, noteId: string, patch: Partial<Pick<Note, 'title' | 'body' | 'source' | 'kind'>>): void {
  const note = doc.notes.find((item) => item.id === noteId);
  if (!note) return;
  Object.assign(note, patch);
  touch(doc);
}

export function deleteNote(doc: SeriesDocument, noteId: string): void {
  doc.notes = doc.notes.filter((item) => item.id !== noteId);
  touch(doc);
}
