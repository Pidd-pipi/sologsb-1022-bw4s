'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PersistState, Scope, SeriesDocument, SeriesIndex, SeriesUiState, WritebackReport } from './types';
import { recompute } from './engine';
import { createInitialPersist, editors } from './seed';
import {
  applyWriteback,
  openBranch as openBranchMerge,
  resolveConflict as resolveConflictMerge,
  retryWriteback
} from './merge';

const STORAGE_KEY = 'jigutang-series-workbench/v1';

type Action =
  | { type: 'hydrate'; state: PersistState }
  | { type: 'trunk'; label: string; mutate: (doc: SeriesDocument) => void }
  | { type: 'branch'; branchId: string; label: string; mutate: (doc: SeriesDocument) => void }
  | { type: 'openBranch'; editorId: string; editorName: string; ownedVolumeIds: string[] }
  | { type: 'writeback'; branchId: string }
  | { type: 'retry'; branchId: string; forceOnline?: boolean }
  | { type: 'resolve'; conflictId: string; side: 'trunk' | 'theirs'; keepDeleted?: boolean }
  | { type: 'toggleFail'; value: boolean }
  | { type: 'log'; message: string }
  | { type: 'reset' };

function reducer(state: PersistState, action: Action): PersistState {
  const next: PersistState = structuredClone(state);
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'reset':
      return createInitialPersist();
    case 'trunk':
      action.mutate(next.trunk);
      next.log.unshift(`总校底本：${action.label}（revision ${next.trunk.revision}）`);
      return next;
    case 'branch': {
      const branch = next.branches.find((b) => b.id === action.branchId);
      if (!branch) return state;
      action.mutate(branch.series);
      branch.series.revision += 1;
      branch.series.updatedAt = new Date().toISOString();
      branch.status = 'editing';
      next.log.unshift(`${branch.editorName}：${action.label}`);
      return next;
    }
    case 'openBranch': {
      openBranchMerge(next, { editorId: action.editorId, editorName: action.editorName, ownedVolumeIds: action.ownedVolumeIds });
      return next;
    }
    case 'writeback': {
      applyWriteback(next, action.branchId);
      return next;
    }
    case 'retry': {
      if (action.forceOnline) next.forceFail = false;
      retryWriteback(next, action.branchId);
      return next;
    }
    case 'resolve': {
      resolveConflictMerge(next, action.conflictId, { side: action.side, keepDeleted: action.keepDeleted });
      return next;
    }
    case 'toggleFail':
      next.forceFail = action.value;
      next.log.unshift(`模拟接口已切换为${action.value ? '“下一次写回失败”' : '正常'}`);
      return next;
    case 'log':
      next.log.unshift(action.message);
      return next;
    default:
      return state;
  }
}

function initialUi(doc: SeriesDocument): SeriesUiState {
  const volume = doc.volumes[0];
  const chapter = volume?.chapters[0];
  const sentence = chapter?.sentences[0];
  return {
    scope: { kind: 'trunk' },
    role: 'chief',
    mode: 'reading',
    volumeId: volume?.id ?? '',
    chapterId: chapter?.id ?? '',
    sentenceId: sentence?.id ?? '',
    query: '',
    tab: 'reader'
  };
}

export function useSeriesStore() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialPersist);
  const [ui, setUi] = useState<SeriesUiState>(() => initialUi(state.trunk));
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState('');
  const saveTimer = useRef<number | null>(null);

  // 离线草稿恢复
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as PersistState;
        if (stored.trunk?.volumes?.length) {
          dispatch({ type: 'hydrate', state: stored });
          setUi(initialUi(stored.trunk));
        }
      }
    } catch {
      setNotice('离线草稿损坏，已回到内置底本。');
    }
    setHydrated(true);
  }, []);

  // 自动保存（防抖）
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        setNotice('本地空间不足，草稿未能写入。');
      }
    }, 400);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [hydrated, state]);

  const activeBranch = useMemo(() => {
    const scope: Scope = ui.scope;
    if (scope.kind !== 'branch') return undefined;
    return state.branches.find((b) => b.id === scope.branchId);
  }, [state.branches, ui.scope]);
  const activeDoc: SeriesDocument = activeBranch?.series ?? state.trunk;

  const trunkIndex: SeriesIndex = useMemo(() => recompute(state.trunk), [state.trunk]);
  const activeIndex: SeriesIndex = useMemo(() => recompute(activeDoc), [activeDoc]);
  const baseIndex: SeriesIndex | null = useMemo(() => (activeBranch ? recompute(activeBranch.base) : null), [activeBranch]);

  const mutateTrunk = useCallback((label: string, mutate: (doc: SeriesDocument) => void) => {
    dispatch({ type: 'trunk', label, mutate });
  }, []);

  const mutateActive = useCallback(
    (label: string, mutate: (doc: SeriesDocument) => void) => {
      if (ui.scope.kind === 'trunk') {
        dispatch({ type: 'trunk', label, mutate });
      } else {
        dispatch({ type: 'branch', branchId: ui.scope.branchId, label, mutate });
      }
    },
    [ui.scope]
  );

  const writeback = useCallback(
    (branchId: string, opts?: { retry?: boolean }): WritebackReport => {
      // 在克隆上按“当前真实失败开关”跑一遍：既能拿到计数，也能拿到真实失败结果。
      // 重试时按语义视为接口已恢复（forceFail 关闭）。
      const probeState: PersistState = structuredClone(state);
      if (opts?.retry) probeState.forceFail = false;
      const probe = applyWriteback(probeState, branchId);
      dispatch({ type: opts?.retry ? 'retry' : 'writeback', branchId, forceOnline: opts?.retry });
      return probe;
    },
    [state]
  );

  const retry = useCallback((branchId: string) => writeback(branchId, { retry: true }), [writeback]);

  const resetAll = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    dispatch({ type: 'reset' });
    setUi((prev) => ({ ...initialUi(createInitialPersist().trunk), mode: prev.mode }));
  }, []);

  return {
    editors,
    state,
    dispatch,
    ui,
    setUi,
    hydrated,
    notice,
    setNotice,
    activeBranch,
    activeDoc,
    trunkIndex,
    activeIndex,
    baseIndex,
    mutateTrunk,
    mutateActive,
    writeback,
    retry,
    resetAll
  };
}

export type SeriesStore = ReturnType<typeof useSeriesStore>;
