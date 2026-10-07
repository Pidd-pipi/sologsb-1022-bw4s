import type { CrossRef, Note, SeriesDocument, SeriesSentence, UnclaimedItem } from './types';
import { findSentence } from './structure';
import { uid } from './engine';

// 旧稿迁移：接受“照抄文字”式的旧互见/脚注。
// 能靠引句在现有卷册中唯一定位的，直接转成稳定指路；
// 没记卷册、或引句对不上/不唯一的，一律进 unclaimed 待认领处，不替读者猜。

export interface LegacyCrossRefRecord {
  /** 互见起点：引句或旧编号 */
  from?: string;
  /** 目标引句（照抄文字） */
  quote?: string;
  /** 旧稿里可能写了卷名，也可能没写 */
  volume?: string;
  label?: string;
  raw?: string;
}

export interface LegacyNoteRecord {
  quote?: string;
  kind?: 'footnote' | 'variant';
  title?: string;
  body?: string;
  source?: string;
  raw?: string;
}

export interface MigrationResult {
  crossrefs: CrossRef[];
  notes: Note[];
  unclaimed: UnclaimedItem[];
  report: { crossrefLinked: number; crossrefUnclaimed: number; noteLinked: number; noteUnclaimed: number };
}

function findSentencesByText(doc: SeriesDocument, text: string): SeriesSentence[] {
  const needle = text.trim();
  if (!needle) return [];
  const hits: SeriesSentence[] = [];
  for (const volume of doc.volumes) {
    for (const chapter of volume.chapters) {
      for (const sentence of chapter.sentences) {
        if (sentence.text.includes(needle)) hits.push(sentence);
      }
    }
  }
  return hits;
}

function resolveVolume(doc: SeriesDocument, volumeName?: string) {
  if (!volumeName) return undefined;
  const name = volumeName.replace(/[《》]/g, '').trim();
  return doc.volumes.find((v) => v.title.includes(name) || name.includes(v.title));
}

export function migrateLegacy(
  doc: SeriesDocument,
  legacyCrossrefs: LegacyCrossRefRecord[],
  legacyNotes: LegacyNoteRecord[],
  editorId = 'legacy'
): MigrationResult {
  const crossrefs: CrossRef[] = [];
  const notes: Note[] = [];
  const unclaimed: UnclaimedItem[] = [];
  const report = { crossrefLinked: 0, crossrefUnclaimed: 0, noteLinked: 0, noteUnclaimed: 0 };
  const now = new Date().toISOString();

  for (const record of legacyCrossrefs) {
    const quote = (record.quote ?? '').trim();
    const label = (record.label ?? quote ?? '旧稿互见').trim() || '旧稿互见';
    const raw = record.raw ?? JSON.stringify(record);
    const fromHits = record.from ? findSentencesByText(doc, record.from) : [];
    const targetHits = quote ? findSentencesByText(doc, quote) : [];
    const volume = resolveVolume(doc, record.volume);

    if (fromHits.length === 1 && targetHits.length === 1) {
      const anchor = findSentence(doc, fromHits[0].id);
      const target = findSentence(doc, targetHits[0].id);
      // 旧稿若写了卷册，目标必须确实在该卷；卷次对不上照样待认领
      const volumeMatches = !volume || (target && target.volume.id === volume.id);
      if (anchor && target && volumeMatches) {
        crossrefs.push({
          id: uid('x'),
          anchorSentenceId: anchor.sentence.id,
          label,
          targetVolumeId: target.volume.id,
          targetChapterId: target.chapter.id,
          targetSentenceId: target.sentence.id,
          editorId,
          updatedAt: now
        });
        report.crossrefLinked += 1;
        continue;
      }
    }

    // 没记卷册，或引句对不上/不止一处 → 待认领，绝不替它猜目标
    unclaimed.push({
      id: uid('u-x'),
      kind: 'crossref',
      label,
      quote: quote || undefined,
      volumeHint: record.volume?.trim() || undefined,
      raw,
      migratedAt: now
    });
    report.crossrefUnclaimed += 1;
  }

  for (const record of legacyNotes) {
    const quote = (record.quote ?? '').trim();
    const hits = quote ? findSentencesByText(doc, quote) : [];
    const raw = record.raw ?? JSON.stringify(record);
    if (hits.length === 1) {
      notes.push({
        id: uid('n'),
        kind: record.kind ?? 'footnote',
        sentenceId: hits[0].id,
        title: (record.title ?? quote).trim() || '旧稿注',
        body: (record.body ?? '').trim(),
        source: (record.source ?? '旧稿').trim() || '旧稿'
      });
      report.noteLinked += 1;
    } else {
      unclaimed.push({
        id: uid('u-n'),
        kind: 'note',
        label: (record.title ?? quote ?? '旧稿注').trim() || '旧稿注',
        quote: quote || undefined,
        raw,
        migratedAt: now
      });
      report.noteUnclaimed += 1;
    }
  }

  return { crossrefs, notes, unclaimed, report };
}

/** 待认领的互见：整理者选定“起点句”和“目标句”后认领，认领即可核对 */
export function claimCrossref(
  doc: SeriesDocument,
  unclaimedId: string,
  anchorSentenceId: string,
  target: { volumeId: string; chapterId: string; sentenceId: string },
  editorId: string
): boolean {
  const index = doc.unclaimed.findIndex((item) => item.id === unclaimedId && item.kind === 'crossref');
  if (index < 0) return false;
  const item = doc.unclaimed[index];
  const anchor = findSentence(doc, anchorSentenceId);
  const targetHit = findSentence(doc, target.sentenceId);
  if (!anchor || !targetHit) return false;
  doc.crossrefs.push({
    id: uid('x'),
    anchorSentenceId,
    label: item.label,
    targetVolumeId: targetHit.volume.id,
    targetChapterId: targetHit.chapter.id,
    targetSentenceId: targetHit.sentence.id,
    editorId,
    updatedAt: new Date().toISOString()
  });
  doc.unclaimed.splice(index, 1);
  return true;
}

/** 待认领的注，认领后挂到选定句 */
export function claimNote(doc: SeriesDocument, unclaimedId: string, sentenceId: string): boolean {
  const index = doc.unclaimed.findIndex((item) => item.id === unclaimedId && item.kind === 'note');
  if (index < 0) return false;
  const item = doc.unclaimed[index];
  if (!findSentence(doc, sentenceId)) return false;
  doc.notes.push({
    id: uid('n'),
    kind: 'footnote',
    sentenceId,
    title: item.label,
    body: item.raw,
    source: '旧稿'
  });
  doc.unclaimed.splice(index, 1);
  return true;
}

export function discardUnclaimed(doc: SeriesDocument, unclaimedId: string): void {
  doc.unclaimed = doc.unclaimed.filter((item) => item.id !== unclaimedId);
}
