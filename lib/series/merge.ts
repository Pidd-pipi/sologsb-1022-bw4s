import type {
  Branch,
  CrossConflict,
  CrossRef,
  CrossRefMemento,
  NoteMemento,
  PersistState,
  SeriesDocument,
  WritebackReport
} from './types';
import { touch } from './structure';
import { uid } from './engine';

// 多人分卷：每位整理者带一份开分支时的底本（base）离线工作。
// 写回时对“同一处互见”做三方比对（base / trunk / theirs）：
//   - 只有一边动过 → 自动采用；
//   - 两边都动过（含一边删、一边改）→ 不擅自合并，并排留档，由总校定；
//   - 总校定案后才真正写回 trunk。
// 写回接口失败时分支保持原样（含 base 原稿），可一键从原稿重试。

const clone = <T,>(value: T): T => structuredClone(value);

function crossMemento(ref: CrossRef | undefined): CrossRefMemento | null {
  if (!ref) return null;
  return {
    label: ref.label,
    targetVolumeId: ref.targetVolumeId,
    targetChapterId: ref.targetChapterId,
    targetSentenceId: ref.targetSentenceId
  };
}

function noteMemento(note: SeriesDocument['notes'][number] | undefined): NoteMemento | null {
  if (!note) return null;
  return { title: note.title, body: note.body, source: note.source };
}

function sameCrossMemento(a: CrossRefMemento | null, b: CrossRefMemento | null): boolean {
  if (!a || !b) return a === b;
  if (a.deleted || b.deleted) return a.deleted === b.deleted;
  return (
    a.label === b.label &&
    a.targetVolumeId === b.targetVolumeId &&
    a.targetChapterId === b.targetChapterId &&
    a.targetSentenceId === b.targetSentenceId
  );
}

function sameNoteMemento(a: NoteMemento | null, b: NoteMemento | null): boolean {
  if (!a || !b) return a === b;
  if (a.deleted || b.deleted) return a.deleted === b.deleted;
  return a.title === b.title && a.body === b.body && a.source === b.source;
}

export interface OpenBranchInput {
  editorId: string;
  editorName: string;
  ownedVolumeIds: string[];
}

export function openBranch(state: PersistState, input: OpenBranchInput): Branch {
  const branch: Branch = {
    id: uid('br'),
    editorId: input.editorId,
    editorName: input.editorName,
    ownedVolumeIds: input.ownedVolumeIds,
    base: clone(state.trunk),
    series: clone(state.trunk),
    baseRevision: state.trunk.revision,
    status: 'clean'
  };
  state.branches.push(branch);
  state.log.unshift(`已为 ${input.editorName} 开出工作分支（底本 revision ${state.trunk.revision}）`);
  return branch;
}

function changedCrossrefIds(base: SeriesDocument, current: SeriesDocument): Set<string> {
  const ids = new Set<string>();
  const baseMap = new Map(base.crossrefs.map((r) => [r.id, r]));
  const currentMap = new Map(current.crossrefs.map((r) => [r.id, r]));
  for (const [id, ref] of currentMap) {
    const old = baseMap.get(id);
    if (!old || !sameCrossMemento(crossMemento(old), crossMemento(ref))) ids.add(id);
  }
  for (const id of baseMap.keys()) if (!currentMap.has(id)) ids.add(id);
  return ids;
}

function changedNoteIds(base: SeriesDocument, current: SeriesDocument): Set<string> {
  const ids = new Set<string>();
  const baseMap = new Map(base.notes.map((n) => [n.id, n]));
  const currentMap = new Map(current.notes.map((n) => [n.id, n]));
  for (const [id, note] of currentMap) {
    const old = baseMap.get(id);
    if (!old || !sameNoteMemento(noteMemento(old), noteMemento(note))) ids.add(id);
  }
  for (const id of baseMap.keys()) if (!currentMap.has(id)) ids.add(id);
  return ids;
}

/** 分支所属卷册的结构（卷/章/句）相对 base 是否有改动 */
function structureChanged(base: SeriesDocument, current: SeriesDocument, ownedVolumeIds: string[]): boolean {
  const owned = new Set(ownedVolumeIds);
  const shape = (doc: SeriesDocument) =>
    doc.volumes
      .filter((v) => owned.has(v.id))
      .map((v) => ({
        id: v.id,
        title: v.title,
        order: v.order,
        chapters: v.chapters.map((c) => ({
          id: c.id,
          title: c.title,
          order: c.order,
          sentences: c.sentences.map((s) => ({ id: s.id, order: s.order, text: s.text }))
        }))
      }));
  return JSON.stringify(shape(base)) !== JSON.stringify(shape(current));
}

/**
 * 试算写回：不动 trunk，先给出能否自动合并、哪些互见要总校定。
 * 结构（卷/章/句）改动只允许在无人交过同卷改动时整体并入；
 * 同卷结构已被别人先交，则整单转人工，避免章序互相覆盖。
 */
export function planWriteback(
  state: PersistState,
  branch: Branch
): {
  autoCrossrefs: CrossRef[];
  autoNotes: SeriesDocument['notes'];
  deletedCrossrefIds: string[];
  deletedNoteIds: string[];
  conflicts: Omit<CrossConflict, 'createdAt'>[];
  structureBlocked: boolean;
  structureChanged: boolean;
} {
  const trunk = state.trunk;
  const theirs = branch.series;
  const base = branch.base;

  const changedByBranch = changedCrossrefIds(base, theirs);
  const changedByTrunk = changedCrossrefIds(base, trunk);
  const baseMap = new Map(base.crossrefs.map((r) => [r.id, r]));
  const trunkMap = new Map(trunk.crossrefs.map((r) => [r.id, r]));
  const theirsMap = new Map(theirs.crossrefs.map((r) => [r.id, r]));

  const autoCrossrefs: CrossRef[] = [];
  const deletedCrossrefIds: string[] = [];
  const conflicts: Omit<CrossConflict, 'createdAt'>[] = [];

  for (const id of changedByBranch) {
    const baseRef = baseMap.get(id);
    const trunkRef = trunkMap.get(id);
    const theirRef = theirsMap.get(id);
    const trunkChanged = changedByTrunk.has(id);

    if (trunkChanged) {
      // 同一处互见两边都动过 → 并排摆出
      const deletedOnOne = !trunkRef || !theirRef;
      conflicts.push({
        id: uid('cf'),
        crossrefId: id,
        reason: deletedOnOne ? 'delete-vs-edit' : 'modified-both',
        status: 'open',
        editorId: branch.editorId,
        anchorAddress: theirRef?.anchorSentenceId
          ? describeSentence(trunk, theirRef.anchorSentenceId) ?? describeSentence(base, theirRef.anchorSentenceId) ?? '（起点句待查）'
          : '（该互见已被删除）',
        label: theirRef?.label ?? trunkRef?.label ?? baseRef?.label ?? '互见',
        trunk: trunkRef
          ? crossMemento(trunkRef)
          : { label: baseRef?.label ?? '', deleted: true, ...(crossMemento(baseRef) ?? {}) },
        trunkExcerpt: excerptFor(trunk, trunkRef),
        theirs: theirRef
          ? crossMemento(theirRef)
          : { label: baseRef?.label ?? '', deleted: true, ...(crossMemento(baseRef) ?? {}) },
        theirsExcerpt: excerptFor(theirs, theirRef),
        base: crossMemento(baseRef)
      });
      continue;
    }

    if (theirRef) autoCrossrefs.push(clone(theirRef));
    // 分支删除而 trunk 未动 → 自动接受删除（在 apply 阶段执行）
    if (!theirRef) deletedCrossrefIds.push(id);
  }

  // 注（脚注/异文）：只改了一边时自动并入；两边同改以总校（trunk）为准，
  // 需求强调的互见冲突另走总校队列。
  const changedNotesByBranch = changedNoteIds(base, theirs);
  const changedNotesByTrunk = changedNoteIds(base, trunk);
  const autoNotes: SeriesDocument['notes'] = [];
  const deletedNoteIds: string[] = [];
  for (const id of changedNotesByBranch) {
    if (changedNotesByTrunk.has(id)) continue; // 两边同改，保留主干
    const theirNote = theirs.notes.find((n) => n.id === id);
    if (theirNote) autoNotes.push(clone(theirNote));
    else deletedNoteIds.push(id);
  }

  const ownStructureChanged = structureChanged(base, theirs, branch.ownedVolumeIds);
  const trunkStructureChangedOnOwned = structureChanged(base, trunk, branch.ownedVolumeIds);

  return {
    autoCrossrefs,
    autoNotes,
    deletedCrossrefIds,
    deletedNoteIds,
    conflicts,
    structureBlocked: ownStructureChanged && trunkStructureChangedOnOwned,
    structureChanged: ownStructureChanged
  };
}

function describeSentence(doc: SeriesDocument, sentenceId: string): string | undefined {
  for (const volume of doc.volumes) {
    for (const chapter of volume.chapters) {
      const sentence = chapter.sentences.find((s) => s.id === sentenceId);
      if (sentence) return `《${volume.title}》· ${chapter.title} · “${sentence.text}”`;
    }
  }
  return undefined;
}

function excerptFor(doc: SeriesDocument, ref: CrossRef | undefined): string {
  if (!ref) return '（已删除）';
  const target = ref.targetSentenceId ? describeSentence(doc, ref.targetSentenceId) : undefined;
  return target ?? ref.label;
}

/** 真正写回（模拟接口：state.forceFail 时返回失败且不动任何数据） */
export function applyWriteback(state: PersistState, branchId: string): WritebackReport {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch) return { ok: false, appliedCrossrefs: 0, appliedNotes: 0, appliedStructure: false, error: '找不到工作分支' };
  if (state.forceFail) {
    branch.status = 'writeback-failed';
    branch.lastError = `模拟接口 503：写回未生效，底本（revision ${branch.baseRevision}）原样保留，可从原稿重试`;
    state.log.unshift(`写回失败：${branch.editorName} 的改动未写入，等待重试`);
    return { ok: false, appliedCrossrefs: 0, appliedNotes: 0, appliedStructure: false, error: branch.lastError };
  }

  const plan = planWriteback(state, branch);
  if (plan.structureBlocked) {
    branch.status = 'writeback-failed';
    branch.lastError = '所属卷册的章节结构已被他人先改并写回，为避免互相覆盖，请总校先处理结构';
    return { ok: false, appliedCrossrefs: 0, appliedNotes: 0, appliedStructure: false, error: branch.lastError };
  }

  // 1) 结构（仅分支拥有的卷；trunk 未动过时整体并入）
  let appliedStructure = false;
  if (plan.structureChanged) {
    for (const volume of branch.series.volumes) {
      if (!branch.ownedVolumeIds.includes(volume.id)) continue;
      const index = state.trunk.volumes.findIndex((v) => v.id === volume.id);
      if (index >= 0) state.trunk.volumes[index] = clone(volume);
      else state.trunk.volumes.push(clone(volume));
    }
    appliedStructure = true;
  }

  // 2) 互见冲突入总校队列；无冲突的自动并入/删除
  let appliedCrossrefs = 0;
  for (const planned of plan.autoCrossrefs) {
    const index = state.trunk.crossrefs.findIndex((r) => r.id === planned.id);
    if (index >= 0) state.trunk.crossrefs[index] = clone(planned);
    else state.trunk.crossrefs.push(clone(planned));
    appliedCrossrefs += 1;
  }
  for (const id of plan.deletedCrossrefIds) {
    state.trunk.crossrefs = state.trunk.crossrefs.filter((r) => r.id !== id);
    appliedCrossrefs += 1;
  }
  for (const conflict of plan.conflicts) {
    // 同一条若已在队列且仍 open，则不重复登记
    if (state.conflicts.some((c) => c.crossrefId === conflict.crossrefId && c.status === 'open')) continue;
    state.conflicts.push({ ...conflict, createdAt: new Date().toISOString() });
  }

  // 3) 注并入/删除
  let appliedNotes = 0;
  for (const planned of plan.autoNotes) {
    const index = state.trunk.notes.findIndex((n) => n.id === planned.id);
    if (index >= 0) state.trunk.notes[index] = clone(planned);
    else state.trunk.notes.push(clone(planned));
    appliedNotes += 1;
  }
  for (const id of plan.deletedNoteIds) {
    state.trunk.notes = state.trunk.notes.filter((n) => n.id !== id);
    appliedNotes += 1;
  }

  // 4) 新增的互见/注（分支里有、base 里没有，trunk 里也没有）
  for (const ref of branch.series.crossrefs) {
    if (branch.base.crossrefs.some((r) => r.id === ref.id)) continue;
    if (state.trunk.crossrefs.some((r) => r.id === ref.id)) continue;
    state.trunk.crossrefs.push(clone(ref));
    appliedCrossrefs += 1;
  }
  for (const note of branch.series.notes) {
    if (branch.base.notes.some((n) => n.id === note.id)) continue;
    if (state.trunk.notes.some((n) => n.id === note.id)) continue;
    state.trunk.notes.push(clone(note));
    appliedNotes += 1;
  }
  // 分支删除、base 中存在的注已在 autoNotes 标记中处理。

  touch(state.trunk);
  branch.status = 'clean';
  branch.lastError = undefined;
  branch.lastWriteAt = new Date().toISOString();
  branch.base = clone(state.trunk);
  branch.baseRevision = state.trunk.revision;
  state.log.unshift(
    `写回成功：${branch.editorName} 并入互见 ${appliedCrossrefs} 条、注 ${appliedNotes} 条${
      plan.conflicts.length ? `；${plan.conflicts.length} 处互见两边同改，待总校定` : ''
    }`
  );

  return {
    ok: true,
    appliedCrossrefs,
    appliedNotes,
    appliedStructure,
    conflictsRaised: plan.conflicts.length
  };
}

/** 从原稿重试：失败后什么都没动过，base/series 原样保留，直接再调一次写回 */
export function retryWriteback(state: PersistState, branchId: string): WritebackReport {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch) return { ok: false, appliedCrossrefs: 0, appliedNotes: 0, appliedStructure: false, error: '找不到工作分支' };
  state.log.unshift(`按原稿重试写回：${branch.editorName}（底本 revision ${branch.baseRevision}）`);
  return applyWriteback(state, branchId);
}

/** 总校定案：选择采用 trunk 版本或整理者版本（或删除），写回 trunk */
export function resolveConflict(
  state: PersistState,
  conflictId: string,
  decision: { side: 'trunk' | 'theirs'; keepDeleted?: boolean }
): void {
  const conflict = state.conflicts.find((c) => c.id === conflictId);
  if (!conflict || conflict.status === 'resolved') return;
  const chosen = decision.side === 'trunk' ? conflict.trunk : conflict.theirs;

  if (chosen?.deleted || decision.keepDeleted) {
    state.trunk.crossrefs = state.trunk.crossrefs.filter((r) => r.id !== conflict.crossrefId);
  } else if (chosen) {
    const existing = state.trunk.crossrefs.find((r) => r.id === conflict.crossrefId);
    if (existing) {
      existing.label = chosen.label;
      existing.targetVolumeId = chosen.targetVolumeId;
      existing.targetChapterId = chosen.targetChapterId;
      existing.targetSentenceId = chosen.targetSentenceId;
      existing.updatedAt = new Date().toISOString();
    }
  }
  conflict.status = 'resolved';
  conflict.decidedAt = new Date().toISOString();
  touch(state.trunk);
  state.log.unshift(`总校已定：互见 ${conflict.label} 采用${decision.side === 'trunk' ? '总校（主干）' : '整理者'}版本`);
}

export function updateBranchSeries(state: PersistState, branchId: string, mutate: (doc: SeriesDocument) => void): void {
  const branch = state.branches.find((b) => b.id === branchId);
  if (!branch) return;
  mutate(branch.series);
  touch(branch.series);
  branch.status = 'editing';
}
