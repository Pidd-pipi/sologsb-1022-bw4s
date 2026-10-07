'use client';

import { Select, SelectItem } from '@heroui/react';
import { useMemo } from 'react';
import type { SeriesIndex } from '@/lib/series/types';

export interface PickedTarget {
  volumeId: string;
  chapterId: string;
  sentenceId: string;
}

interface TargetPickerProps {
  index: SeriesIndex;
  value: PickedTarget;
  onChange: (target: PickedTarget) => void;
  /** 只允许在这些卷里选（如起点所在卷/其他整理者的卷限制）；不传为全书可选 */
  allowedVolumeIds?: string[];
  labels?: { volume?: string; chapter?: string; sentence?: string };
}

/** 互见目标选择器：只能选到“卷 → 章 → 句”的确定句，不接受照抄文字 */
export function TargetPicker({ index, value, onChange, allowedVolumeIds, labels }: TargetPickerProps) {
  const volumes = useMemo(
    () => (allowedVolumeIds ? index.volumes.filter((v) => allowedVolumeIds.includes(v.id)) : index.volumes),
    [index.volumes, allowedVolumeIds]
  );

  // 值若被过滤掉（例如挪章后），回退到第一个可选项，避免出现“选了不存在的卷”
  const volumeId = volumes.some((v) => v.id === value.volumeId)
    ? value.volumeId
    : volumes[0]?.id ?? '';
  const volume = volumes.find((v) => v.id === volumeId);
  const chapterId = volume?.chapters.some((c) => c.id === value.chapterId)
    ? value.chapterId
    : volume?.chapters[0]?.id ?? '';
  const chapter = volume?.chapters.find((c) => c.id === chapterId);
  const sentenceId = chapter?.sentences.some((s) => s.id === value.sentenceId)
    ? value.sentenceId
    : chapter?.sentences[0]?.id ?? '';

  return (
    <div className="space-y-2">
      <Select
        size="sm"
        aria-label={labels?.volume ?? '目标卷'}
        label={labels?.volume ?? '目标卷'}
        selectedKeys={volumeId ? new Set([volumeId]) : new Set()}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          const nextVolumeId = String(Array.from(keys)[0] ?? '');
          const nextVolume = volumes.find((v) => v.id === nextVolumeId);
          const nextChapter = nextVolume?.chapters[0];
          const nextSentence = nextChapter?.sentences[0];
          onChange({ volumeId: nextVolumeId, chapterId: nextChapter?.id ?? '', sentenceId: nextSentence?.id ?? '' });
        }}
      >
        {volumes.map((v) => (
          <SelectItem key={v.id}>{v.title}</SelectItem>
        ))}
      </Select>
      <Select
        size="sm"
        aria-label={labels?.chapter ?? '目标章'}
        label={labels?.chapter ?? '目标章'}
        selectedKeys={chapterId ? new Set([chapterId]) : new Set()}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          const nextChapterId = String(Array.from(keys)[0] ?? '');
          const nextChapter = volume?.chapters.find((c) => c.id === nextChapterId);
          onChange({ volumeId, chapterId: nextChapterId, sentenceId: nextChapter?.sentences[0]?.id ?? '' });
        }}
      >
        {(volume?.chapters ?? []).map((c) => (
          <SelectItem key={c.id}>{c.title}</SelectItem>
        ))}
      </Select>
      <Select
        size="sm"
        aria-label={labels?.sentence ?? '目标句'}
        label={labels?.sentence ?? '目标句'}
        selectedKeys={sentenceId ? new Set([sentenceId]) : new Set()}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          const nextSentenceId = String(Array.from(keys)[0] ?? '');
          onChange({ volumeId, chapterId, sentenceId: nextSentenceId });
        }}
      >
        {(chapter?.sentences ?? []).map((s, i) => (
          <SelectItem key={s.id} textValue={`第 ${i + 1} 句 · ${s.text}`}>
            <span className="text-xs">
              第 {i + 1} 句 · {s.text.length > 18 ? `${s.text.slice(0, 18)}…` : s.text}
            </span>
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}
