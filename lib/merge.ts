import type {
  CrossRef,
  PendingRefConflict,
  RefDecision,
  SeriesDocument,
  WorkingCopy
} from './types';
import { recomputeSeries, renumberChapters, renumberSentences } from './recompute';

/** 两份互见是否“都动过且不一致” */
function refsConflict(base: CrossRef | undefined, a: CrossRef, b: CrossRef): boolean {
  if (!base) return false;
  const keyA = `${a.note}|${a.target.sentenceId ?? ''}|${a.target.chapterId ?? ''}|${a.target.volumeId ?? ''}|${a.targetQuote}`;
  const keyB = `${b.note}|${b.target.sentenceId ?? ''}|${b.target.chapterId ?? ''}|${b.target.volumeId ?? ''}|${b.targetQuote}`;
  const baseKey = `${base.note}|${base.target.sentenceId ?? ''}|${base.target.chapterId ?? ''}|${base.target.volumeId ?? ''}|${base.targetQuote}`;
  return keyA !== keyB && (keyA !== baseKey || keyB !== baseKey);
}

/**
 * 找出与另一工作副本“同一处互见两边都动过”的冲突项。
 * 只比较互见；句子移动各自独立应用。
 */
export function detectCopyConflicts(
  series: SeriesDocument,
  copy: WorkingCopy,
  others: WorkingCopy[]
): PendingRefConflict[] {
  const conflicts: PendingRefConflict[] = [];
  for (const ref of copy.crossRefs) {
    const base = series.crossRefs.find((item) => item.id === ref.id);
    for (const other of others) {
      // 即使对方已写回，也仍算作“两边都动过”，总校的并排定夺依然有效
      const otherRef = other.crossRefs.find((item) => item.id === ref.id);
      if (otherRef && refsConflict(base, ref, otherRef)) {
        conflicts.push({ refId: ref.id, label: ref.label, left: ref, right: otherRef });
      }
    }
  }
  const seen = new Set<string>();
  return conflicts.filter((item) => {
    if (seen.has(item.refId)) return false;
    seen.add(item.refId);
    return true;
  });
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

/**
 * 写回一份工作副本到底本。
 * - 句序/章序改动按稳定 id 应用，随后整体重算互见与脚注编号；
 * - 同一条互见两边都动过且总校未拍板 → 不写该条，保留在待决；
 * - 模拟写回失败（failNextWrite）时不动底本，可从原稿重试。
 */
export function writeCopyBack(series: SeriesDocument, copy: WorkingCopy): WriteResult {
  if (copy.failNextWrite) {
    return { ok: false, error: '模拟接口 503：写回被拒，原稿保留，可重试' };
  }
  return { ok: true };
}

/** 真正把副本内容应用到底本（写回成功或重试成功后调用，直接 mutate series） */
export function applyCopyToSeries(series: SeriesDocument, copy: WorkingCopy, decisions: RefDecision[]) {
  // 1. 用工作副本的该卷章节整体替换底本该卷章节（按稳定 id，跨卷的句子移动也随之生效）
  series.chapters = [
    ...series.chapters.filter((chapter) => chapter.volumeId !== copy.volumeId),
    ...structuredClone(copy.chapters)
  ];
  // 重排每卷章序、每卷章内句序
  for (const volume of series.volumes) {
    const volumeChapters = series.chapters.filter((chapter) => chapter.volumeId === volume.id);
    renumberChapters(volumeChapters);
    for (const chapter of volumeChapters) renumberSentences(chapter);
  }

  // 2. 注释：以副本同 id 覆盖、新增的追加
  for (const annotation of copy.annotations) {
    const index = series.annotations.findIndex((item) => item.id === annotation.id);
    if (index >= 0) series.annotations[index] = structuredClone(annotation);
    else series.annotations.push(structuredClone(annotation));
  }

  // 3. 互见：总校拍板的按决定取，未拍板的两边同改不写回
  const decided = new Map(decisions.map((decision) => [decision.refId, decision.choice]));
  const pendingIds = new Set(copy.pendingRefs.map((item) => item.refId));
  for (const ref of copy.crossRefs) {
    if (pendingIds.has(ref.id) && !decided.has(ref.id)) continue; // 留待总校
    if (decided.get(ref.id) === 'right') continue; // 总校取对方稿，本副本这条不写
    const index = series.crossRefs.findIndex((item) => item.id === ref.id);
    const next = structuredClone(ref);
    next.status = 'resolved';
    if (index >= 0) series.crossRefs[index] = next;
    else series.crossRefs.push(next);
  }

  series.updatedAt = new Date().toISOString();
  // 4. 整体重算：状态回写到各互见
  const computed = recomputeSeries(series);
  for (const resolved of computed.refs) {
    const target = series.crossRefs.find((item) => item.id === resolved.ref.id);
    if (target) {
      target.status = resolved.status;
      if (resolved.status === 'todo') {
        target.todoReason = resolved.reason ?? target.todoReason;
      } else {
        target.todoReason = undefined;
      }
    }
  }
}

/** 总校并排定夺：把决定写入副本；两边同改但未决的留在 pendingRefs */
export function stageDecisions(copy: WorkingCopy, conflicts: PendingRefConflict[], decisions: RefDecision[]) {
  copy.pendingRefs = conflicts.filter((conflict) => !decisions.some((decision) => decision.refId === conflict.refId));
  copy.refDecisions = decisions;
}
