'use client';

import { Button, Card, CardBody, Chip, Divider } from '@heroui/react';
import { ArrowLeftRight, Check, RotateCcw, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { detectCopyConflicts } from '@/lib/merge';
import type { ComputedSeries, PendingRefConflict, RefDecision, WorkingCopy } from '@/lib/types';

interface MergePanelProps {
  computed: ComputedSeries;
  copies: WorkingCopy[];
  onWriteBack: (copyId: string, decisions: RefDecision[]) => void;
  onRetry: (copyId: string, decisions: RefDecision[]) => void;
  onStage: (copyId: string, decisions: RefDecision[]) => void;
}

function ConflictRow({
  conflict,
  decision,
  onChoose
}: {
  conflict: PendingRefConflict;
  decision?: 'left' | 'right';
  onChoose: (choice: 'left' | 'right') => void;
}) {
  return (
    <Card shadow="none" className="border border-red-200">
      <CardBody className="gap-2 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          同一处互见两边都动过：{conflict.label}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ['left', '本卷稿（左）', conflict.left],
            ['right', '他卷稿（右）', conflict.right]
          ] as const).map(([side, title, ref]) => (
            <button
              key={side}
              type="button"
              className={`rounded-lg border p-2 text-left transition focus-ring ${
                decision === side ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-stone-200 bg-stone-50 hover:border-emerald-300'
              }`}
              onClick={() => onChoose(side)}
            >
              <div className="flex items-center justify-between">
                <b className="text-xs text-stone-700">{title}</b>
                {decision === side ? <Check className="h-4 w-4 text-emerald-600" /> : null}
              </div>
              <p className="mt-1 text-[11px] leading-5 text-stone-600">{ref.note || '（无按语）'}</p>
              <p className="mt-1 text-[11px] text-emerald-700">
                → {ref.target.sentenceId ? `句 ${ref.target.sentenceId}` : ref.target.sentenceHint}
              </p>
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

export function MergePanel({ computed, copies, onWriteBack, onRetry, onStage }: MergePanelProps) {
  const activeCopies = copies.filter((copy) => copy.status !== 'merged');
  const [decisionsByCopy, setDecisionsByCopy] = useState<Record<string, Record<string, 'left' | 'right'>>>({});

  const conflictsByCopy = useMemo(() => {
    const map = new Map<string, PendingRefConflict[]>();
    for (const copy of activeCopies) {
      const others = activeCopies.filter((item) => item.id !== copy.id);
      map.set(copy.id, detectCopyConflicts(computed.series, copy, others));
    }
    return map;
  }, [computed.series, activeCopies]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-stone-100 p-3 text-xs leading-5 text-stone-600">
        几位整理者同时编辑不同卷册。写回时若<strong>同一处互见两边都动过</strong>，在此并排摆出，由总校择定一侧再写回；
        未拍板的互见不会覆盖底本。写回失败可<strong>从原稿重试</strong>。句序、章序改动按稳定句子 ID 应用，随后互见与脚注编号整体重算。
      </div>

      {activeCopies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">
          暂无可写回的工作副本。整理者可在各自卷册上另开工作稿。
        </p>
      ) : null}

      {activeCopies.map((copy) => {
        const conflicts = conflictsByCopy.get(copy.id) ?? [];
        const chosen = decisionsByCopy[copy.id] ?? {};
        const decisions: RefDecision[] = Object.entries(chosen).map(([refId, choice]) => ({ refId, choice }));
        const unresolved = conflicts.filter((conflict) => !chosen[conflict.refId]).length;
        return (
          <Card key={copy.id} shadow="none" className="border border-stone-200">
            <CardBody className="gap-3 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <b className="text-sm text-stone-900">{copy.label}</b>
                  <p className="text-[11px] text-stone-500">
                    {copy.editor} · 基于 {copy.baseSnapshotId}
                  </p>
                </div>
                {copy.status === 'failed' ? (
                  <Chip size="sm" color="danger" variant="flat">写回失败</Chip>
                ) : (
                  <Chip size="sm" color="warning" variant="flat">待写回</Chip>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-[11px] text-stone-500">
                <Chip size="sm" variant="flat">{copy.chapters.length} 章工作稿</Chip>
                <Chip size="sm" variant="flat">{copy.crossRefs.length} 条互见改动</Chip>
                <Chip size="sm" variant="flat" color={conflicts.length ? 'danger' : 'default'}>
                  {conflicts.length ? `${conflicts.length} 处两边同改` : '无互见冲突'}
                </Chip>
              </div>

              {conflicts.length ? (
                <>
                  <Divider />
                  <div className="space-y-2">
                    {conflicts.map((conflict) => (
                      <ConflictRow
                        key={conflict.refId}
                        conflict={conflict}
                        decision={chosen[conflict.refId]}
                        onChoose={(choice) =>
                          setDecisionsByCopy((prev) => ({
                            ...prev,
                            [copy.id]: { ...(prev[copy.id] ?? {}), [conflict.refId]: choice }
                          }))
                        }
                      />
                    ))}
                  </div>
                </>
              ) : null}

              {copy.lastError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{copy.lastError}</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  startContent={<ArrowLeftRight className="h-4 w-4" />}
                  isDisabled={unresolved > 0}
                  onPress={() => onWriteBack(copy.id, decisions)}
                >
                  {unresolved ? `还有 ${unresolved} 处待总校拍板` : '写回底本'}
                </Button>
                {copy.status === 'failed' ? (
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    startContent={<RotateCcw className="h-4 w-4" />}
                    isDisabled={unresolved > 0}
                    onPress={() => onRetry(copy.id, decisions)}
                  >
                    从原稿重试写回
                  </Button>
                ) : null}
                <Button size="sm" variant="light" onPress={() => onStage(copy.id, decisions)}>
                  暂存决定
                </Button>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
