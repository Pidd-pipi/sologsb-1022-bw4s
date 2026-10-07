'use client';

import { Button, Chip, Textarea, Tooltip } from '@heroui/react';
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  FolderInput,
  Link2,
  Pencil,
  Shuffle,
  Trash2
} from 'lucide-react';
import { useState } from 'react';
import type { ResolvedCrossRef, SeriesIndex } from '@/lib/series/types';
import type { SeriesStore } from '@/lib/series/store';
import { TargetPicker } from './target-picker';
import {
  deleteSentence,
  moveChapter,
  moveSentence,
  shiftChapter,
  shiftSentence,
  updateSentenceText
} from '@/lib/series/structure';

interface TextColumnProps {
  store: SeriesStore;
  onNavigate: (target: { volumeId: string; chapterId: string; sentenceId: string }) => void;
}

export function TextColumn({ store, onNavigate }: TextColumnProps) {
  const { activeDoc: doc, activeIndex: index, ui, setUi, mutateActive, activeBranch } = store;
  const canEditStructure = ui.mode === 'editing';
  const volume = index.volumes.find((v) => v.id === ui.volumeId) ?? index.volumes[0];
  const chapter = volume?.chapters.find((c) => c.id === ui.chapterId) ?? volume?.chapters[0];

  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [sentenceDraft, setSentenceDraft] = useState('');
  const [movingSentenceId, setMovingSentenceId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState({ volumeId: '', chapterId: '', sentenceId: '' });

  if (!volume || !chapter) {
    return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-stone-500">卷册为空，请先在左侧新建章句。</div>;
  }

  const ownedVolumeIds = activeBranch ? new Set(activeBranch.ownedVolumeIds) : null;
  const volumeOwned = !ownedVolumeIds || ownedVolumeIds.has(volume.id);

  function saveSentence(id: string) {
    if (sentenceDraft.trim()) mutateActive('修订句子文字（互见与脚注号将重算）', (d) => updateSentenceText(d, id, sentenceDraft));
    setEditingSentenceId(null);
  }

  function startMove(sentenceId: string) {
    setMovingSentenceId(sentenceId);
    setMoveTarget({ volumeId: volume!.id, chapterId: chapter!.id, sentenceId: chapter!.sentences[0]?.id ?? '' });
  }

  function confirmMove() {
    if (!movingSentenceId) return;
    mutateActive('句子挪章（稳定 ID 不变，指路自动跟到新位置）', (d) =>
      moveSentence(d, movingSentenceId, {
        chapterId: moveTarget.chapterId,
        beforeSentenceId: moveTarget.sentenceId
      })
    );
    setMovingSentenceId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip size="sm" color="primary" variant="flat">{volume.title}</Chip>
        <Chip size="sm" variant="flat">第 {chapter.order} 章</Chip>
        {canEditStructure ? (
          <div className="ml-auto flex items-center gap-1">
            <Tooltip content="本章上移">
              <Button isIconOnly size="sm" variant="light" aria-label="本章上移" onPress={() => mutateActive('章上移', (d) => shiftChapter(d, chapter!.id, -1))}>
                <ArrowUp className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content="本章下移">
              <Button isIconOnly size="sm" variant="light" aria-label="本章下移" onPress={() => mutateActive('章下移', (d) => shiftChapter(d, chapter!.id, 1))}>
                <ArrowDown className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Button
              size="sm"
              variant="flat"
              startContent={<FolderInput className="h-4 w-4" />}
              onPress={() => {
                const firstOther = index.volumes.find((v) => v.chapters.some((c) => c.id !== chapter!.id));
                const targetChapter = firstOther?.chapters.find((c) => c.id !== chapter!.id);
                if (targetChapter) {
                  mutateActive('整章移入他卷', (d) =>
                    moveChapter(d, chapter!.id, { volumeId: firstOther!.id, beforeChapterId: targetChapter.id })
                  );
                }
              }}
            >
              整章移入他卷
            </Button>
          </div>
        ) : null}
      </div>

      <h2 className="font-serif text-3xl font-bold text-stone-900">{chapter.title}</h2>

      <div className="space-y-4">
        {chapter.sentences.map((sentence, i) => {
          const refs = index.crossrefs.filter((r) => r.anchorSentenceId === sentence.id);
          const incoming = index.crossrefs.filter((r) => r.targetSentenceId === sentence.id && r.status === 'linked');
          const notes = index.notes.filter((n) => n.sentenceId === sentence.id);
          const footnotes = notes.filter((n) => n.kind === 'footnote');
          const variants = notes.filter((n) => n.kind === 'variant');
          const active = ui.sentenceId === sentence.id;

          return (
            <article
              key={sentence.id}
              id={sentence.id}
              tabIndex={0}
              onClick={() => setUi({ ...ui, sentenceId: sentence.id })}
              className={`rounded-2xl border p-4 transition focus:outline-none focus:ring-2 focus:ring-amber-300 ${
                active ? 'border-amber-300 bg-white shadow-sm' : 'border-stone-200/70 bg-white/60 hover:bg-white'
              }`}
            >
              <div className="flex gap-3">
                <span className="w-7 shrink-0 pt-1 text-right font-serif text-sm text-stone-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  {editingSentenceId === sentence.id ? (
                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                      <Textarea aria-label="编辑句子" value={sentenceDraft} onValueChange={setSentenceDraft} minRows={2} autoFocus />
                      <div className="flex gap-2">
                        <Button size="sm" color="primary" onPress={() => saveSentence(sentence.id)}>保存（编号重算）</Button>
                        <Button size="sm" variant="light" onPress={() => setEditingSentenceId(null)}>取消</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="font-serif text-xl leading-[2.05] text-stone-800">
                      {sentence.text}
                      {footnotes.map((n) => (
                        <sup key={n.id} className="ml-0.5 cursor-pointer text-xs text-amber-700" title={`${n.title}：${n.body}`}>
                          [{n.number}]
                        </sup>
                      ))}
                      {refs
                        .filter((r) => r.status === 'linked')
                        .map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            className="mx-1 align-super text-[11px] text-emerald-700 underline decoration-dotted underline-offset-2"
                            title={`互见 → ${r.targetAddress}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (r.targetSentenceId) {
                                const loc = index.locations.get(r.targetSentenceId);
                                if (loc) onNavigate({ volumeId: loc.volume.id, chapterId: loc.chapter.id, sentenceId: loc.sentence.id });
                              }
                            }}
                          >
                            互见→{locatorShort(index, r)}
                          </button>
                        ))}
                    </p>
                  )}

                  {/* 互见状态行 */}
                  {refs.length ? (
                    <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                      {refs.map((r) => <RefLine key={r.id} r={r} index={index} onNavigate={onNavigate} />)}
                    </div>
                  ) : null}
                  {incoming.length ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-700">
                      <CornerDownRight className="h-3.5 w-3.5" />
                      {incoming.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className="rounded-full bg-emerald-50 px-2 py-0.5 hover:bg-emerald-100"
                          title={`来自 ${r.anchorAddress}`}
                          onClick={() => {
                            const loc = index.locations.get(r.anchorSentenceId);
                            if (loc) onNavigate({ volumeId: loc.volume.id, chapterId: loc.chapter.id, sentenceId: loc.sentence.id });
                          }}
                        >
                          他处互见至此：{r.label}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {variants.length && ui.mode === 'critical' ? (
                    <div className="mt-2 space-y-1 rounded-lg bg-amber-50/60 p-2 text-xs text-stone-700">
                      {variants.map((v) => (
                        <div key={v.id}><b className="text-amber-800">异文｜{v.source}</b>：{v.body}</div>
                      ))}
                    </div>
                  ) : null}

                  {canEditStructure && volumeOwned ? (
                    <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="light" startContent={<Pencil className="h-3.5 w-3.5" />} onPress={() => { setEditingSentenceId(sentence.id); setSentenceDraft(sentence.text); }}>
                        改字
                      </Button>
                      <Button size="sm" variant="light" startContent={<Shuffle className="h-3.5 w-3.5" />} onPress={() => startMove(sentence.id)}>
                        挪到别章
                      </Button>
                      <Button size="sm" variant="light" isIconOnly aria-label="句上移" onPress={() => mutateActive('句上移', (d) => shiftSentence(d, sentence.id, -1))}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="light" isIconOnly aria-label="句下移" onPress={() => mutateActive('句下移', (d) => shiftSentence(d, sentence.id, 1))}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="light"
                        color="danger"
                        isIconOnly
                        aria-label="删除句子（指路留待办）"
                        onPress={() => {
                          if (window.confirm('删除此句？指向它的互见和脚注不会被悄悄抹掉，将保留为待办。')) {
                            mutateActive('删除句子，指路留待办', (d) => deleteSentence(d, sentence.id));
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}

                  {movingSentenceId === sentence.id ? (
                    <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-stone-600"><FolderInput className="h-4 w-4" />挪到哪一卷哪一章哪一句之前</div>
                      <TargetPicker index={index} value={moveTarget} onChange={setMoveTarget} />
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" color="primary" onPress={confirmMove}>确认挪动</Button>
                        <Button size="sm" variant="light" onPress={() => setMovingSentenceId(null)}>取消</Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function locatorShort(index: SeriesIndex, r: ResolvedCrossRef): string {
  const loc = r.targetSentenceId ? index.locations.get(r.targetSentenceId) : undefined;
  if (!loc) return '待办';
  return `${loc.volume.title.replace('庄子·', '')}·${loc.chapter.title}·${loc.sentenceIndex + 1}`;
}

function RefLine({
  r,
  index,
  onNavigate
}: {
  r: ResolvedCrossRef;
  index: SeriesIndex;
  onNavigate: TextColumnProps['onNavigate'];
}) {
  const tone =
    r.status === 'linked'
      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
      : r.status === 'dangling'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-amber-200 bg-amber-50 text-amber-800';
  const tag = r.status === 'linked' ? '可核对' : r.status === 'dangling' ? '指空·待办' : '待认领';
  return (
    <div className={`flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${tone}`}>
      <Link2 className="h-3.5 w-3.5" />
      <span className="font-semibold">{r.label}</span>
      <span>→</span>
      <span>{r.targetAddress}</span>
      {r.status === 'linked' && r.targetExcerpt ? <span className="text-stone-500">“{r.targetExcerpt}”</span> : null}
      {r.status !== 'linked' && r.reason ? <span className="text-stone-500">（{r.reason}）</span> : null}
      <Chip size="sm" color={r.status === 'linked' ? 'success' : r.status === 'dangling' ? 'danger' : 'warning'} variant="bordered">
        {tag}
      </Chip>
      {r.status === 'linked' ? (
        <Button
          size="sm"
          variant="light"
          className="ml-auto h-6 min-h-0 px-2 text-[11px]"
          onPress={() => {
            const loc = index.locations.get(r.targetSentenceId!);
            if (loc) onNavigate({ volumeId: loc.volume.id, chapterId: loc.chapter.id, sentenceId: loc.sentence.id });
          }}
        >
          跳转
        </Button>
      ) : null}
    </div>
  );
}
