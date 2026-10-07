'use client';

import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Select,
  SelectItem,
  Textarea
} from '@heroui/react';
import { Link2, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { annotationKindLabels } from '@/lib/data';
import { getTargetLabel, kindLabel } from '@/lib/editor';
import type {
  Annotation,
  AnnotationKind,
  AnchorType,
  ComputedSeries,
  CrossRef
} from '@/lib/types';

export const kindColors: Record<AnnotationKind, 'primary' | 'warning' | 'secondary'> = {
  footnote: 'primary',
  variant: 'warning',
  background: 'secondary'
};

interface AnnotationFormProps {
  anchorId: string;
  anchorType: AnchorType;
  anchorPreview: string;
  onSubmit: (values: Omit<Annotation, 'id' | 'status' | 'conflictState' | 'updatedAt'>) => void;
}

export function AnnotationForm({ anchorId, anchorType, anchorPreview, onSubmit }: AnnotationFormProps) {
  const [kind, setKind] = useState<AnnotationKind>('footnote');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('整理者');
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');

  function submit() {
    if (!title.trim() || !body.trim()) {
      setError('请填写标题和注释正文。');
      return;
    }
    onSubmit({
      anchorId,
      anchorType,
      kind,
      title: title.trim(),
      body: body.trim(),
      source: source.trim() || '未署名',
      references: [],
      tags: tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
    });
    setTitle('');
    setBody('');
    setTags('');
    setError('');
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">
        当前目标：<span className="font-semibold text-stone-800">{anchorPreview}</span>
      </div>
      <Select
        aria-label="注释类型"
        label="注释类型"
        selectedKeys={new Set([kind])}
        onSelectionChange={(keys) => setKind(Array.from(keys)[0] as AnnotationKind)}
      >
        {Object.entries(annotationKindLabels).map(([value, label]) => (
          <SelectItem key={value}>{label}</SelectItem>
        ))}
      </Select>
      <Input label="标题" value={title} onValueChange={setTitle} placeholder="例如：北冥释义" />
      <Textarea label="正文" value={body} onValueChange={setBody} minRows={3} placeholder="校勘依据、异文或背景说明" />
      <div className="grid grid-cols-2 gap-3">
        <Input label="来源" value={source} onValueChange={setSource} />
        <Input label="标签" value={tags} onValueChange={setTags} placeholder="地理, 异文" />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <Button color="primary" className="w-full" onPress={submit}>
        添加注释
      </Button>
    </div>
  );
}

interface CrossRefFormProps {
  computed: ComputedSeries;
  originId: string;
  originType: AnchorType;
  onSubmit: (values: Omit<CrossRef, 'id' | 'status' | 'updatedAt'>) => void;
}

/** 新建互见：选定目标 卷 → 章 → 句，写出可核对指针 */
export function CrossRefForm({ computed, originId, originType, onSubmit }: CrossRefFormProps) {
  const realVolumes = computed.volumes.filter((volume) => !volume.unclaimed);
  const [volumeId, setVolumeId] = useState(realVolumes[0]?.id ?? '');
  const volumeChapters = computed.chapters.filter((chapter) => chapter.volumeId === volumeId);
  const [chapterId, setChapterId] = useState(volumeChapters[0]?.id ?? '');
  const chapter = computed.chapters.find((item) => item.id === chapterId) ?? volumeChapters[0];
  const [sentenceId, setSentenceId] = useState(chapter?.sentences[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [source, setSource] = useState('整理者');

  useEffect(() => {
    const first = computed.chapters.find((item) => item.volumeId === volumeId);
    setChapterId(first?.id ?? '');
  }, [volumeId, computed]);

  useEffect(() => {
    setSentenceId(chapter?.sentences[0]?.id ?? '');
  }, [chapter?.id]);

  const targetSentence = chapter?.sentences.find((item) => item.id === sentenceId);

  function submit() {
    if (!chapter || !targetSentence) return;
    onSubmit({
      label: label.trim() || `互见 → ${chapter.title}`,
      note: note.trim(),
      source: source.trim() || '未署名',
      originAnchorId: originId,
      originAnchorType: originType,
      target: { volumeId, chapterId: chapter.id, sentenceId: targetSentence.id },
      targetQuote: targetSentence.text,
      todoReason: undefined
    });
    setLabel('');
    setNote('');
  }

  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
        <Link2 className="h-4 w-4" /> 新增互见指路
      </div>
      <Select size="sm" label="指向卷" selectedKeys={new Set([volumeId])} onSelectionChange={(keys) => setVolumeId(String(Array.from(keys)[0]))}>
        {realVolumes.map((volume) => (
          <SelectItem key={volume.id}>{`卷${volume.number} · ${volume.title}`}</SelectItem>
        ))}
      </Select>
      <Select size="sm" label="指向章" selectedKeys={new Set([chapterId])} onSelectionChange={(keys) => setChapterId(String(Array.from(keys)[0]))}>
        {volumeChapters.map((item) => (
          <SelectItem key={item.id}>{item.title}</SelectItem>
        ))}
      </Select>
      <Select size="sm" label="指向句" selectedKeys={new Set([sentenceId])} onSelectionChange={(keys) => setSentenceId(String(Array.from(keys)[0]))}>
        {(chapter?.sentences ?? []).map((item) => (
          <SelectItem key={item.id}>{`第 ${item.order} 句 · ${item.text.slice(0, 12)}`}</SelectItem>
        ))}
      </Select>
      <Input size="sm" label="互见名称" value={label} onValueChange={setLabel} placeholder="如：南冥互见" />
      <Textarea size="sm" label="按语" value={note} onValueChange={setNote} minRows={2} placeholder="为什么互见、如何对读" />
      <Input size="sm" label="来源" value={source} onValueChange={setSource} />
      <Button size="sm" color="success" className="w-full" onPress={submit}>
        建立指路
      </Button>
    </div>
  );
}

interface AnnotationCardProps {
  annotation: Annotation;
  computed: ComputedSeries;
  selected: boolean;
  number?: number;
  onSelect: () => void;
  onUpdate: (patch: Partial<Annotation>) => void;
  onDelete: () => void;
}

export function AnnotationCard({ annotation, computed, selected, number, onSelect, onUpdate, onDelete }: AnnotationCardProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(annotation.title);
  const [body, setBody] = useState(annotation.body);
  const [source, setSource] = useState(annotation.source);

  useEffect(() => {
    setTitle(annotation.title);
    setBody(annotation.body);
    setSource(annotation.source);
  }, [annotation.id, annotation.title, annotation.body, annotation.source]);

  return (
    <Card shadow="none" className={`border ${selected ? 'border-amber-500 bg-amber-50/60' : 'border-stone-200 bg-white'}`}>
      <CardBody className="gap-2 p-3">
        <button type="button" className="w-full text-left focus-ring" onClick={onSelect}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                {number ? <Chip size="sm" color="primary" variant="solid">[{number}]</Chip> : null}
                <Chip size="sm" color={kindColors[annotation.kind]} variant="flat">{kindLabel(annotation.kind)}</Chip>
                {annotation.conflictState === 'open' ? <Chip size="sm" color="danger" variant="bordered">争议中</Chip> : null}
              </div>
              <h4 className="mt-2 font-semibold text-stone-900">{annotation.title}</h4>
            </div>
            <span className="whitespace-nowrap text-xs text-stone-500">{annotation.source}</span>
          </div>
          {!editing ? <p className="mt-2 text-sm leading-6 text-stone-700">{annotation.body}</p> : null}
        </button>
        {editing ? (
          <div className="space-y-2">
            <Input size="sm" label="标题" value={title} onValueChange={setTitle} />
            <Textarea size="sm" minRows={3} label="正文" value={body} onValueChange={setBody} />
            <Input size="sm" label="来源" value={source} onValueChange={setSource} />
            <div className="flex gap-2">
              <Button
                size="sm"
                color="primary"
                onPress={() => {
                  onUpdate({
                    title: title.trim() || annotation.title,
                    body: body.trim() || annotation.body,
                    source: source.trim() || annotation.source
                  });
                  setEditing(false);
                }}
              >
                保存修改
              </Button>
              <Button size="sm" variant="light" onPress={() => setEditing(false)}>取消</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span>{getTargetLabel(computed, annotation)}</span>
            <span className="ml-auto flex gap-1">
              <Button isIconOnly size="sm" variant="light" aria-label="编辑注释" onPress={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button isIconOnly size="sm" variant="light" color="danger" aria-label="删除注释" onPress={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
