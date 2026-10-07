'use client';

import { Button, Card, CardBody, Chip, Select, SelectItem, Textarea } from '@heroui/react';
import { Inbox, ListChecks, UploadCloud } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RefCard } from './ref-card';
import type { ComputedSeries, CrossRef, ResolvedRef, SeriesDocument } from '@/lib/types';

interface TodosPanelProps {
  computed: ComputedSeries;
  onRetarget: (refId: string, target: CrossRef['target'], quote: string) => void;
  onMigrate: (raw: string) => void;
  onClaim: (fragmentId: string, volumeId: string, chapterId: string | null) => void;
}

export function TodosPanel({ computed, onRetarget, onMigrate, onClaim }: TodosPanelProps) {
  const [raw, setRaw] = useState('');
  const realVolumes = computed.volumes.filter((volume) => !volume.unclaimed);

  return (
    <div className="space-y-4">
      <Card shadow="none" className="border border-stone-200">
        <CardBody className="gap-2 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <ListChecks className="h-4 w-4 text-red-600" /> 待办互见（指不到目标）
            <Chip size="sm" color="danger" variant="flat" className="ml-auto">{computed.todos.length}</Chip>
          </div>
          {computed.todos.length ? (
            <div className="space-y-2">
              {computed.todos.map((resolved: ResolvedRef) => (
                <RefCard
                  key={resolved.ref.id}
                  resolved={resolved}
                  computed={computed}
                  onJump={() => undefined}
                  onRetarget={onRetarget}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-green-200 bg-green-50 p-3 text-center text-xs text-green-800">
              所有互见都能指到目标。
            </p>
          )}
        </CardBody>
      </Card>

      <Card shadow="none" className="border border-stone-200">
        <CardBody className="gap-2 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <UploadCloud className="h-4 w-4 text-blue-600" /> 迁移旧稿
          </div>
          <p className="text-[11px] leading-5 text-stone-500">
            每行一段。行首写“卷一 / 卷二”并带章题的挂到对应章末；<strong>没记卷册</strong>或对不上章的整段进“待认领处”。
            文中“见/参见/互见 …”的照抄语会转成指路关系，指不到目标留成待办。
          </p>
          <Textarea
            aria-label="旧稿文本"
            minRows={4}
            value={raw}
            onValueChange={setRaw}
            placeholder={'卷一·养生主：吾生也有涯，而知也无涯。参见《齐物论》\n旧册残页：天地与我并生，而万物与我为一。说见后卷论道段'}
          />
          <Button size="sm" color="primary" variant="flat" isDisabled={!raw.trim()} onPress={() => { onMigrate(raw); setRaw(''); }}>
            迁移并归类
          </Button>
        </CardBody>
      </Card>

      <Card shadow="none" className="border border-dashed border-stone-300 bg-stone-50/70">
        <CardBody className="gap-2 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <Inbox className="h-4 w-4 text-stone-600" /> 待认领处
            <Chip size="sm" variant="flat" className="ml-auto">{computed.unclaimed.length}</Chip>
          </div>
          {computed.unclaimed.length ? (
            <div className="space-y-2">
              {computed.unclaimed.map((fragment) => (
                <ClaimRow key={fragment.id} fragment={fragment} series={computed.series} realVolumeIds={realVolumes.map((v) => v.id)} computed={computed} onClaim={onClaim} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-stone-500">待认领处为空。</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ClaimRow({
  fragment,
  series,
  realVolumeIds,
  computed,
  onClaim
}: {
  fragment: SeriesDocument['unclaimed'][number];
  series: SeriesDocument;
  realVolumeIds: string[];
  computed: ComputedSeries;
  onClaim: (fragmentId: string, volumeId: string, chapterId: string | null) => void;
}) {
  const [volumeId, setVolumeId] = useState(realVolumeIds[0] ?? '');
  const volumeChapters = useMemo(
    () => series.chapters.filter((chapter) => chapter.volumeId === volumeId),
    [series.chapters, volumeId]
  );
  const [chapterId, setChapterId] = useState<string>('__new__');

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-2">
      <p className="font-serif text-sm leading-6 text-stone-800">{fragment.raw}</p>
      <p className="mt-1 text-[11px] text-stone-500">{fragment.chapterHint}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Select
          size="sm"
          aria-label="认领卷"
          selectedKeys={new Set([volumeId])}
          onSelectionChange={(keys) => setVolumeId(String(Array.from(keys)[0]))}
        >
          {computed.volumes.filter((v) => !v.unclaimed).map((volume) => (
            <SelectItem key={volume.id}>{`卷${volume.number} · ${volume.title}`}</SelectItem>
          ))}
        </Select>
        <Select
          size="sm"
          aria-label="认领章"
          selectedKeys={new Set([chapterId])}
          onSelectionChange={(keys) => setChapterId(String(Array.from(keys)[0]))}
        >
          {[
            <SelectItem key="__new__" textValue="新建章">新建章</SelectItem>,
            ...volumeChapters.map((chapter) => (
              <SelectItem key={chapter.id} textValue={chapter.title}>{chapter.title}</SelectItem>
            ))
          ]}
        </Select>
      </div>
      <Button
        size="sm"
        color="primary"
        variant="flat"
        className="mt-2"
        onPress={() => onClaim(fragment.id, volumeId, chapterId === '__new__' ? null : chapterId)}
      >
        认领入卷
      </Button>
    </div>
  );
}
