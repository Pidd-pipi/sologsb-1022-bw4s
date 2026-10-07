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
  Tabs,
  Tab,
  Tooltip
} from '@heroui/react';
import {
  BookCopy,
  GitBranch,
  Library,
  Printer,
  Search
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSeriesStore } from '@/lib/series/store';
import { searchIndex } from '@/lib/series/engine';
import { addChapter, addSentence, addVolume } from '@/lib/series/structure';
import type { ViewMode } from '@/lib/series/types';
import { TextColumn } from './text-column';
import { SidePanel } from './side-panel';

const MODE_COPY: Record<ViewMode, { label: string; hint: string }> = {
  reading: { label: '阅读版', hint: '按重算后的卷章次序阅读：脚注带章内编号，互见是可点击核对的卷/章/句指路。' },
  editing: { label: '编辑版', hint: '改字、调章序、把句子挪进别章；保存后互见地址与脚注号自动重算。' },
  critical: { label: '校勘版', hint: '逐句看异文与互见：指空标红、待认领标黄，全部来自最近一次重算。' }
};

export function SeriesWorkbench() {
  const store = useSeriesStore();
  const { state, ui, setUi, activeIndex: index, activeBranch } = store;
  const [addVolumeOpen, setAddVolumeOpen] = useState(false);
  const [newVolumeTitle, setNewVolumeTitle] = useState('');
  const [newChapterTitles, setNewChapterTitles] = useState<Record<string, string>>({});
  const [newSentenceTexts, setNewSentenceTexts] = useState<Record<string, string>>({});

  const volume = index.volumes.find((v) => v.id === ui.volumeId) ?? index.volumes[0];
  const chapter = volume?.chapters.find((c) => c.id === ui.chapterId) ?? volume?.chapters[0];

  // 切换卷/分支后校正选中项
  useEffect(() => {
    if (!volume) return;
    if (ui.volumeId !== volume.id || (chapter && ui.chapterId !== chapter.id)) {
      setUi({
        ...ui,
        volumeId: volume.id,
        chapterId: chapter?.id ?? '',
        sentenceId: chapter?.sentences[0]?.id ?? ''
      });
    }
  }, [volume?.id, chapter?.id]);

  const hits = useMemo(() => searchIndex(index, ui.query), [index, ui.query]);

  // 键盘：Alt+1/2/3 切视图，/ 聚焦检索
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (typing) return;
      if (event.altKey && ['1', '2', '3'].includes(event.key)) {
        const mode = ({ '1': 'reading', '2': 'editing', '3': 'critical' } as const)[event.key as '1' | '2' | '3'];
        setUi((prev) => ({ ...prev, mode }));
      } else if (event.key === '/') {
        event.preventDefault();
        document.getElementById('series-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setUi]);

  function navigate(target: { volumeId: string; chapterId: string; sentenceId: string }) {
    setUi({ ...ui, volumeId: target.volumeId, chapterId: target.chapterId, sentenceId: target.sentenceId, tab: ui.tab });
  }

  const linkedCount = index.crossrefs.filter((r) => r.status === 'linked').length;
  const danglingCount = index.crossrefs.filter((r) => r.status !== 'linked').length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <div className="flex min-w-[260px] items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-stone-900 text-amber-300">
              <Library className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-serif text-lg font-bold tracking-wide text-stone-900">稽古堂 · 丛书分卷整理台</h1>
              <p className="text-[11px] text-stone-500">{state.trunk.title} · 底本 revision {state.trunk.revision}</p>
            </div>
          </div>

          <Tabs
            aria-label="视图"
            selectedKey={ui.mode}
            onSelectionChange={(key) => setUi({ ...ui, mode: key as ViewMode })}
            size="sm"
            className="mx-auto"
          >
            {(Object.keys(MODE_COPY) as ViewMode[]).map((m) => <Tab key={m} title={MODE_COPY[m].label} />)}
          </Tabs>

          <div className="ml-auto flex items-center gap-2">
            <Chip size="sm" color="success" variant="flat">互见可核对 {linkedCount}</Chip>
            <Chip size="sm" color={danglingCount ? 'danger' : 'default'} variant="flat">
              {danglingCount ? `指空/待认领 ${danglingCount}` : '无指空'}
            </Chip>
            <Tooltip content="打印当前重算后的阅读版">
              <Button size="sm" variant="flat" isIconOnly aria-label="打印" onPress={() => window.print()}>
                <Printer className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1800px] items-center gap-2 px-4 pb-2 text-xs text-stone-500 lg:px-6">
          <BookCopy className="h-3.5 w-3.5" />
          <span>{MODE_COPY[ui.mode].hint}</span>
          <span className="ml-auto hidden items-center gap-2 md:flex">
            <Kbd>Alt 1/2/3</Kbd><span>切视图</span>
            <Kbd>/</Kbd><span>检索</span>
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1800px] grid-cols-1 gap-4 p-4 lg:grid-cols-[290px_minmax(0,1fr)_410px] lg:p-6">
        {/* 左：范围切换 + 检索 + 目录 */}
        <aside className="space-y-4">
          <Card shadow="sm" className="border border-stone-200">
            <CardBody className="gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <GitBranch className="h-4 w-4" />编辑范围
              </div>
              <Select
                size="sm"
                aria-label="编辑范围"
                selectedKeys={new Set([ui.scope.kind === 'trunk' ? 'trunk' : ui.scope.branchId])}
                onSelectionChange={(keys) => {
                  const value = String(Array.from(keys)[0]);
                  if (value === 'trunk') {
                    setUi({ ...ui, scope: { kind: 'trunk' } });
                  } else {
                    const branch = state.branches.find((b) => b.id === value);
                    const firstVolume = branch?.series.volumes.find((v) => branch.ownedVolumeIds.includes(v.id)) ?? branch?.series.volumes[0];
                    const firstChapter = firstVolume?.chapters[0];
                    setUi({
                      ...ui,
                      scope: { kind: 'branch', branchId: value },
                      volumeId: firstVolume?.id ?? '',
                      chapterId: firstChapter?.id ?? '',
                      sentenceId: firstChapter?.sentences[0]?.id ?? ''
                    });
                  }
                }}
              >
                {[
                  <SelectItem key="trunk">总校本（trunk）</SelectItem>,
                  ...state.branches.map((b) => (
                    <SelectItem key={b.id}>
                      {b.editorName} 的工作稿{b.status === 'writeback-failed' ? '（写回失败）' : ''}
                    </SelectItem>
                  ))
                ]}
              </Select>
              {activeBranch ? (
                <div className="rounded-lg bg-blue-50 p-2 text-[11px] leading-5 text-blue-800">
                  正在 {activeBranch.editorName} 的分支；底本 revision {activeBranch.baseRevision}。
                  改完到右侧「会校」页签写回；两边同改的互见要总校定。
                  <div className="mt-2">
                    <Button size="sm" variant="flat" onPress={() => setUi({ ...ui, scope: { kind: 'trunk' } })}>回到总校本</Button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-stone-500">总校视角：可直接调整全书结构、处理待办与裁定冲突。</p>
              )}
            </CardBody>
          </Card>

          <Card shadow="sm" className="border border-stone-200">
            <CardBody className="gap-2 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4" />检索（重算结果）</span>
                <Chip size="sm" variant="flat">{hits.length}</Chip>
              </div>
              <Input
                id="series-search-input"
                size="sm"
                aria-label="全文检索"
                placeholder="正文、脚注、互见地址…"
                value={ui.query}
                onValueChange={(query) => setUi({ ...ui, query })}
                startContent={<Search className="h-4 w-4 text-stone-400" />}
              />
              {ui.query ? (
                <ScrollShadow className="max-h-60">
                  <div className="space-y-1.5 pr-1">
                    {hits.map((hit, i) => (
                      <button
                        key={`${hit.sentenceId ?? hit.chapterId}-${i}`}
                        type="button"
                        className="w-full rounded-lg border border-stone-200 bg-white p-2 text-left hover:border-amber-400 hover:bg-amber-50"
                        onClick={() => navigate({ volumeId: hit.volumeId, chapterId: hit.chapterId, sentenceId: hit.sentenceId ?? '' })}
                      >
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-stone-800">
                          <Chip size="sm" color={hit.matchKind === '互见' ? 'success' : hit.matchKind === '正文' ? 'primary' : 'warning'} variant="flat">{hit.matchKind}</Chip>
                          {hit.title}
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px] text-stone-500">{hit.excerpt}</div>
                        <div className="mt-0.5 text-[10px] text-stone-400">{hit.address}</div>
                      </button>
                    ))}
                    {!hits.length ? <p className="p-2 text-xs text-stone-500">没有匹配。</p> : null}
                  </div>
                </ScrollShadow>
              ) : null}
            </CardBody>
          </Card>

          <Card shadow="sm" className="border border-stone-200">
            <CardHeader className="px-4 pb-0 pt-4">
              <h2 className="text-sm font-semibold">卷册目录</h2>
            </CardHeader>
            <CardBody className="gap-3 p-3">
              {index.volumes.map((v) => (
                <div key={v.id} className="rounded-xl border border-stone-200 p-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-stone-50"
                      onClick={() => setUi({ ...ui, volumeId: v.id, chapterId: v.chapters[0]?.id ?? '', sentenceId: v.chapters[0]?.sentences[0]?.id ?? '' })}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-stone-900 text-[11px] text-white">{v.order}</span>
                      <span className="font-medium">{v.title}</span>
                      <span className="ml-auto text-[11px] text-stone-400">{v.chapters.length} 章</span>
                    </button>
                  </div>
                  <div className="mt-1 space-y-0.5 pl-8">
                    {v.chapters.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`block w-full rounded-md px-2 py-1 text-left text-xs ${
                          chapter?.id === c.id && volume?.id === v.id ? 'bg-amber-100 font-semibold text-amber-900' : 'text-stone-600 hover:bg-stone-100'
                        }`}
                        onClick={() => setUi({ ...ui, volumeId: v.id, chapterId: c.id, sentenceId: c.sentences[0]?.id ?? '' })}
                      >
                        {c.order}. {c.title}
                        <span className="ml-1 text-stone-400">{c.sentences.length} 句</span>
                      </button>
                    ))}
                  </div>
                  {ui.mode === 'editing' && !activeBranch ? (
                    <div className="mt-1 flex gap-1 pl-8">
                      <Input
                        size="sm"
                        className="h-7"
                        aria-label={`在${v.title}新建章`}
                        placeholder="新章名"
                        value={newChapterTitles[v.id] ?? ''}
                        onValueChange={(val) => setNewChapterTitles({ ...newChapterTitles, [v.id]: val })}
                      />
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => {
                          const title = (newChapterTitles[v.id] ?? '').trim();
                          if (!title) return;
                          store.mutateTrunk(`在《${v.title}》新增章「${title}」`, (d) => addChapter(d, v.id, title));
                          setNewChapterTitles({ ...newChapterTitles, [v.id]: '' });
                        }}
                      >
                        加章
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}

              {ui.mode === 'editing' && !activeBranch ? (
                <div className="rounded-xl border border-dashed border-stone-300 p-2">
                  {addVolumeOpen ? (
                    <div className="flex gap-1">
                      <Input size="sm" aria-label="新卷名" placeholder="新卷题名" value={newVolumeTitle} onValueChange={setNewVolumeTitle} />
                      <Button
                        size="sm"
                        color="primary"
                        onPress={() => {
                          if (!newVolumeTitle.trim()) return;
                          store.mutateTrunk(`新增卷《${newVolumeTitle.trim()}》`, (d) => addVolume(d, newVolumeTitle));
                          setNewVolumeTitle('');
                          setAddVolumeOpen(false);
                        }}
                      >
                        建卷
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="flat" fullWidth onPress={() => setAddVolumeOpen(true)}>新增一卷</Button>
                  )}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </aside>

        {/* 中：正文 */}
        <section className="min-w-0">
          <Card shadow="sm" className="border border-stone-200">
            <CardHeader className="flex-col items-start gap-2 px-6 pb-2 pt-6 sm:flex-row sm:items-end">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-amber-700">
                  {activeBranch ? `工作稿 · ${activeBranch.editorName}` : '总校本'}
                </div>
                <h2 className="mt-1 font-serif text-2xl font-bold text-stone-900">
                  {volume?.title} · {chapter?.title ?? '（空章）'}
                </h2>
              </div>
              <div className="ml-auto flex flex-wrap gap-2 text-xs">
                <Chip size="sm" variant="flat">互见 {index.crossrefs.filter((r) => volume?.chapters.some((c) => c.id === index.locations.get(r.anchorSentenceId)?.chapter.id)).length}</Chip>
                <Chip size="sm" variant="flat">脚注 {index.notes.filter((n) => n.kind === 'footnote' && index.locations.get(n.sentenceId)?.volume.id === volume?.id).length}</Chip>
                <Chip size="sm" color="warning" variant="flat">待办 {index.todos.filter((t) => !t.unclaimedId).length}</Chip>
              </div>
            </CardHeader>
            <Divider />
            <CardBody className="px-5 py-7 sm:px-8">
              <TextColumn store={store} onNavigate={navigate} />
              {ui.mode === 'editing' && chapter ? (
                <div className="mx-auto mt-5 flex max-w-3xl gap-2 rounded-2xl border border-dashed border-stone-300 p-3">
                  <Input
                    size="sm"
                    aria-label="追加新句"
                    placeholder="在本章末尾追加一句（自动参与重算）"
                    value={newSentenceTexts[chapter.id] ?? ''}
                    onValueChange={(val) => setNewSentenceTexts({ ...newSentenceTexts, [chapter.id]: val })}
                  />
                  <Button
                    size="sm"
                    color="primary"
                    onPress={() => {
                      const text = (newSentenceTexts[chapter.id] ?? '').trim();
                      if (!text) return;
                      store.mutateActive('追加新句', (d) => addSentence(d, chapter.id, text));
                      setNewSentenceTexts({ ...newSentenceTexts, [chapter.id]: '' });
                    }}
                  >
                    追加句
                  </Button>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </section>

        {/* 右：校理面板 */}
        <aside className="min-w-0">
          <SidePanel store={store} />
        </aside>
      </main>

      {store.notice ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-stone-900 px-4 py-2 text-xs text-white shadow-lg">
          {store.notice}
          <button className="ml-3 text-stone-300 underline" onClick={() => store.setNotice('')}>知道了</button>
        </div>
      ) : null}

      <footer className="mx-auto max-w-[1800px] px-6 pb-8 text-center text-xs text-stone-400">
        指路关系与编号均由当前卷章结构重算（revision {state.trunk.revision}）；草稿保存在本浏览器 localStorage。
      </footer>
    </div>
  );
}
