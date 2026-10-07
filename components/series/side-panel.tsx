'use client';

import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  ScrollShadow,
  Select,
  SelectItem,
  Tab,
  Tabs,
  Textarea
} from '@heroui/react';
import {
  AlertTriangle,
  Check,
  FileDown,
  FileJson,
  GitMerge,
  Link2,
  ListChecks,
  RotateCcw,
  ScrollText,
  Send,
  WifiOff
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CrossConflict, Note, ResolvedCrossRef, SeriesIndex, WritebackReport } from '@/lib/series/types';
import type { SeriesStore } from '@/lib/series/store';
import { TargetPicker } from './target-picker';
import { addCrossref, addNote, deleteCrossref, deleteNote, updateCrossrefTarget } from '@/lib/series/annotations';
import { claimCrossref, claimNote, discardUnclaimed, migrateLegacy } from '@/lib/series/migration';
import { buildCriticalHtml, buildJsonExport, buildReadingHtml, download } from '@/lib/series/export';

export function SidePanel({ store }: { store: SeriesStore }) {
  return (
    <Card shadow="sm" className="sticky top-[110px] max-h-[calc(100vh-126px)] border border-stone-200">
      <CardBody className="p-0">
        <Tabs
          aria-label="校理面板"
          fullWidth
          selectedKey={store.ui.tab}
          onSelectionChange={(key) => store.setUi({ ...store.ui, tab: String(key) })}
          classNames={{ tabList: 'px-2 pt-2 flex-wrap', panel: 'p-3' }}
        >
          <Tab key="crossrefs" title={<TabTitle icon={<Link2 className="h-3.5 w-3.5" />} text="互见" />}>
            <CrossrefsTab store={store} />
          </Tab>
          <Tab key="notes" title="注记">
            <NotesTab store={store} />
          </Tab>
          <Tab
            key="todos"
            title={
              <TabTitle
                icon={<ListChecks className="h-3.5 w-3.5" />}
                text={`待办 ${store.trunkIndex.todos.length}`}
                badge={store.trunkIndex.todos.length}
              />
            }
          >
            <TodosTab store={store} />
          </Tab>
          <Tab
            key="review"
            title={
              <TabTitle
                icon={<GitMerge className="h-3.5 w-3.5" />}
                text="会校"
                badge={store.state.conflicts.filter((c) => c.status === 'open').length}
              />
            }
          >
            <ReviewTab store={store} />
          </Tab>
          <Tab
            key="legacy"
            title={
              <TabTitle
                icon={<ScrollText className="h-3.5 w-3.5" />}
                text="旧稿"
                badge={store.state.trunk.unclaimed.length}
              />
            }
          >
            <LegacyTab store={store} />
          </Tab>
          <Tab key="export" title={<TabTitle icon={<FileDown className="h-3.5 w-3.5" />} text="导出" />}>
            <ExportTab store={store} />
          </Tab>
        </Tabs>
      </CardBody>
    </Card>
  );
}

function TabTitle({ icon, text, badge }: { icon: React.ReactNode; text: string; badge?: number }) {
  return (
    <span className="flex items-center gap-1 text-xs">
      {icon}
      <span>{text}</span>
      {badge ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] text-white">{badge}</span> : null}
    </span>
  );
}

function panelHint(children: React.ReactNode) {
  return <div className="mb-3 rounded-lg bg-stone-100 p-2 text-[11px] leading-5 text-stone-600">{children}</div>;
}

// ---------- 互见 ----------

function CrossrefsTab({ store }: { store: SeriesStore }) {
  const { activeIndex: index, ui, activeDoc: doc, mutateActive } = store;
  const sentenceRefs = index.crossrefs.filter((r) => r.anchorSentenceId === ui.sentenceId);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState(() => firstTarget(index));
  const [repairId, setRepairId] = useState<string | null>(null);
  const [repairTarget, setRepairTarget] = useState(() => firstTarget(index));

  function create() {
    if (!label.trim()) return;
    mutateActive('新增互见指路', (d) => {
      addCrossref(d, { anchorSentenceId: ui.sentenceId, label, target, editorId: store.activeBranch?.editorId ?? 'chief' });
    });
    setLabel('');
  }

  return (
    <ScrollShadow className="max-h-[calc(100vh-210px)]">
      <div className="space-y-3 pr-1">
        {panelHint(<>互见必须选到<b>哪一卷、哪一章、哪一句</b>；章句调序后地址与脚注号自动重算，指不到目标会进待办。</>)}

        <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
          <div className="text-xs font-semibold text-stone-700">在当前句新增互见</div>
          <p className="mt-1 line-clamp-2 font-serif text-xs text-stone-500">{index.locations.get(ui.sentenceId)?.sentence.text}</p>
          <Input className="mt-2" size="sm" label="互见名目" placeholder="如：北冥南冥对举" value={label} onValueChange={setLabel} />
          <div className="mt-2">
            <TargetPicker index={index} value={target} onChange={setTarget} />
          </div>
          <Button className="mt-2 w-full" size="sm" color="primary" startContent={<Link2 className="h-4 w-4" />} onPress={create}>
            建立指路
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-stone-700">
            <span>本句互见</span>
            <Chip size="sm" variant="flat">{sentenceRefs.length}</Chip>
          </div>
          {sentenceRefs.map((r) => (
            <RefCard key={r.id} r={r} expanded={repairId === r.id}>
              {repairId === r.id ? (
                <div className="mt-2 space-y-2 border-t border-stone-200 pt-2">
                  <TargetPicker index={index} value={repairTarget} onChange={setRepairTarget} />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      color="primary"
                      onPress={() => {
                        mutateActive('修订互见指路', (d) => updateCrossrefTarget(d, r.id, { target: repairTarget }));
                        setRepairId(null);
                      }}
                    >
                      改指此处
                    </Button>
                    <Button size="sm" variant="light" onPress={() => setRepairId(null)}>取消</Button>
                  </div>
                </div>
              ) : null}
              <div className="mt-2 flex gap-2">
                {r.status !== 'linked' ? (
                  <Button size="sm" color="warning" variant="flat" onPress={() => { setRepairId(r.id); setRepairTarget(pickOf(index, r)); }}>
                    {r.status === 'unclaimed' ? '认领先指路' : '重指目标'}
                  </Button>
                ) : (
                  <Button size="sm" variant="light" onPress={() => setRepairId(r.id === repairId ? null : r.id)}>改指</Button>
                )}
                <Button size="sm" color="danger" variant="light" onPress={() => mutateActive('删除互见', (d) => deleteCrossref(d, r.id))}>
                  删除
                </Button>
              </div>
            </RefCard>
          ))}
          {!sentenceRefs.length ? <p className="rounded-lg border border-dashed p-3 text-center text-xs text-stone-500">本句还没有互见。</p> : null}
        </div>

        <DividerLite />
        <div className="text-xs font-semibold text-stone-700">全书互见（{index.crossrefs.length}）</div>
        <div className="space-y-1.5">
          {index.crossrefs.slice(0, 30).map((r) => (
            <RefCard key={r.id} r={r} />
          ))}
        </div>
      </div>
    </ScrollShadow>
  );
}

function firstTarget(index: SeriesIndex) {
  const v = index.volumes[0];
  const c = v?.chapters[0];
  const s = c?.sentences[0];
  return { volumeId: v?.id ?? '', chapterId: c?.id ?? '', sentenceId: s?.id ?? '' };
}

function pickOf(index: SeriesIndex, r: ResolvedCrossRef) {
  const loc = r.targetSentenceId ? index.locations.get(r.targetSentenceId) : undefined;
  if (loc) return { volumeId: loc.volume.id, chapterId: loc.chapter.id, sentenceId: loc.sentence.id };
  return firstTarget(index);
}

function RefCard({ r, children, expanded }: { r: ResolvedCrossRef; children?: React.ReactNode; expanded?: boolean }) {
  const color = r.status === 'linked' ? 'success' : r.status === 'dangling' ? 'danger' : 'warning';
  return (
    <div className={`rounded-xl border p-2.5 text-xs ${expanded ? 'border-amber-300 bg-amber-50/60' : 'border-stone-200 bg-white'}`}>
      <div className="flex items-center gap-2">
        <Chip size="sm" color={color} variant="flat">{r.status === 'linked' ? '可核对' : r.status === 'dangling' ? '指空' : '待认领'}</Chip>
        <b className="text-stone-800">{r.label}</b>
      </div>
      <div className="mt-1 leading-5 text-stone-600">
        <div>起：{r.anchorAddress}</div>
        <div>指：{r.targetAddress}</div>
        {r.targetExcerpt && r.status === 'linked' ? <div className="text-stone-400">引句：{r.targetExcerpt}</div> : null}
        {r.reason ? <div className="text-red-600">{r.reason}</div> : null}
      </div>
      {children}
    </div>
  );
}

// ---------- 脚注 / 异文 ----------

function NotesTab({ store }: { store: SeriesStore }) {
  const { activeIndex: index, ui, mutateActive } = store;
  const sentenceNotes = index.notes.filter((n) => n.sentenceId === ui.sentenceId);
  const [kind, setKind] = useState<Note['kind']>('footnote');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('整理者');

  function submit() {
    if (!title.trim() || !body.trim()) return;
    mutateActive('新增注记', (d) => addNote(d, { sentenceId: ui.sentenceId, kind, title, body, source }));
    setTitle('');
    setBody('');
  }

  return (
    <ScrollShadow className="max-h-[calc(100vh-210px)]">
      <div className="space-y-3 pr-1">
        {panelHit(<></>)}
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
          <Select
            size="sm"
            aria-label="注记类型"
            label="类型"
            selectedKeys={new Set([kind])}
            onSelectionChange={(keys) => setKind(String(Array.from(keys)[0]) as Note['kind'])}
          >
            <SelectItem key="footnote">脚注（占章内编号）</SelectItem>
            <SelectItem key="variant">异文（不占脚注号）</SelectItem>
          </Select>
          <Input className="mt-2" size="sm" label="标题" value={title} onValueChange={setTitle} />
          <Textarea className="mt-2" size="sm" minRows={2} label="正文" value={body} onValueChange={setBody} />
          <Input className="mt-2" size="sm" label="来源" value={source} onValueChange={setSource} />
          <Button className="mt-2 w-full" size="sm" color="primary" onPress={submit}>挂到当前句</Button>
        </div>
        <div className="space-y-2">
          {sentenceNotes.map((n) => (
            <div key={n.id} className="rounded-xl border border-stone-200 bg-white p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Chip size="sm" color={n.kind === 'footnote' ? 'primary' : 'warning'} variant="flat">
                  {n.kind === 'footnote' ? `脚注 ${n.number ?? '—'}` : '异文'}
                </Chip>
                <b>{n.title}</b>
                <span className="ml-auto text-stone-400">{n.source}</span>
              </div>
              <p className="mt-1 leading-5 text-stone-600">{n.body}</p>
              <Button size="sm" color="danger" variant="light" className="mt-1" onPress={() => mutateActive('删除注记', (d) => deleteNote(d, n.id))}>
                删除
              </Button>
            </div>
          ))}
          {!sentenceNotes.length ? <p className="rounded-lg border border-dashed p-3 text-center text-xs text-stone-500">本句暂无注记。</p> : null}
        </div>
      </div>
    </ScrollShadow>
  );
}

// ---------- 待办 ----------

function TodosTab({ store }: { store: SeriesStore }) {
  const { trunkIndex: index, state, mutateTrunk } = store;
  const groups = useMemo(
    () => ({
      dangling: index.todos.filter((t) => t.kind !== 'unclaimed'),
      unclaimed: index.todos.filter((t) => t.kind === 'unclaimed')
    }),
    [index.todos]
  );

  return (
    <ScrollShadow className="max-h-[calc(100vh-210px)]">
      <div className="space-y-3 pr-1">
        {panelHint(<>所有“指不到目标”的互见、失附的脚注都保留为待办，不会在正文里硬指路。旧稿里没记卷册的统一归<b>待认领</b>。</>)}
        <TodoGroup title="指空 / 失附" tone="red" items={groups.dangling} onJump={(todo) => {
          if (todo.sentenceId) {
            const loc = index.locations.get(todo.sentenceId);
            if (loc) store.setUi({ ...store.ui, tab: 'crossrefs', volumeId: loc.volume.id, chapterId: loc.chapter.id, sentenceId: loc.sentence.id });
          }
        }} />
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" />待认领（{state.trunk.unclaimed.length}）</div>
          {state.trunk.unclaimed.map((item) => (
            <UnclaimedCard
              key={item.id}
              item={item}
              store={store}
              onClaim={(anchor, target) => {
                mutateTrunk(`认领旧稿${item.kind === 'crossref' ? '互见' : '注记'}`, (d) => {
                  if (item.kind === 'crossref' && target) claimCrossref(d, item.id, anchor.sentenceId, target, 'chief');
                  else if (item.kind === 'note') claimNote(d, item.id, anchor.sentenceId);
                });
              }}
              onDiscard={() => mutateTrunk('丢弃无法认领的旧稿条', (d) => discardUnclaimed(d, item.id))}
            />
          ))}
          {!state.trunk.unclaimed.length ? <p className="rounded-lg border border-dashed p-3 text-center text-xs text-stone-500">没有待认领的旧稿。</p> : null}
        </div>
      </div>
    </ScrollShadow>
  );
}

function TodoGroup({
  title,
  tone,
  items,
  onJump
}: {
  title: string;
  tone: 'red' | 'amber';
  items: import('@/lib/series/types').TodoItem[];
  onJump: (todo: import('@/lib/series/types').TodoItem) => void;
}) {
  return (
    <div className="space-y-2">
      <div className={`text-xs font-semibold ${tone === 'red' ? 'text-red-700' : 'text-amber-800'}`}>{title}（{items.length}）</div>
      {items.map((todo) => (
        <button
          key={todo.id}
          type="button"
          className="w-full rounded-xl border border-red-200 bg-red-50/60 p-2.5 text-left text-xs hover:bg-red-50"
          onClick={() => onJump(todo)}
        >
          <b className="text-red-800">{todo.title}</b>
          <p className="mt-1 leading-5 text-stone-600">{todo.detail}</p>
        </button>
      ))}
      {!items.length ? <p className="rounded-lg border border-dashed p-3 text-center text-xs text-stone-500">无待办。</p> : null}
    </div>
  );
}

function UnclaimedCard({
  item,
  store,
  onClaim,
  onDiscard
}: {
  item: import('@/lib/series/types').UnclaimedItem;
  store: SeriesStore;
  onClaim: (anchor: { volumeId: string; chapterId: string; sentenceId: string }, target?: { volumeId: string; chapterId: string; sentenceId: string }) => void;
  onDiscard: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const first = () => {
    const v = store.trunkIndex.volumes[0];
    const c = v?.chapters[0];
    return { volumeId: v?.id ?? '', chapterId: c?.id ?? '', sentenceId: c?.sentences[0]?.id ?? '' };
  };
  const [anchor, setAnchor] = useState(first);
  const [target, setTarget] = useState(first);
  const isX = item.kind === 'crossref';
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs">
      <Chip size="sm" color="warning" variant="flat">{isX ? '旧互见' : '旧注'}</Chip>
      <b className="ml-1 text-amber-900">{item.label}</b>
      {item.quote ? <p className="mt-1 text-stone-600">引句：{item.quote}</p> : null}
      {item.volumeHint ? <p className="text-stone-500">原记卷册：{item.volumeHint}</p> : null}
      <p className="mt-1 text-[11px] text-stone-400">原稿：{item.raw}</p>
      {picking ? (
        <div className="mt-2 space-y-2 border-t border-amber-200 pt-2">
          <div className="font-semibold">{isX ? '① 互见挂在哪一句（起点）' : '此注挂到哪一句'}</div>
          <TargetPicker index={store.trunkIndex} value={anchor} onChange={setAnchor} />
          {isX ? (
            <>
              <div className="font-semibold">② 指向哪一卷哪一章哪一句（目标）</div>
              <TargetPicker index={store.trunkIndex} value={target} onChange={setTarget} />
            </>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" color="primary" onPress={() => { onClaim(anchor, isX ? target : undefined); setPicking(false); }}>
              {isX ? '认领并建立指路' : '认领此注'}
            </Button>
            <Button size="sm" variant="light" onPress={() => setPicking(false)}>取消</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" color="primary" variant="flat" onPress={() => setPicking(true)}>认领到具体句</Button>
          <Button size="sm" variant="light" color="danger" onPress={onDiscard}>丢弃</Button>
        </div>
      )}
    </div>
  );
}

// ---------- 会校（分支 / 写回 / 总校） ----------

function ReviewTab({ store }: { store: SeriesStore }) {
  const { state, dispatch, ui } = store;
  const [editorId, setEditorId] = useState(store.editors[0]?.id ?? '');
  const [volumeIds, setVolumeIds] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<WritebackReport | null>(null);

  const openConflicts = state.conflicts.filter((c) => c.status === 'open');
  const resolvedConflicts = state.conflicts.filter((c) => c.status === 'resolved');

  function openBranch() {
    const editor = store.editors.find((e) => e.id === editorId);
    if (!editor) return;
    const owned = [...volumeIds];
    if (!owned.length) {
      // 默认认领该编辑负责的卷
      const fallback = state.trunk.volumes.find((v) => v.editorId === editorId);
      if (fallback) owned.push(fallback.id);
    }
    dispatch({ type: 'openBranch', editorId, editorName: editor.name, ownedVolumeIds: owned });
  }

  function doWriteback(branchId: string) {
    // store.writeback 先在副本上试算以给出计数提示，再真正派发；失败时原稿原样保留
    const probe = store.writeback(branchId);
    setReport(probe);
  }

  return (
    <ScrollShadow className="max-h-[calc(100vh-210px)]">
      <div className="space-y-3 pr-1">
        {panelHint(<>整理者各自开分支编辑不同卷册。写回时做三方比对：<b>同一处互见两边都动过</b>就并排摆出，等总校定；写回失败可按原稿重试。</>)}

        <div className="rounded-xl border border-stone-200 p-3">
          <div className="text-xs font-semibold text-stone-700">开工作分支</div>
          <Select
            className="mt-2"
            size="sm"
            aria-label="整理者"
            label="整理者"
            selectedKeys={new Set([editorId])}
            onSelectionChange={(keys) => setEditorId(String(Array.from(keys)[0]))}
          >
            {store.editors.map((e) => <SelectItem key={e.id}>{e.name}</SelectItem>)}
          </Select>
          <div className="mt-2 text-[11px] text-stone-500">负责卷册（不选则按底本责任卷）</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {state.trunk.volumes.map((v) => {
              const on = volumeIds.has(v.id);
              return (
                <Button
                  key={v.id}
                  size="sm"
                  variant={on ? 'solid' : 'flat'}
                  color={on ? 'primary' : 'default'}
                  onPress={() => {
                    const nextSet = new Set(volumeIds);
                    if (on) nextSet.delete(v.id);
                    else nextSet.add(v.id);
                    setVolumeIds(nextSet);
                  }}
                >
                  {v.title}
                </Button>
              );
            })}
          </div>
          <Button className="mt-2 w-full" size="sm" color="primary" onPress={openBranch}>开分支</Button>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-stone-200 p-2.5 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.forceFail}
              onChange={(e) => dispatch({ type: 'toggleFail', value: e.target.checked })}
            />
            模拟下一次写回失败（503）
          </label>
          <WifiOff className={`h-4 w-4 ${state.forceFail ? 'text-red-500' : 'text-stone-300'}`} />
        </div>

        <div className="space-y-2">
          {state.branches.map((branch) => (
            <div key={branch.id} className="rounded-xl border border-stone-200 bg-white p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <b>{branch.editorName}</b>
                <Chip size="sm" color={branch.status === 'writeback-failed' ? 'danger' : branch.status === 'editing' ? 'warning' : 'success'} variant="flat">
                  {branch.status === 'writeback-failed' ? '写回失败' : branch.status === 'editing' ? '有改动' : '已同步'}
                </Chip>
                <Button
                  size="sm"
                  variant="flat"
                  className="ml-auto"
                  onPress={() => store.setUi({ ...ui, scope: { kind: 'branch', branchId: branch.id }, volumeId: branch.ownedVolumeIds[0] ?? store.trunkIndex.volumes[0].id, chapterId: '', sentenceId: '' })}
                >
                  进入工作稿
                </Button>
              </div>
              <div className="mt-1 text-stone-500">底本 revision {branch.baseRevision} → 工作稿 revision {branch.series.revision}；负责：{branch.ownedVolumeIds.map((id) => state.trunk.volumes.find((v) => v.id === id)?.title).join('、')}</div>
              {branch.lastError ? <p className="mt-1 text-red-600">{branch.lastError}</p> : null}
              <div className="mt-2 flex gap-2">
                <Button size="sm" color="primary" startContent={<Send className="h-3.5 w-3.5" />} onPress={() => doWriteback(branch.id)}>
                  写回总校本
                </Button>
                {branch.status === 'writeback-failed' ? (
                  <Button
                    size="sm"
                    color="warning"
                    variant="flat"
                    startContent={<RotateCcw className="h-3.5 w-3.5" />}
                    onPress={() => setReport(store.retry(branch.id))}
                  >
                    接口已恢复，从原稿重试
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {!state.branches.length ? <p className="rounded-lg border border-dashed p-3 text-center text-stone-500">还没有工作分支。</p> : null}
        </div>

        {report ? (
          <div className={`rounded-xl border p-2.5 text-xs ${report.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {report.ok
              ? `写回完成：互见 ${report.appliedCrossrefs} 条、注 ${report.appliedNotes} 条${report.appliedStructure ? '、卷章结构已并入' : ''}；${report.conflictsRaised} 处两边同改待总校定。`
              : `写回失败：${report.error ?? '未知错误'}；原稿保留，可重试。`}
          </div>
        ) : null}

        <DividerLite />
        <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
          <GitMerge className="h-4 w-4" />总校裁定（{openConflicts.length} 待裁 / {resolvedConflicts.length} 已裁）
        </div>
        {openConflicts.map((conflict) => <ConflictCard key={conflict.id} conflict={conflict} store={store} />)}
        {!openConflicts.length ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-green-200 bg-green-50 p-5 text-center text-xs text-green-800">
            <Check className="h-6 w-6" />
            <p className="mt-1">没有待裁定的互见冲突。</p>
          </div>
        ) : null}
        {resolvedConflicts.length ? (
          <details className="text-[11px] text-stone-500">
            <summary className="cursor-pointer">已裁定 {resolvedConflicts.length} 条</summary>
            {resolvedConflicts.map((c) => <div key={c.id} className="mt-1">· {c.label}（{c.decidedAt}）</div>)}
          </details>
        ) : null}
      </div>
    </ScrollShadow>
  );
}

function mementoText(m: CrossConflict['trunk']): string {
  if (!m) return '（无）';
  if (m.deleted) return '已删除';
  return `目标：${m.targetVolumeId ?? '?'} / ${m.targetChapterId ?? '?'} / ${m.targetSentenceId ?? '?'}`;
}

function ConflictCard({ conflict, store }: { conflict: CrossConflict; store: SeriesStore }) {
  const { state } = store;
  const renderSide = (m: CrossConflict['trunk'], excerpt: string, who: string, tone: string) => (
    <div className={`flex-1 rounded-lg border p-2 ${tone}`}>
      <div className="text-[11px] font-semibold">{who}</div>
      <div className="mt-1 text-[11px] leading-5">{mementoText(m)}</div>
      <div className="mt-1 text-[11px] text-stone-500">{excerpt}</div>
    </div>
  );
  const trunkSentence = conflict.trunk && !conflict.trunk.deleted && conflict.trunk.targetSentenceId
    ? describeFromIndex(store.trunkIndex, conflict.trunk.targetSentenceId)
    : '';
  const theirSentence = conflict.theirs && !conflict.theirs.deleted && conflict.theirs.targetSentenceId
    ? describeFromIndex(store.trunkIndex, conflict.theirs.targetSentenceId)
    : '';

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-3">
      <div className="flex items-center gap-2 text-xs">
        <Chip size="sm" color="danger" variant="flat">{conflict.reason === 'delete-vs-edit' ? '一删一改' : '两边同改'}</Chip>
        <b>{conflict.label}</b>
      </div>
      <p className="mt-1 text-[11px] text-stone-500">{conflict.anchorAddress} · {state.branches.find((b) => b.editorId === conflict.editorId)?.editorName ?? conflict.editorId}</p>
      <div className="mt-2 flex gap-2">
        {renderSide(conflict.trunk, conflict.trunkExcerpt || trunkSentence, '总校本（trunk）', 'border-stone-300 bg-white')}
        {renderSide(conflict.theirs, conflict.theirsExcerpt || theirSentence, '整理者（branch）', 'border-blue-200 bg-blue-50/60')}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" color="primary" variant="flat" onPress={() => store.dispatch({ type: 'resolve', conflictId: conflict.id, side: 'trunk' })}>
          采用总校本写回
        </Button>
        <Button size="sm" color="primary" variant="flat" onPress={() => store.dispatch({ type: 'resolve', conflictId: conflict.id, side: 'theirs' })}>
          采用整理者写回
        </Button>
      </div>
    </div>
  );
}

function describeFromIndex(index: import('@/lib/series/types').SeriesIndex, sentenceId: string): string {
  const loc = index.locations.get(sentenceId);
  return loc ? `${loc.volume.title}·${loc.chapter.title}·${loc.sentence.text}` : '（目标句在总校本中也找不到，将再落待办）';
}

// ---------- 旧稿迁移 ----------

function LegacyTab({ store }: { store: SeriesStore }) {
  const { mutateTrunk } = store;
  const [text, setText] = useState(
    [
      '# 每行一条旧稿：互见 从=引句 -> 引句 @ 卷名（可省略）',
      '互见 从=鹏之背 -> 南冥者天池 @ 内篇',
      '互见 从=河伯始旋 -> 其翼若垂天之云',
      '注 句=闻在宥天下 | 标题=在宥 | 正文=旧稿补入一条待定位的注 | 来源=墨笔夹签'
    ].join('\n')
  );

  function runImport() {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    mutateTrunk(`迁移旧稿 ${lines.length} 行`, (d) => {
      const legacyX = [];
      const legacyN = [];
      for (const line of lines) {
        if (line.startsWith('互见')) {
          const from = line.match(/从=([^\->|]+)/)?.[1]?.trim();
          const quote = line.match(/->\s*([^@|]+)/)?.[1]?.trim();
          const volume = line.match(/@\s*(.+)$/)?.[1]?.trim();
          legacyX.push({ from, quote, volume, label: quote ? `旧稿互见：${quote}` : '旧稿互见', raw: line });
        } else if (line.startsWith('注')) {
          const quote = line.match(/句=([^|]+)/)?.[1]?.trim();
          const title = line.match(/标题=([^|]+)/)?.[1]?.trim();
          const body = line.match(/正文=([^|]+)/)?.[1]?.trim();
          const source = line.match(/来源=([^|]+)/)?.[1]?.trim();
          legacyN.push({ quote, title, body, source, raw: line });
        }
      }
      const result = migrateLegacy(d, legacyX, legacyN, 'legacy-import');
      d.crossrefs.push(...result.crossrefs);
      d.notes.push(...result.notes);
      d.unclaimed.push(...result.unclaimed);
      store.setNotice(
        `迁移完成：互见自动对上 ${result.report.crossrefLinked} 条、待认领 ${result.report.crossrefUnclaimed} 条；注对上 ${result.report.noteLinked}、待认领 ${result.report.noteUnclaimed}。`
      );
    });
  }

  return (
    <ScrollShadow className="max-h-[calc(100vh-210px)]">
      <div className="space-y-3 pr-1">
        {panelHit(<>旧稿照抄的文字互见：引句在现稿中能唯一定位的，自动转成卷/章/句指路；<b>没记卷册或对不上</b>的归待认领，绝不替它猜。</>)}
        <Textarea minRows={6} value={text} onValueChange={setText} aria-label="旧稿文本" className="font-mono text-xs" />
        <Button fullWidth size="sm" color="primary" startContent={<ScrollText className="h-4 w-4" />} onPress={runImport}>
          迁移这批旧稿
        </Button>
        <div className="rounded-xl border border-stone-200 p-2.5 text-[11px] leading-5 text-stone-500">
          语法：<br />
          <code>{'互见 从=起点引句 -> 目标引句 @ 卷名'}</code><br />
          <code>{'注 句=所附注引句 | 标题=… | 正文=… | 来源=…'}</code><br />
          省略 @ 卷名即“没记卷册”，直接进待认领。
        </div>
      </div>
    </ScrollShadow>
  );
}

// ---------- 导出 ----------

function ExportTab({ store }: { store: SeriesStore }) {
  const { trunkIndex: index, state } = store;
  return (
    <ScrollShadow className="max-h-[calc(100vh-210px)]">
      <div className="space-y-3 pr-1">
        {panelHint(<>导出一律按<b>重算后</b>的卷章次序、脚注号和互见地址生成；待办单列，绝不把指空的互见当成正常指路。</>)}
        <div className="rounded-xl border border-stone-200 p-2.5 text-xs text-stone-600">
          当前底本 revision：<b>{state.trunk.revision}</b>；互见 {index.crossrefs.length}（可核对 {index.crossrefs.filter((r) => r.status === 'linked').length}）；待办 {index.todos.length}。
        </div>
        <Button
          fullWidth
          size="sm"
          color="primary"
          variant="flat"
          startContent={<FileDown className="h-4 w-4" />}
          onPress={() => download(`${state.trunk.title}-阅读版.html`, buildReadingHtml(state.trunk, index), 'text/html;charset=utf-8')}
        >
          导出阅读版 HTML
        </Button>
        <Button
          fullWidth
          size="sm"
          variant="flat"
          startContent={<FileDown className="h-4 w-4" />}
          onPress={() => download(`${state.trunk.title}-校勘版.html`, buildCriticalHtml(state.trunk, index), 'text/html;charset=utf-8')}
        >
          导出校勘版 HTML
        </Button>
        <Button
          fullWidth
          size="sm"
          variant="flat"
          startContent={<FileJson className="h-4 w-4" />}
          onPress={() => download(`${state.trunk.title}.json`, buildJsonExport(state.trunk, index), 'application/json;charset=utf-8')}
        >
          导出核对用 JSON（含重算视图）
        </Button>
        <Button
          fullWidth
          size="sm"
          variant="light"
          color="danger"
          startContent={<RotateCcw className="h-4 w-4" />}
          onPress={() => {
            if (window.confirm('清空浏览器草稿并恢复内置底本？')) store.resetAll();
          }}
        >
          重置为内置底本
        </Button>
      </div>
    </ScrollShadow>
  );
}

function DividerLite() {
  return <hr className="border-stone-200" />;
}

// 小占位：统一面板提示样式（panelHint 在上面定义），保留组件以简化条件渲染
function panelHit(node: React.ReactNode) {
  return panelHint(node);
}
