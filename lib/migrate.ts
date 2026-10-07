import type { Chapter, CrossRef, SeriesDocument, UnclaimedFragment, Volume } from './types';
import { tokenizeText } from './data';

let migrationSequence = 0;

function newId(prefix: string) {
  migrationSequence += 1;
  return `${prefix}-mig-${Date.now().toString(36)}-${migrationSequence}`;
}

/** 识别“卷一 / 卷二 / 第×卷”等卷次字面 */
function parseVolumeHint(line: string, series: SeriesDocument): { volume?: Volume; rest: string } {
  const match = line.match(/^\s*(?:第?\s*([一二三四五六七八九十\d]+)\s*卷|卷\s*([一二三四五六七八九十\d]+))[·\s:：、]?(.*)$/);
  if (!match) return { rest: line };
  const num = match[1] ?? match[2];
  const volume = series.volumes.find(
    (item) => item.number === num || item.order === Number(num)
  );
  return { volume, rest: (match[3] ?? '').trim() };
}

function findChapterByTitle(hint: string, series: SeriesDocument): Chapter | undefined {
  const clean = hint.replace(/[《》\s]/g, '');
  return series.chapters.find((chapter) => clean.includes(chapter.title));
}

/** 从一段旧稿文字中抽取“见/参见/互见/说见 ……”之类的互见照抄语 */
function extractRefHint(line: string): string | undefined {
  const match = line.match(/(?:互见|参见|详见|见|说见)\s*[《]?([^，。；;）)]+)[》]?/);
  return match?.[1]?.trim();
}

export interface MigrationResult {
  adoptedSentences: number;
  unclaimed: number;
  crossRefs: number;
}

/**
 * 迁移旧稿：
 * - 行首写有卷次的，归入对应卷册；
 * - 能对上章题的挂到该章末，对不上的整段进入“待认领卷册”；
 * - 没有记卷册的一律归到待认领处；
 * - 照抄式互见语转为指路关系；指不到目标留成待办。
 */
export function migrateLegacyText(series: SeriesDocument, raw: string): MigrationResult {
  const blocks = raw
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  let adoptedSentences = 0;
  let unclaimedCount = 0;
  let crossRefs = 0;

  const unclaimedVolume = series.volumes.find((volume) => volume.unclaimed);

  for (const block of blocks) {
    const { volume, rest } = parseVolumeHint(block, series);
    const text = rest || block;
    const chapterHintMatch = text.match(/^[《]?([^》》:：]+)[》]?[：:]\s*(.+)$/);
    const chapterHint = chapterHintMatch?.[1]?.trim() ?? '';
    const body = (chapterHintMatch?.[2] ?? text).trim();

    const matchedChapter = volume ? findChapterByTitle(chapterHint, series) ?? series.chapters.find((c) => c.volumeId === volume.id) : undefined;

    const refHint = extractRefHint(block);

    if (volume && matchedChapter) {
      const sentenceId = newId('s');
      matchedChapter.sentences.push({
        id: sentenceId,
        order: matchedChapter.sentences.length + 1,
        text: body,
        tokens: tokenizeText(body, sentenceId)
      });
      adoptedSentences += 1;
      if (refHint) {
        const targetChapter = findChapterByTitle(refHint, series);
        series.crossRefs.push({
          id: newId('ref'),
          label: `旧稿互见 · ${refHint.slice(0, 8)}`,
          note: `由旧稿迁移：${block.slice(0, 40)}`,
          source: '旧稿迁移',
          originAnchorId: sentenceId,
          originAnchorType: 'sentence',
          target: targetChapter
            ? { volumeId: targetChapter.volumeId, chapterId: targetChapter.id, sentenceHint: refHint }
            : { volumeHint: refHint, sentenceHint: refHint },
          targetQuote: refHint,
          status: targetChapter ? 'todo' : 'todo',
          todoReason: targetChapter ? 'missing-sentence' : 'unclaimed-volume',
          updatedAt: new Date().toISOString()
        });
        crossRefs += 1;
      }
    } else {
      // 未记卷册 / 对不上章 → 待认领处
      if (unclaimedVolume) {
        const fragment: UnclaimedFragment = {
          id: newId('unclaimed'),
          raw: block,
          chapterHint: chapterHint || (volume ? '章题未对上' : '旧稿未记卷册'),
          migratedAt: new Date().toISOString()
        };
        series.unclaimed.push(fragment);
        unclaimedCount += 1;
        if (refHint) {
          series.crossRefs.push({
            id: newId('ref'),
            label: `待认领互见 · ${refHint.slice(0, 8)}`,
            note: `由待认领旧稿迁移：${block.slice(0, 40)}`,
            source: '旧稿迁移',
            originAnchorId: fragment.id,
            originAnchorType: 'sentence',
            target: { sentenceHint: refHint },
            targetQuote: refHint,
            status: 'todo',
            todoReason: 'unclaimed-volume',
            updatedAt: new Date().toISOString()
          });
          crossRefs += 1;
        }
      }
    }
  }

  series.updatedAt = new Date().toISOString();
  return { adoptedSentences, unclaimed: unclaimedCount, crossRefs };
}

/** 总校把待认领片段认领进具体卷/章 */
export function claimFragment(
  series: SeriesDocument,
  fragmentId: string,
  volumeId: string,
  chapterId: string | null
): boolean {
  const fragmentIndex = series.unclaimed.findIndex((item) => item.id === fragmentId);
  if (fragmentIndex < 0) return false;
  const fragment = series.unclaimed[fragmentIndex];

  let targetChapter = chapterId
    ? series.chapters.find((chapter) => chapter.id === chapterId)
    : series.chapters.find((chapter) => chapter.volumeId === volumeId);
  if (!targetChapter) {
    targetChapter = {
      id: newId('chapter'),
      volumeId,
      order: series.chapters.filter((chapter) => chapter.volumeId === volumeId).length + 1,
      title: fragment.chapterHint || '新辑章',
      summary: '由待认领旧稿认领',
      sentences: []
    };
    series.chapters.push(targetChapter);
  }

  // 若片段正文内含“正文 + 互见语”，只取正文部分入章
  const body = fragment.raw.replace(/(?:互见|参见|详见|见|说见)\s*[《]?[^，。；;）)]+[》]?.*$/, '').trim() || fragment.raw;
  const sentenceId = newId('s');
  targetChapter.sentences.push({
    id: sentenceId,
    order: targetChapter.sentences.length + 1,
    text: body,
    tokens: tokenizeText(body, sentenceId)
  });

  series.unclaimed.splice(fragmentIndex, 1);
  series.updatedAt = new Date().toISOString();
  return true;
}
