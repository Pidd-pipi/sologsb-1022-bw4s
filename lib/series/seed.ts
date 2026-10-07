import type {
  CrossRef,
  Editor,
  Note,
  PersistState,
  SeriesDocument,
  SeriesSentence,
  Volume
} from './types';
import { migrateLegacy } from './migration';

const FIXED_TIME = '2026-10-06T01:00:00.000Z';

export const editors: Editor[] = [
  { id: 'editor-zhao', name: '赵校理（内篇）' },
  { id: 'editor-qian', name: '钱校理（外篇）' },
  { id: 'editor-sun', name: '孙校理（杂篇）' }
];

let counter = 0;
function s(id: string, order: number, text: string): SeriesSentence {
  counter += 1;
  return { id, order, text };
}

function vol(id: string, order: number, title: string, editorId: string, chapters: Volume['chapters']): Volume {
  return { id, order, title, editorId, chapters };
}

const volumes: Volume[] = [
  vol('vol-inner', 1, '庄子·内篇', 'editor-zhao', [
    {
      id: 'ch-xiaoyao',
      order: 1,
      title: '逍遥游',
      sentences: [
        s('s-xy-1', 1, '北冥有鱼，其名为鲲。'),
        s('s-xy-2', 2, '鲲之大，不知其几千里也。'),
        s('s-xy-3', 3, '化而为鸟，其名为鹏。'),
        s('s-xy-4', 4, '鹏之背，不知其几千里也；怒而飞，其翼若垂天之云。'),
        s('s-xy-5', 5, '是鸟也，海运则将徙于南冥。'),
        s('s-xy-6', 6, '南冥者，天池也。')
      ]
    },
    {
      id: 'ch-qiwu',
      order: 2,
      title: '齐物论',
      sentences: [
        s('s-qw-1', 1, '夫言非吹也，言者有言。'),
        s('s-qw-2', 2, '其所言者特未定也。'),
        s('s-qw-3', 3, '果有言邪？其未尝有言邪？'),
        s('s-qw-4', 4, '其以为异于鷇音，亦有辩乎？'),
        s('s-qw-5', 5, '其无辩乎？道恶乎隐而有真伪？')
      ]
    }
  ]),
  vol('vol-outer', 2, '庄子·外篇', 'editor-qian', [
    {
      id: 'ch-qiushui',
      order: 1,
      title: '秋水',
      sentences: [
        s('s-qs-1', 1, '秋水时至，百川灌河。'),
        s('s-qs-2', 2, '泾流之大，两涘渚崖之间，不辩牛马。'),
        s('s-qs-3', 3, '于是焉河伯欣然自喜，以天下之美为尽在己。'),
        s('s-qs-4', 4, '顺流而东行，至于北海，东面而视，不见水端。'),
        s('s-qs-5', 5, '于是焉河伯始旋其面目，望洋向若而叹。')
      ]
    },
    {
      id: 'ch-zaiyou',
      order: 2,
      title: '在宥',
      sentences: [
        s('s-zy-1', 1, '闻在宥天下，不闻治天下也。'),
        s('s-zy-2', 2, '在之也者，恐天下之淫其性也。')
      ]
    }
  ]),
  vol('vol-misc', 3, '庄子·杂篇', 'editor-sun', [
    {
      id: 'ch-gengsang',
      order: 1,
      title: '庚桑楚',
      sentences: [
        s('s-gs-1', 1, '老聃之役有庚桑楚者，偏得老聃之道。'),
        s('s-gs-2', 2, '以北居畏垒之山。')
      ]
    },
    {
      id: 'ch-tianxia',
      order: 2,
      title: '天下',
      sentences: [
        s('s-tx-1', 1, '天下之治方术者多矣，皆以其有为不可加矣。'),
        s('s-tx-2', 2, '古之所谓道术者，果恶乎在？'),
        s('s-tx-3', 3, '曰：无乎不在。')
      ]
    }
  ])
];

const seedNotes: Note[] = [
  { id: 'n-1', kind: 'footnote', sentenceId: 's-xy-1', title: '北冥', body: '冥，一作溟。北方荒远幽深之地，不必拘定为具体海域。', source: '郭庆藩本' },
  { id: 'n-2', kind: 'variant', sentenceId: 's-xy-3', title: '鹏字异文', body: '《世德堂》本作“凤”，敦煌残卷或作“朋”，据上下文多用“鹏”。', source: '校勘组' },
  { id: 'n-3', kind: 'footnote', sentenceId: 's-qw-4', title: '鷇音', body: '雏鸟待哺之声。旧注或释为鸟鸣，义可并存。', source: '成玄英疏' },
  { id: 'n-4', kind: 'variant', sentenceId: 's-qs-2', title: '辩 / 辨', body: '取“分别”义时“辨”更显，底本保留“辩”。', source: '底本保留' },
  { id: 'n-5', kind: 'footnote', sentenceId: 's-qs-5', title: '望洋', body: '仰视貌；或作“望阳”“盳洋”，皆连绵词。', source: '集释' },
  { id: 'n-6', kind: 'footnote', sentenceId: 's-tx-2', title: '道术', body: '统摄百家之学的总体之称，与“方术”对举。', source: '讲义稿' }
];

const seedCrossrefs: CrossRef[] = [
  {
    id: 'x-1',
    anchorSentenceId: 's-xy-1',
    label: '北冥南冥对举',
    targetVolumeId: 'vol-inner',
    targetChapterId: 'ch-xiaoyao',
    targetSentenceId: 's-xy-6',
    editorId: 'editor-zhao',
    updatedAt: FIXED_TIME
  },
  {
    id: 'x-2',
    anchorSentenceId: 's-xy-5',
    label: '海运徙南冥',
    targetVolumeId: 'vol-inner',
    targetChapterId: 'ch-xiaoyao',
    targetSentenceId: 's-xy-6',
    editorId: 'editor-zhao',
    updatedAt: FIXED_TIME
  },
  {
    id: 'x-3',
    anchorSentenceId: 's-qs-3',
    label: '河伯自喜与成心对读',
    targetVolumeId: 'vol-inner',
    targetChapterId: 'ch-qiwu',
    targetSentenceId: 's-qw-2',
    editorId: 'editor-qian',
    updatedAt: FIXED_TIME
  },
  {
    id: 'x-4',
    anchorSentenceId: 's-tx-2',
    label: '道术无乎不在，参北冥',
    targetVolumeId: 'vol-inner',
    targetChapterId: 'ch-xiaoyao',
    targetSentenceId: 's-xy-1',
    editorId: 'editor-sun',
    updatedAt: FIXED_TIME
  },
  {
    // 刻意指向一个当前不存在的句 ID：模拟句子挪走/删除后指空
    id: 'x-dangling',
    anchorSentenceId: 's-gs-2',
    label: '畏垒与南冥（旧注互见）',
    targetVolumeId: 'vol-inner',
    targetChapterId: 'ch-xiaoyao',
    targetSentenceId: 's-old-gone',
    editorId: 'editor-sun',
    updatedAt: FIXED_TIME
  }
];

function buildBaseDocument(): SeriesDocument {
  const doc: SeriesDocument = {
    revision: 1,
    title: '《庄子》三卷整理本',
    volumes: structuredClone(volumes),
    crossrefs: structuredClone(seedCrossrefs),
    notes: structuredClone(seedNotes),
    unclaimed: [],
    updatedAt: FIXED_TIME
  };

  // 旧稿迁移演示：
  //  - 前两条引句在现稿中唯一，可直接转指路；
  //  - 第三条没记卷册、引句含糊（“北冥有鱼”之类照抄），入待认领；
  //  - 第四条引句在两处出现（“辩”），不唯一，也入待认领。
  const migration = migrateLegacy(
    doc,
    [
      {
        from: '闻在宥天下',
        quote: '泾流之大，两涘渚崖之间',
        volume: '外篇',
        label: '在宥之不治，参秋水',
        raw: '互见：闻在宥天下 ↔ 泾流之大两涘渚崖之间（外篇·秋水）'
      },
      {
        from: '天下之治方术者多矣',
        quote: '无乎不在',
        volume: '杂篇·天下',
        label: '旧稿：方术归宗',
        raw: '互见：天下之治方术者 → 无乎不在（天下）'
      },
      {
        quote: '南冥者天池',
        // 没记卷册
        label: '旧抄本残签：南冥',
        raw: '残签：南冥者天池也，互见前注（卷次阙）'
      },
      {
        quote: '辩',
        volume: '内篇',
        label: '旧稿“辩”字互见（引句重出）',
        raw: '互见：辩（鷇音）↔ 辩（不辩牛马），卷次未明'
      }
    ],
    [
      {
        quote: '以北居畏垒之山',
        kind: 'footnote',
        title: '畏垒',
        body: '山名，或云在鲁；寓言所托，不必实指。',
        source: '旧稿朱笔',
        raw: '脚注：以北居畏垒之山——山名（旧稿朱笔）'
      },
      {
        quote: '今者吾丧我',
        kind: 'variant',
        title: '丧我（引句缺）',
        body: '此句不在现稿，待找到所属卷章。',
        source: '旧稿夹签',
        raw: '异文：今者吾丧我（夹签，无卷次）'
      }
    ],
    'legacy-import'
  );

  doc.crossrefs.push(...migration.crossrefs);
  doc.notes.push(...migration.notes);
  doc.unclaimed.push(...migration.unclaimed);
  return doc;
}

export function createInitialPersist(): PersistState {
  const trunk = buildBaseDocument();
  return {
    trunk,
    branches: [],
    conflicts: [],
    forceFail: false,
    log: ['已载入《庄子》三卷整理底本，并迁移旧稿互见与夹签']
  };
}
