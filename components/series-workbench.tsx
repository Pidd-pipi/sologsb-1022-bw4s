'use client';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Kbd,
  ScrollShadow,
  Select,
  SelectItem,
  Tab,
  Tabs,
  Textarea,
  Tooltip
} from '@heroui/react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FileDown,
  FileJson,
  GitCompareArrows,
  Keyboard,
  Link2,
  ListTree,
  Pencil,
  Printer,
  Redo2,
  Save,
  Search,
  Undo2,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { initialSeries, tokenizeText } from '@/lib/data';
import {
  STORAGE_KEY,
  clone,
  collectSearchResults,
  createInitialEditorState,
  editorReducer,
  findChapterOfSentence,
  getConflictGroups,
  getSentence,
  nextSentence,
  previousSentence,
  refsAtAnchor,
  removeAnnotationReferences,
  shiftSentence,
  updateSentenceText,
  volumeOf
} from '@/lib/editor';
import { recomputeCopy, recomputeSeries, volumeLabel } from '@/lib/recompute';
import { applyCopyToSeries, stageDecisions, writeCopyBack } from '@/lib/merge';
import { claimFragment, migrateLegacyText } from '@/lib/migrate';
import { buildHtml, buildJson, download } from '@/lib/export';
import { refStatusMeta } from './ref-card';
import { AnnotationCard, AnnotationForm, CrossRefForm, kindColors } from './annotation-panel';
import { RefCard } from './ref-card';
import { MergePanel } from './merge-panel';
import { TodosPanel } from './todos-panel';
import type {
  Annotation,
  AnchorType,
  ComputedSeries,
  CrossRef,
  EditorRole,
  RefDecision,
  ResolvedRef,
  ViewMode,
  WorkspaceState,
  WorkingCopy
} from '@/lib/types';

const MODE_COPY: Record<ViewMode, { label: string; hint: string }> = {
  reading: { label: '阅读版', hint: '只读正文，脚注按重算编号展开，互见显示“卷·章·第几句”指路' },
  editing: { label: '编辑版', hint: '调整句序章序、修订句子；互见与脚注编号随即重算' },
  critical: { label: '校勘版', hint: '逐句对照来源、异文，并核对互见指路是否落空' }
};

const ROLE_COPY: Record<EditorRole, string> = {
  chief: '总校',
  'editor-a': '整理者甲',
  'editor-b': '整理者乙'
};

export function SeriesWorkbench() {
  const [state, dispatch] = useReducer(editorReducer, initialSeries, createInitialEditorState);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [savedAt, setSavedAt] = useState('');
  const [rightTab, setRightTab] = useState('annotations');
  const [pendingAnchor, setPendingAnchor] = useState<{ id: string; type: AnchorType; preview: string } | null>(null);
  const [editingSentenceDraft, setEditingSentenceDraft] = useState('');
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const workspace: WorkspaceState = state.workspace;
  const series = workspace.series;
  const activeCopy = series.workingCopies.find((copy) => copy.id === workspace.activeCopyId) ?? null;

  // 阅读/校勘/检索/导出统一使用“重算后的稿面”：总校看底本，整理者看自己工作副本叠加稿
  const computed: ComputedSeries = useMemo(
    () => (activeCopy ? recomputeCopy(series, activeCopy) : recomputeSeries(series)),
    [series, activeCopy]
  );

  const conflicts = useMemo(() => getConflictGroups(computed), [computed]);
  const searchResults = useMemo(() => collectSearchResults(computed, workspace.query), [computed, workspace.query]);

  const selectedVolume =
    computed.volumes.find((volume) => volume.id === workspace.selectedVolumeId) ?? computed.volumes[0];
  const selectedChapter =
    computed.chapters.find((chapter) => chapter.id === workspace.selectedChapterId && chapter.volumeId === selectedVolume?.id) ??
    computed.chapters.find((chapter) => chapter.volumeId === selectedVolume?.id);
  const selectedSentence = getSentence(computed, workspace.selectedSentenceId);

  const anchor = pendingAnchor ?? {
    id: selectedSentence?.id ?? selectedChapter?.id ?? '',
    type: (selectedSentence ? 'sentence' : 'chapter') as AnchorType,
    preview: selectedSentence?.text ?? selectedChapter?.title ?? ''
  };
  const anchorAnnotations = computed.annotations.filter((annotation) => annotation.anchorId === anchor.id);
  const anchorRefs = computed.refs.filter((resolved) => resolved.ref.originAnchorId === anchor.id);
  const selectedAnnotation =
    computed.annotations.find((item) => item.id === workspace.selectedAnnotationId) ?? null;

  const canEditStructure = workspace.role === 'chief' || !!activeCopy;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as WorkspaceState;
        if (stored.series?.chapters?.length) dispatch({ type: 'hydrate', workspace: stored });
      }
    } catch {
      /* 草稿损坏则用底本 */
    }
    setHydrated(true);
    setOnline(navigator.onLine);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [hydrated, workspace]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    setPendingAnchor(
      selectedSentence
        ? { id: selectedSentence.id, type: 'sentence', preview: selectedSentence.text }
        : selectedChapter
          ? { id: selectedChapter.id, type: 'chapter', preview: selectedChapter.title }
          : null
    );
  }, [selectedChapter?.id, selectedSentence?.id]);

  const jumpToRef = useCallback(
    (resolved: ResolvedRef) => {
      if (!resolved.chapter || !resolved.sentence) return;
      dispatch({
        type: 'selectSentence',
        volumeId: resolved.chapter.volumeId,
        chapterId: resolved.chapter.id,
        sentenceId: resolved.sentence.id
      });
      setPendingAnchor(null);
    },
    []
  );

  // —— 变更作用面：整理者在副本内改本卷；总校直接改底本 ——
  function chaptersForMutation(copy?: WorkingCopy | null) {
    return copy ? copy.chapters : series.chapters;
  }
  function annotationsForMutation(copy?: WorkingCopy | null) {
    return copy ? copy.annotations : series.annotations;
  }

  function addAnnotation(values: Omit<Annotation, 'id' | 'status' | 'conflictState' | 'updatedAt'>) {
    const id = `annotation-${Date.now().toString(36)}`;
    dispatch({
      type: 'commit',
      label: '新增注释',
      mutate: ({ series: doc, copy }) => {
        const target = copy ? copy.annotations : doc.annotations;
        target.push({ ...values, id, status: 'open', conflictState: 'open', updatedAt: new Date().toISOString() });
      }
    });
    dispatch({ type: 'selectAnnotation', annotationId: id });
  }

  function addCrossRef(values: Omit<CrossRef, 'id' | 'status' | 'updatedAt'>) {
    const id = `ref-${Date.now().toString(36)}`;
    dispatch({
      type: 'commit',
      label: '新增互见指路',
      mutate: ({ series: doc, copy }) => {
        const target = copy ? copy.crossRefs : doc.crossRefs;
        target.push({ ...values, id, status: 'resolved', updatedAt: new Date().toISOString() });
      }
    });
    setRightTab('refs');
  }

  function updateAnnotation(id: string, patch: Partial<Annotation>) {
    dispatch({
      type: 'commit',
      label: '编辑注释',
      mutate: ({ series: doc, copy }) => {
        const list = copy ? copy.annotations : doc.annotations;
        const annotation = list.find((item) => item.id === id) ?? doc.annotations.find((item) => item.id === id);
        if (annotation) Object.assign(annotation, patch, { updatedAt: new Date().toISOString() });
      }
    });
  }

  function deleteAnnotation(id: string) {
    if (!window.confirm('删除该注释？')) return;
    dispatch({
      type: 'commit',
      label: '删除注释',
      mutate: ({ series: doc, copy }) => {
        const list = copy ? copy.annotations : doc.annotations;
        const index = list.findIndex((item) => item.id === id);
        if (index >= 0) list.splice(index, 1);
        else doc.annotations = doc.annotations.filter((item) => item.id !== id);
        removeAnnotationReferences(doc.annotations, id);
      }
    });
  }

  function retargetRef(refId: string, target: CrossRef['target'], quote: string) {
    dispatch({
      type: 'commit',
      label: '重指互见并销账',
      mutate: ({ series: doc, copy }) => {
        const list = copy ? copy.crossRefs : doc.crossRefs;
        const ref = list.find((item) => item.id === refId) ?? doc.crossRefs.find((item) => item.id === refId);
        if (!ref) return;
        ref.target = target;
        ref.targetQuote = quote;
        ref.status = 'resolved';
        ref.todoReason = undefined;
        ref.updatedAt = new Date().toISOString();
      }
    });
  }

  function applySentenceEdit() {
    if (!editingSentenceId || !editingSentenceDraft.trim()) return;
    let remapped = 0;
    dispatch({
      type: 'commit',
      label: '修订句子并触发重算',
      mutate: ({ series: doc, copy }) => {
        remapped = updateSentenceText(
          chaptersForMutation(copy),
          editingSentenceId,
          editingSentenceDraft.trim(),
          tokenizeText,
          annotationsForMutation(copy)
        );
      }
    });
    setEditingSentenceId(null);
    if (remapped) window.setTimeout(() => alert(`${remapped} 条词级引用已自动迁移到所属句`), 0);
  }

  function moveSentenceBy(direction: -1 | 1) {
    if (!selectedSentence || !selectedChapter) return;
    const scopeChapters = activeCopy
      ? activeCopy.chapters
      : series.chapters.filter((chapter) => chapter.volumeId === selectedChapter.volumeId);
    dispatch({
      type: 'commit',
      label: direction === -1 ? '句子上移（互见重算）' : '句子下移（互见重算）',
      mutate: () => {
        shiftSentence(scopeChapters, selectedSentence.id, direction);
      }
    });
  }

  function resolveConflict(group: { key: string; anchorId: string; kind: Annotation['kind']; annotations: Annotation[] }, winnerId: string) {
    dispatch({
      type: 'commit',
      label: '按来源解决冲突',
      mutate: ({ series: doc, copy }) => {
        const winner = group.annotations.find((a) => a.id === winnerId);
        const stamp = `${new Date().toISOString()} · 选用 ${winner?.source ?? '来源'}`;
        if (copy) {
          // 副本内解决：把命中的底本注释覆盖进副本，不直接改底本
          const scopedIds = new Set(copy.annotations.map((a) => a.id));
          for (const item of doc.annotations) {
            if (item.anchorId === group.anchorId && item.kind === group.kind && !scopedIds.has(item.id)) {
              const override: Annotation = structuredClone(item);
              override.conflictState = 'resolved';
              override.conflictResolution = stamp;
              copy.annotations.push(override);
            }
          }
          for (const item of copy.annotations) {
            if (item.anchorId === group.anchorId && item.kind === group.kind) {
              item.conflictState = 'resolved';
              item.conflictResolution = stamp;
            }
          }
        } else {
          for (const item of doc.annotations) {
            if (item.anchorId === group.anchorId && item.kind === group.kind) {
              item.conflictState = 'resolved';
              item.conflictResolution = stamp;
            }
          }
        }
      }
    });
  }

  // —— 工作副本 / 写回 ——
  function openCopy(copyId: string) {
    const copy = series.workingCopies.find((item) => item.id === copyId);
    if (!copy) return;
    dispatch({ type: 'setRole', role: copy.role });
    dispatch({ type: 'setActiveCopy', copyId });
    const firstChapter = copy.chapters[0];
    if (firstChapter) {
      dispatch({
        type: 'selectChapter',
        volumeId: copy.volumeId,
        chapterId: firstChapter.id
      });
    }
  }

  function closeCopy() {
    dispatch({ type: 'setActiveCopy', copyId: null });
    const firstChapter = series.chapters.find((chapter) => !chapter.volumeId.includes('unclaimed'));
    if (firstChapter) dispatch({ type: 'selectChapter', volumeId: firstChapter.volumeId, chapterId: firstChapter.id });
  }

  function doWriteBack(copyId: string, decisions: RefDecision[], retry = false) {
    const copy = series.workingCopies.find((item) => item.id === copyId);
    if (!copy) return;
    const result = writeCopyBack(series, copy);
    if (!result.ok) {
      // 写回失败：标记副本，不动底本；原稿保留，稍后可从原稿重试
      dispatch({
        type: 'commit',
        label: retry ? '重试写回仍失败' : '写回失败，原稿保留',
        mutate: ({ series: doc }) => {
          const target = doc.workingCopies.find((item) => item.id === copyId);
          if (target) {
            target.status = 'failed';
            target.lastError = result.error;
          }
        }
      });
      return;
    }
    dispatch({
      type: 'commit',
      label: '工作副本写回底本并重算',
      mutate: ({ series: doc }) => {
        const target = doc.workingCopies.find((item) => item.id === copyId);
        if (!target) return;
        stageDecisions(target, target.pendingRefs, decisions);
        applyCopyToSeries(doc, target, decisions);
        target.status = 'merged';
        target.lastError = undefined;
        target.failNextWrite = false;
      }
    });
    dispatch({ type: 'setActiveCopy', copyId: null });
    setRightTab('merge');
  }

  function doStage(copyId: string, decisions: RefDecision[]) {
    dispatch({
      type: 'commit',
      label: '暂存总校决定',
      mutate: ({ series: doc }) => {
        const target = doc.workingCopies.find((item) => item.id === copyId);
        const conflicts = target?.pendingRefs ?? [];
        if (target) stageDecisions(target, conflicts, decisions);
      }
    });
  }

  function doMigrate(raw: string) {
    dispatch({
      type: 'commit',
      label: '迁移旧稿',
      mutate: ({ series: doc }) => {
        const result = migrateLegacyText(doc, raw);
        window.setTimeout(
          () => alert(`迁移完成：归入 ${result.adoptedSentences} 句，待认领 ${result.unclaimed} 段，生成互见 ${result.crossRefs} 条（落空者已列待办）`),
          0
        );
      }
    });
  }

  function doClaim(fragmentId: string, volumeId: string, chapterId: string | null) {
    dispatch({
      type: 'commit',
      label: '认领旧稿入卷',
      mutate: ({ series: doc }) => claimFragment(doc, fragmentId, volumeId, chapterId)
    });
  }

  function saveSnapshot() {
    const id = `snapshot-${Date.now().toString(36)}`;
    dispatch({
      type: 'commit',
      label: '保存校订快照',
      mutate: ({ series: doc }) => {
        doc.snapshots.push({
          id,
          label: `校订快照 ${doc.snapshots.length + 1}`,
          note: `共 ${doc.crossRefs.length} 条互见、${doc.annotations.length} 条注释、${doc.unclaimed.length} 段待认领`,
          createdAt: new Date().toISOString(),
          volumes: clone(doc.volumes),
          chapters: clone(doc.chapters),
          annotations: clone(doc.annotations),
          crossRefs: clone(doc.crossRefs)
        });
      }
    });
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.workspace));
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        persist();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (typing) return;
      if (event.key === '/') {
        event.preventDefault();
        document.getElementById('global-search-input')?.focus();
      } else if (event.altKey && ['1', '2', '3'].includes(event.key)) {
        const mode = ({ '1': 'reading', '2': 'editing', '3': 'critical' } as const)[event.key as '1' | '2' | '3'];
        dispatch({ type: 'setMode', mode });
      } else if (event.key === ']' && selectedSentence) {
        const next = nextSentence(computed, selectedSentence.id);
        if (next) dispatch({ type: 'selectSentence', ...next });
      } else if (event.key === '[' && selectedSentence) {
        const previous = previousSentence(computed, selectedSentence.id);
        if (previous) dispatch({ type: 'selectSentence', ...previous });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [computed, selectedSentence]);

  function exportHtml() {
    download(`${series.title}.html`, buildHtml(computed, series.title), 'text/html;charset=utf-8');
  }
  function exportJson() {
    download(`${series.title}.json`, buildJson(computed, series), 'application/json;charset=utf-8');
  }

  const mode = workspace.mode;
  const noteNumbers = selectedChapter ? computed.footnotesByChapter.get(selectedChapter.id) ?? new Map() : new Map();
  const unclaimedVolume = computed.volumes.find((volume) => volume.unclaimed);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <div className="flex min-w-[240px] items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-stone-900 text-amber-300 shadow-sm">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-serif text-lg font-bold tracking-wide text-stone-900">稽古堂 · 丛书互见整理</h1>
              <p className="text-[11px] text-stone-500">{series.title} · {series.edition}</p>
            </div>
          </div>

          <Tabs
            aria-label="编辑视图"
            selectedKey={mode}
            onSelectionChange={(key) => dispatch({ type: 'setMode', mode: key as ViewMode })}
            size="sm"
            className="mx-auto"
          >
            {(Object.keys(MODE_COPY) as ViewMode[]).map((item) => (
              <Tab key={item} title={MODE_COPY[item].label} />
            ))}
          </Tabs>

          <div className="ml-auto flex items-center gap-2">
            <Select
              aria-label="当前角色"
              size="sm"
              className="w-32"
              selectedKeys={new Set([workspace.role])}
              onSelectionChange={(keys) => dispatch({ type: 'setRole', role: String(Array.from(keys)[0]) as EditorRole })}
            >
              <SelectItem key="chief">总校</SelectItem>
              <SelectItem key="editor-a">整理者甲</SelectItem>
              <SelectItem key="editor-b">整理者乙</SelectItem>
            </Select>
            <Chip size="sm" variant="flat" color={online ? 'success' : 'warning'} startContent={online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}>
              {online ? '在线' : '离线'}
            </Chip>
            <Tooltip content="撤销 ⌘/Ctrl + Z">
              <Button isIconOnly size="sm" variant="flat" aria-label="撤销" isDisabled={!state.past.length} onPress={() => dispatch({ type: 'undo' })}>
                <Undo2 className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content="重做 ⌘/Ctrl + Shift + Z">
              <Button isIconOnly size="sm" variant="flat" aria-label="重做" isDisabled={!state.future.length} onPress={() => dispatch({ type: 'redo' })}>
                <Redo2 className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content="保存到本地 ⌘/Ctrl + S">
              <Button size="sm" color="primary" startContent={<Save className="h-4 w-4" />} onPress={persist}>保存</Button>
            </Tooltip>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1800px] items-center gap-2 px-4 pb-2 text-xs text-stone-500 lg:px-6">
          <CircleHelp className="h-3.5 w-3.5" />
          <span>{MODE_COPY[mode].hint}</span>
          <span className="ml-auto hidden items-center gap-2 md:flex">
            <Kbd>[</Kbd><span>上句</span><Kbd>]</Kbd><span>下句</span><Kbd>/</Kbd><span>搜索</span><Kbd>Alt1/2/3</Kbd><span>切视图</span>
          </span>
        </div>
      </header>

      {activeCopy ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 lg:px-6">
          正在工作副本「{activeCopy.label}」上编辑 · 改动只存于副本，写回底本后才进入定本 ·
          <Button size="sm" variant="light" className="ml-2 h-6" onPress={closeCopy}>退出副本看底本</Button>
        </div>
      ) : null}

      <main className="mx-auto grid max-w-[1800px] grid-cols-1 gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)_410px] lg:p-6">
        {/* 左：检索 + 卷/章目录 */}
        <aside className="space-y-4 no-print">
          <Card shadow="sm" className="border border-stone-200">
            <CardBody className="gap-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold text-stone-900"><Search className="h-4 w-4" />全文检索</h2>
                <Chip size="sm" variant="flat">{searchResults.length} 项</Chip>
              </div>
              <Input
                id="global-search-input"
                ref={searchRef}
                aria-label="全文搜索"
                placeholder="正文、注释、互见指路…"
                value={workspace.query}
                onValueChange={(query) => dispatch({ type: 'setQuery', query })}
                startContent={<Search className="h-4 w-4 text-stone-400" />}
              />
              {workspace.query ? (
                <ScrollShadow className="max-h-56">
                  <div className="space-y-2 pr-1">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.kind}-${result.crossRefId ?? result.annotationId ?? result.sentenceId ?? result.chapterId}`}
                        type="button"
                        className={`w-full rounded-lg border p-2 text-left ${result.kind === 'todo' ? 'border-red-200 bg-red-50' : 'border-stone-200 bg-white hover:border-amber-400 hover:bg-amber-50'}`}
                        onClick={() => {
                          if (result.sentenceId) {
                            dispatch({ type: 'selectSentence', volumeId: result.volumeId, chapterId: result.chapterId, sentenceId: result.sentenceId });
                          } else {
                            dispatch({ type: 'selectChapter', volumeId: result.volumeId, chapterId: result.chapterId });
                          }
                          if (result.kind === 'crossref' || result.kind === 'todo') setRightTab('refs');
                          setPendingAnchor(null);
                        }}
                      >
                        <div className="text-xs font-semibold text-stone-800">{result.title}</div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-stone-500">{result.excerpt}</div>
                      </button>
                    ))}
                    {!searchResults.length ? <p className="p-2 text-xs text-stone-500">没有匹配内容。</p> : null}
                  </div>
                </ScrollShadow>
              ) : null}
            </CardBody>
          </Card>

          <Card shadow="sm" className="border border-stone-200">
            <CardHeader className="px-4 pb-0 pt-4">
              <h2 className="flex items-center gap-2 font-semibold text-stone-900"><ListTree className="h-4 w-4" />卷册目录</h2>
            </CardHeader>
            <CardBody className="gap-3 p-3">
              {computed.volumes.map((volume) => {
                const volumeChapters = computed.chapters.filter((chapter) => chapter.volumeId === volume.id);
                const todoInVolume = computed.todos.filter((todo) => todo.chapter?.volumeId === volume.id || (!todo.chapter && volume.unclaimed)).length;
                return (
                  <div key={volume.id}>
                    <div className="mb-1 flex items-center gap-2 px-1 text-xs font-bold text-stone-500">
                      <span>{volumeLabel(volume)}{!volume.unclaimed ? ` · ${volume.title}` : ''}</span>
                      {todoInVolume ? <Chip size="sm" color="danger" variant="flat">{todoInVolume} 待办</Chip> : null}
                    </div>
                    <div className="space-y-1">
                      {volumeChapters.map((chapter) => (
                        <button
                          key={chapter.id}
                          type="button"
                          className={`w-full rounded-xl border p-2.5 text-left transition ${
                            chapter.id === selectedChapter?.id ? 'border-amber-400 bg-amber-50' : 'border-transparent hover:border-stone-200 hover:bg-stone-50'
                          }`}
                          onClick={() => {
                            dispatch({ type: 'selectChapter', volumeId: volume.id, chapterId: chapter.id });
                            setPendingAnchor(null);
                          }}
                        >
                          <div className="flex items-center text-sm">
                            <span className="mr-2 grid h-5 w-5 place-items-center rounded-full bg-stone-900 text-[10px] text-white">{chapter.order}</span>
                            <span className="font-medium text-stone-900">{chapter.title}</span>
                            <ChevronRight className="ml-auto h-4 w-4 text-stone-400" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {unclaimedVolume && computed.unclaimed.length ? (
                <button
                  type="button"
                  className="w-full rounded-xl border border-dashed border-red-300 bg-red-50/60 p-2.5 text-left text-xs text-red-800"
                  onClick={() => setRightTab('todos')}
                >
                  待认领处有 {computed.unclaimed.length} 段旧稿 →
                </button>
              ) : null}
            </CardBody>
          </Card>

          <Card shadow="none" className="border border-dashed border-stone-300 bg-stone-50/70">
            <CardBody className="gap-1.5 p-4 text-xs text-stone-600">
              <div className="flex items-center gap-2 font-semibold text-stone-800"><Keyboard className="h-4 w-4" />工作流</div>
              <p>当前角色：{ROLE_COPY[workspace.role]}</p>
              <p>最后操作：{state.lastAction}</p>
              <p className="text-stone-400">{savedAt ? `本地已存 ${savedAt}` : '离线草稿'}</p>
            </CardBody>
          </Card>
        </aside>

        {/* 中：正文 */}
        <section className="min-w-0">
          <Card shadow="sm" className="paper-texture border border-stone-200">
            <CardHeader className="flex-col items-start gap-2 px-6 pb-2 pt-6 sm:flex-row sm:items-end">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-amber-700">
                  {selectedVolume ? volumeLabel(selectedVolume) : ''} · Chapter {selectedChapter?.order}
                </div>
                <h2 className="mt-1 font-serif text-3xl font-bold text-stone-900">{selectedChapter?.title}</h2>
                <p className="mt-1 text-sm text-stone-500">{selectedChapter?.summary}</p>
              </div>
              <div className="ml-auto flex flex-wrap justify-end gap-2">
                <Chip variant="flat" color="warning">{conflicts.length} 处来源冲突</Chip>
                <Chip variant="flat" color="danger">{computed.todos.length} 条互见待办</Chip>
                <Button size="sm" variant="flat" startContent={<Printer className="h-4 w-4" />} onPress={() => window.print()}>打印</Button>
              </div>
            </CardHeader>
            <Divider />
            <CardBody className="px-5 py-7 sm:px-9">
              <div className="mx-auto max-w-4xl space-y-4">
                {selectedChapter?.sentences.map((sentenceItem) => {
                  const sentenceAnnotations = computed.annotations.filter(
                    (annotation) =>
                      annotation.anchorId === sentenceItem.id ||
                      sentenceItem.tokens.some((token) => token.id === annotation.anchorId)
                  );
                  const sentenceRefs = refsAtAnchor(computed, sentenceItem.id);
                  const active = selectedSentence?.id === sentenceItem.id;
                  return (
                    <article
                      key={sentenceItem.id}
                      id={sentenceItem.id}
                      tabIndex={0}
                      className={`group rounded-2xl border p-4 transition focus-ring ${
                        active ? 'border-amber-300 bg-white shadow-sm' : 'border-transparent hover:border-stone-200 hover:bg-white/70'
                      }`}
                      onClick={() => selectedChapter && dispatch({ type: 'selectSentence', volumeId: selectedChapter.volumeId, chapterId: selectedChapter.id, sentenceId: sentenceItem.id })}
                    >
                      <div className="flex gap-3">
                        <span className="w-7 shrink-0 pt-1 text-right font-serif text-sm text-stone-400">{sentenceItem.order}</span>
                        <div className="min-w-0 flex-1">
                          {editingSentenceId === sentenceItem.id ? (
                            <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
                              <Textarea aria-label="编辑句子正文" value={editingSentenceDraft} onValueChange={setEditingSentenceDraft} minRows={2} autoFocus />
                              <div className="flex gap-2">
                                <Button size="sm" color="primary" onPress={applySentenceEdit}>保存并重算</Button>
                                <Button size="sm" variant="light" onPress={() => setEditingSentenceId(null)}>取消</Button>
                              </div>
                            </div>
                          ) : (
                            <p className="font-serif text-xl leading-[2.1] text-stone-800">
                              {sentenceItem.tokens.map((token) => {
                                const tokenAnnotations = computed.annotations.filter((annotation) => annotation.anchorId === token.id);
                                const tokenRefs = computed.refs.filter((resolved) => resolved.ref.originAnchorId === token.id);
                                if (!token.text.trim()) return <span key={token.id}>{token.text}</span>;
                                const hasMark = tokenAnnotations.length || tokenRefs.length;
                                return (
                                  <button
                                    key={token.id}
                                    type="button"
                                    className={`focus-ring rounded ${hasMark ? 'annotation-anchor' : 'hover:bg-amber-50'}`}
                                    aria-label={token.text}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (selectedChapter) dispatch({ type: 'selectSentence', volumeId: selectedChapter.volumeId, chapterId: selectedChapter.id, sentenceId: sentenceItem.id });
                                      setPendingAnchor({ id: token.id, type: 'word', preview: token.text });
                                    }}
                                  >
                                    {token.text}
                                    {tokenAnnotations.some((a) => a.kind === 'footnote') ? (
                                      <sup className="ml-0.5 text-[10px] text-blue-700">
                                        {tokenAnnotations.filter((a) => a.kind === 'footnote').map((a) => noteNumbers.get(a.id)).filter(Boolean).join(',')}
                                      </sup>
                                    ) : null}
                                  </button>
                                );
                              })}
                              {sentenceAnnotations.filter((a) => a.anchorId === sentenceItem.id && a.kind === 'footnote').length ? (
                                <sup className="ml-1 text-[11px] text-blue-700">
                                  {sentenceAnnotations.filter((a) => a.anchorId === sentenceItem.id && a.kind === 'footnote').map((a) => noteNumbers.get(a.id)).filter(Boolean).join(',')}
                                </sup>
                              ) : null}
                            </p>
                          )}

                          {/* 互见指路角标（重算结果） */}
                          {sentenceRefs.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {sentenceRefs.map((resolved) => {
                                const meta = refStatusMeta[resolved.status];
                                return (
                                  <button
                                    key={resolved.ref.id}
                                    type="button"
                                    title={resolved.status === 'todo' ? '待办：点不开目标' : `跳到 ${resolved.path}`}
                                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                      resolved.status === 'todo'
                                        ? 'border-red-300 bg-red-50 text-red-700'
                                        : resolved.status === 'quotedrift'
                                          ? 'border-amber-300 bg-amber-50 text-amber-800'
                                          : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                    }`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (resolved.status !== 'todo') jumpToRef(resolved);
                                      else setRightTab('todos');
                                    }}
                                  >
                                    <meta.icon className="mr-1 inline h-3 w-3" />
                                    {resolved.ref.label} → {resolved.status === 'todo' ? '待办' : `${resolved.chapter?.title}·第${resolved.sentence?.order}句`}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}

                          {mode === 'critical' ? (
                            <div className="mt-3 grid gap-2 rounded-xl border border-blue-100 bg-blue-50/50 p-3 sm:grid-cols-2">
                              {sentenceAnnotations.length ? sentenceAnnotations.map((annotation) => (
                                <div key={annotation.id} className="critical-variant text-xs leading-5">
                                  <div className="flex items-center gap-2">
                                    <Chip size="sm" color={kindColors[annotation.kind]} variant="flat">
                                      {annotation.kind === 'footnote' ? `脚注[${noteNumbers.get(annotation.id) ?? '?'}]` : { variant: '异文', background: '背景' }[annotation.kind]}
                                    </Chip>
                                    <b>{annotation.source}</b>
                                  </div>
                                  <p className="mt-1 text-stone-700">{annotation.body}</p>
                                </div>
                              )) : <p className="text-xs text-stone-500">本句尚无校记。</p>}
                              {sentenceRefs.map((resolved) => (
                                <div key={resolved.ref.id} className={`rounded-lg border p-2 text-[11px] leading-5 ${resolved.status === 'todo' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50/60'}`}>
                                  <b>互见指路：</b>{resolved.ref.label} → {resolved.path}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        {mode === 'editing' && canEditStructure && selectedChapter ? (
                          <div className="flex flex-col gap-1" onClick={(event) => event.stopPropagation()}>
                            <Tooltip content="上移（可跨章）">
                              <Button isIconOnly size="sm" variant="light" aria-label="句子上移" onPress={() => moveSentenceBy(-1)}>
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content="下移（可跨章）">
                              <Button isIconOnly size="sm" variant="light" aria-label="句子下移" onPress={() => moveSentenceBy(1)}>
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content="修订句子正文">
                              <Button isIconOnly size="sm" variant="light" aria-label="编辑句子" onPress={() => { setEditingSentenceId(sentenceItem.id); setEditingSentenceDraft(sentenceItem.text); }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        </section>

        {/* 右：工作区 */}
        <aside className="min-w-0 no-print">
          <Card shadow="sm" className="sticky top-[106px] max-h-[calc(100vh-124px)] border border-stone-200">
            <CardBody className="p-0">
              <Tabs aria-label="工作面板" fullWidth selectedKey={rightTab} onSelectionChange={(key) => setRightTab(String(key))} classNames={{ tabList: 'px-2 pt-2', panel: 'p-4' }}>
                <Tab key="annotations" title="注释">
                  <ScrollShadow className="max-h-[calc(100vh-210px)]">
                    <div className="space-y-4 pr-1">
                      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                        <Chip size="sm" variant="flat" color="warning">
                          {anchor.type === 'chapter' ? '章节' : anchor.type === 'sentence' ? '句子' : '词语'}
                        </Chip>
                        <p className="mt-2 line-clamp-2 font-serif text-sm leading-6 text-stone-800">{anchor.preview}</p>
                      </div>
                      {canEditStructure ? <AnnotationForm anchorId={anchor.id} anchorType={anchor.type} anchorPreview={anchor.preview.slice(0, 42)} onSubmit={addAnnotation} /> : (
                        <p className="rounded-lg border border-dashed border-stone-300 p-3 text-center text-xs text-stone-500">
                          整理者请先在左下方进入自己卷册的工作副本，或由总校切换到底本编辑。
                        </p>
                      )}
                      <Divider />
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-stone-900">此目标注释</h3>
                        <Chip size="sm" variant="flat">{anchorAnnotations.length}</Chip>
                      </div>
                      {anchorAnnotations.map((annotation) => (
                        <AnnotationCard
                          key={annotation.id}
                          annotation={annotation}
                          computed={computed}
                          number={annotation.kind === 'footnote' ? noteNumbers.get(annotation.id) : undefined}
                          selected={selectedAnnotation?.id === annotation.id}
                          onSelect={() => dispatch({ type: 'selectAnnotation', annotationId: annotation.id })}
                          onUpdate={(patch) => updateAnnotation(annotation.id, patch)}
                          onDelete={() => deleteAnnotation(annotation.id)}
                        />
                      ))}
                      {!anchorAnnotations.length ? <p className="text-xs text-stone-500">尚无注释。</p> : null}
                    </div>
                  </ScrollShadow>
                </Tab>

                <Tab key="refs" title={`互见 ${computed.refs.length}`}>
                  <ScrollShadow className="max-h-[calc(100vh-210px)]">
                    <div className="space-y-3 pr-1">
                      {canEditStructure ? (
                        <CrossRefForm computed={computed} originId={anchor.id} originType={anchor.type} onSubmit={addCrossRef} />
                      ) : null}
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-stone-900">本目标互见</h3>
                        <Link2 className="h-4 w-4 text-stone-400" />
                      </div>
                      {anchorRefs.length ? anchorRefs.map((resolved) => (
                        <RefCard key={resolved.ref.id} resolved={resolved} computed={computed} onJump={jumpToRef} onRetarget={canEditStructure ? retargetRef : undefined} />
                      )) : <p className="text-xs text-stone-500">本目标尚无互见。</p>}
                      <Divider />
                      <h3 className="font-semibold text-stone-900">全部互见指路</h3>
                      {computed.refs.map((resolved) => (
                        <RefCard key={resolved.ref.id} resolved={resolved} computed={computed} onJump={jumpToRef} compact onRetarget={canEditStructure ? retargetRef : undefined} />
                      ))}
                    </div>
                  </ScrollShadow>
                </Tab>

                <Tab key="todos" title={`待办 ${computed.todos.length + computed.unclaimed.length}`}>
                  <ScrollShadow className="max-h-[calc(100vh-210px)]">
                    <TodosPanel computed={computed} onRetarget={retargetRef} onMigrate={doMigrate} onClaim={doClaim} />
                  </ScrollShadow>
                </Tab>

                <Tab key="conflicts" title={`冲突 ${conflicts.length}`}>
                  <ScrollShadow className="max-h-[calc(100vh-210px)]">
                    <div className="space-y-3 pr-1">
                      <div className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800">
                        按“相同引用目标 + 相同注释类型”识别来源冲突，逐条选用来源；互见两边同改的并排定夺在「总校」页。
                      </div>
                      {conflicts.map((group) => (
                        <Card key={group.key} shadow="none" className="border border-red-100">
                          <CardBody className="gap-2 p-3">
                            <div className="flex items-center gap-2">
                              <Chip size="sm" color="danger" variant="flat">{group.kind === 'footnote' ? '脚注' : group.kind === 'variant' ? '异文' : '背景'}</Chip>
                              <span className="text-xs text-stone-500">{group.annotations.length} 个来源</span>
                            </div>
                            <p className="line-clamp-2 font-serif text-sm text-stone-800">{group.anchorLabel}</p>
                            {group.annotations.map((annotation) => (
                              <div key={annotation.id} className="rounded-lg border border-stone-200 bg-stone-50 p-2">
                                <div className="flex items-center justify-between"><b className="text-sm">{annotation.source}</b></div>
                                <p className="mt-1 text-xs leading-5 text-stone-600">{annotation.body}</p>
                                <Button size="sm" color="primary" variant="flat" className="mt-1" onPress={() => resolveConflict(group, annotation.id)} startContent={<Check className="h-3.5 w-3.5" />}>
                                  选用此条
                                </Button>
                              </div>
                            ))}
                          </CardBody>
                        </Card>
                      ))}
                      {!conflicts.length ? (
                        <div className="grid place-items-center rounded-xl border border-dashed border-green-200 bg-green-50 p-8 text-center">
                          <Check className="h-8 w-8 text-green-600" />
                          <p className="mt-2 text-sm font-medium text-green-800">来源冲突均已解决</p>
                        </div>
                      ) : null}
                    </div>
                  </ScrollShadow>
                </Tab>

                <Tab key="merge" title="总校">
                  <ScrollShadow className="max-h-[calc(100vh-210px)]">
                    <div className="space-y-4 pr-1">
                      {workspace.role !== 'chief' ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                          当前是 {ROLE_COPY[workspace.role]}。两边同改的互见需<strong>总校</strong>拍板；也可在此进入自己的工作副本继续整理。
                        </div>
                      ) : null}
                      <Card shadow="none" className="border border-stone-200">
                        <CardBody className="gap-2 p-3">
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900"><GitCompareArrows className="h-4 w-4" />工作副本</h3>
                          {series.workingCopies.filter((c) => c.status !== 'merged').map((copy) => (
                            <Button key={copy.id} size="sm" variant="flat" className="justify-start" onPress={() => openCopy(copy.id)}>
                              进入 {copy.label}
                            </Button>
                          ))}
                          {!series.workingCopies.some((c) => c.status !== 'merged') ? (
                            <p className="text-xs text-stone-500">所有副本均已写回。</p>
                          ) : null}
                        </CardBody>
                      </Card>
                      <MergePanel
                        computed={recomputeSeries(series)}
                        copies={series.workingCopies}
                        onWriteBack={(copyId, decisions) => doWriteBack(copyId, decisions)}
                        onRetry={(copyId, decisions) => doWriteBack(copyId, decisions, true)}
                        onStage={doStage}
                      />
                    </div>
                  </ScrollShadow>
                </Tab>

                <Tab key="export" title="版本/导出">
                  <ScrollShadow className="max-h-[calc(100vh-210px)]">
                    <div className="space-y-4 pr-1">
                      <Button className="w-full" size="sm" color="primary" variant="flat" startContent={<Save className="h-4 w-4" />} onPress={saveSnapshot}>
                        保存当前校订快照
                      </Button>
                      <div className="rounded-xl border border-stone-200 p-3 text-xs text-stone-500">
                        已有 {series.snapshots.length} 个快照：
                        <ul className="mt-2 space-y-1">
                          {series.snapshots.map((snapshot) => (
                            <li key={snapshot.id} className="flex justify-between"><span>{snapshot.label}</span><span>{snapshot.note}</span></li>
                          ))}
                        </ul>
                      </div>
                      <Divider />
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="flat" onPress={exportHtml} startContent={<FileDown className="h-4 w-4" />}>导出 HTML</Button>
                        <Button size="sm" variant="flat" onPress={exportJson} startContent={<FileJson className="h-4 w-4" />}>导出 JSON</Button>
                      </div>
                      <p className="text-[11px] leading-5 text-stone-500">
                        导出内容按当前重算稿面：脚注连续编号、互见为卷·章·句指路，待办互见单列。{activeCopy ? '当前导出的是该工作副本叠加稿。' : ''}
                      </p>
                    </div>
                  </ScrollShadow>
                </Tab>
              </Tabs>
            </CardBody>
          </Card>
        </aside>
      </main>

      <footer className="mx-auto max-w-[1800px] px-6 pb-8 text-center text-xs text-stone-400">
        数据保存在当前浏览器；互见与脚注编号在每次章句变动后整体重算。
      </footer>
    </div>
  );
}
