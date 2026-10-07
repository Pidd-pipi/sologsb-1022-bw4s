'use client';

import { Button, Card, CardBody, Chip, Select, SelectItem } from '@heroui/react';
import { AlertTriangle, ArrowRight, CheckCircle2, HelpCircle, Pencil } from 'lucide-react';
import { useState } from 'react';
import type { ComputedSeries, CrossRef, RefStatus, ResolvedRef } from '@/lib/types';

export const refStatusMeta: Record<RefStatus, { label: string; color: 'success' | 'warning' | 'danger'; icon: typeof CheckCircle2 }> = {
  resolved: { label: '已核对', color: 'success', icon: CheckCircle2 },
  quotedrift: { label: '引文漂移', color: 'warning', icon: AlertTriangle },
  todo: { label: '待办', color: 'danger', icon: HelpCircle }
};

interface RefCardProps {
  resolved: ResolvedRef;
  computed: ComputedSeries;
  onJump: (resolved: ResolvedRef) => void;
  onRetarget?: (refId: string, target: CrossRef['target'], quote: string) => void;
  compact?: boolean;
}

/** 互见卡片：把指路关系摊开成“卷·章·第几句”，可核对、可跳转、可重指 */
export function RefCard({ resolved, computed, onJump, onRetarget, compact }: RefCardProps) {
  const { ref, status, path, chapter, sentence, quoteMatches } = resolved;
  const meta = refStatusMeta[status];
  const Icon = meta.icon;
  const [editing, setEditing] = useState(false);

  const realVolumes = computed.volumes.filter((volume) => !volume.unclaimed);
  const [volumeId, setVolumeId] = useState(chapter?.volumeId ?? realVolumes[0]?.id ?? '');
  const volumeChapters = computed.chapters.filter((item) => item.volumeId === volumeId);
  const [chapterId, setChapterId] = useState(chapter?.id ?? volumeChapters[0]?.id ?? '');
  const targetChapter = computed.chapters.find((item) => item.id === chapterId) ?? volumeChapters[0];
  const [sentenceId, setSentenceId] = useState(sentence?.id ?? targetChapter?.sentences[0]?.id ?? '');
  const targetSentence = targetChapter?.sentences.find((item) => item.id === sentenceId);

  return (
    <Card shadow="none" className={`border ${status === 'todo' ? 'border-red-200 bg-red-50/40' : status === 'quotedrift' ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/30'}`}>
      <CardBody className="gap-2 p-3">
        <div className="flex items-center gap-2">
          <Chip size="sm" color={meta.color} variant="flat" startContent={<Icon className="h-3 w-3" />}>{meta.label}</Chip>
          <span className="text-sm font-semibold text-stone-900">{ref.label}</span>
          <span className="ml-auto whitespace-nowrap text-[11px] text-stone-500">{ref.source}</span>
        </div>

        <button type="button" className="flex items-start gap-2 text-left focus-ring" onClick={() => onJump(resolved)} disabled={status === 'todo'}>
          <span className="mt-0.5 text-[11px] text-stone-400">指向</span>
          <span className="min-w-0 flex-1">
            <span className={`text-sm ${status === 'todo' ? 'text-red-700' : 'text-emerald-800'}`}>{path}</span>
            {status !== 'todo' ? <ArrowRight className="ml-1 inline h-3 w-3 text-emerald-600" /> : null}
          </span>
        </button>

        {ref.note ? <p className="text-xs leading-5 text-stone-600">{ref.note}</p> : null}
        {status === 'quotedrift' || (status === 'resolved' && !quoteMatches && ref.targetQuote) ? (
          <p className="rounded bg-amber-100/70 px-2 py-1 text-[11px] leading-5 text-amber-800">
            建指针时引文：{ref.targetQuote}
            <br />目标现文：{sentence?.text}
          </p>
        ) : null}
        {status === 'todo' ? (
          <p className="rounded bg-red-100/70 px-2 py-1 text-[11px] leading-5 text-red-800">
            指不到目标，已留作待办。可在下方重指到具体句子后销账。
          </p>
        ) : null}

        {!compact && onRetarget ? (
          editing ? (
            <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-2">
              <Select size="sm" label="卷" selectedKeys={new Set([volumeId])} onSelectionChange={(keys) => setVolumeId(String(Array.from(keys)[0]))}>
                {realVolumes.map((volume) => <SelectItem key={volume.id}>{`卷${volume.number}`}</SelectItem>)}
              </Select>
              <Select size="sm" label="章" selectedKeys={new Set([chapterId])} onSelectionChange={(keys) => setChapterId(String(Array.from(keys)[0]))}>
                {volumeChapters.map((item) => <SelectItem key={item.id}>{item.title}</SelectItem>)}
              </Select>
              <Select size="sm" label="句" selectedKeys={new Set([sentenceId])} onSelectionChange={(keys) => setSentenceId(String(Array.from(keys)[0]))}>
                {(targetChapter?.sentences ?? []).map((item) => (
                  <SelectItem key={item.id}>{`第 ${item.order} 句 · ${item.text.slice(0, 10)}`}</SelectItem>
                ))}
              </Select>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  color="success"
                  onPress={() => {
                    if (targetChapter && targetSentence) {
                      onRetarget(ref.id, { volumeId, chapterId: targetChapter.id, sentenceId: targetSentence.id }, targetSentence.text);
                      setEditing(false);
                    }
                  }}
                >
                  重指并销账
                </Button>
                <Button size="sm" variant="light" onPress={() => setEditing(false)}>取消</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="flat" startContent={<Pencil className="h-3.5 w-3.5" />} onPress={() => setEditing(true)}>
              {status === 'todo' ? '补指目标' : '重新指路'}
            </Button>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}
