import type {
  AnchorType,
  Annotation,
  AnnotationKind,
  CrossRef,
  Chapter,
  Sentence,
  SeriesDocument,
  TextToken,
  UnclaimedFragment,
  VersionSnapshot,
  Volume,
  WorkingCopy
} from './types';

const FIXED_TIME = '2026-10-02T02:00:00.000Z';
let tokenSequence = 0;

function canUseSegmenter() {
  return typeof Intl !== 'undefined' && 'Segmenter' in Intl;
}

export function tokenizeText(text: string, sentenceId: string, existing: TextToken[] = []): TextToken[] {
  let parts: string[] = [];
  if (canUseSegmenter()) {
    const Segmenter = (Intl as typeof Intl & {
      Segmenter: new (locale: string, options: { granularity: string }) => {
        segment: (value: string) => Iterable<{ segment: string }>;
      };
    }).Segmenter;
    parts = Array.from(new Segmenter('zh-CN', { granularity: 'word' }).segment(text), (item) => item.segment);
  } else {
    parts = text.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+|\s+|[^\s]/gu) ?? [text];
  }

  const used = new Set<number>();
  return parts.map((part, index) => {
    const matchedIndex = existing.findIndex(
      (token, tokenIndex) => !used.has(tokenIndex) && token.text === part
    );
    if (matchedIndex >= 0) {
      used.add(matchedIndex);
      return existing[matchedIndex];
    }
    tokenSequence += 1;
    return {
      id: `${sentenceId}-token-${index}-${tokenSequence.toString(36)}`,
      text: part
    };
  });
}

function sentence(id: string, order: number, text: string): Sentence {
  return { id, order, text, tokens: tokenizeText(text, id) };
}

export const volumes: Volume[] = [
  { id: 'volume-1', order: 1, title: '内篇', number: '一' },
  { id: 'volume-2', order: 2, title: '内篇', number: '二' },
  { id: 'volume-3', order: 3, title: '杂篇', number: '三' },
  { id: 'volume-unclaimed', order: 99, title: '待认领卷册', number: null, unclaimed: true }
];

const chapters: Chapter[] = [
  {
    id: 'chapter-xiaoyao',
    volumeId: 'volume-1',
    order: 1,
    title: '逍遥游',
    summary: '大与小、有待与无待的层层对照。',
    sentences: [
      sentence('s-xyy-1', 1, '北冥有鱼，其名为鲲。'),
      sentence('s-xyy-2', 2, '鲲之大，不知其几千里也。'),
      sentence('s-xyy-3', 3, '化而为鸟，其名为鹏。'),
      sentence('s-xyy-4', 4, '鹏之背，不知其几千里也；怒而飞，其翼若垂天之云。'),
      sentence('s-xyy-5', 5, '是鸟也，海运则将徙于南冥。'),
      sentence('s-xyy-6', 6, '南冥者，天池也。')
    ]
  },
  {
    id: 'chapter-qiwulun',
    volumeId: 'volume-1',
    order: 2,
    title: '齐物论',
    summary: '齐是非、同彼我，讨论言语与成心的边界。',
    sentences: [
      sentence('s-qwl-1', 1, '夫言非吹也，言者有言。'),
      sentence('s-qwl-2', 2, '其所言者特未定也。'),
      sentence('s-qwl-3', 3, '果有言邪？其未尝有言邪？'),
      sentence('s-qwl-4', 4, '其以为异于鷇音，亦有辩乎？'),
      sentence('s-qwl-5', 5, '其无辩乎？道恶乎隐而有真伪？')
    ]
  },
  {
    id: 'chapter-qiushui',
    volumeId: 'volume-2',
    order: 1,
    title: '秋水',
    summary: '河伯与北海若的问答，展开大小、贵贱与时势之辨。',
    sentences: [
      sentence('s-qs-1', 1, '秋水时至，百川灌河。'),
      sentence('s-qs-2', 2, '泾流之大，两涘渚崖之间，不辩牛马。'),
      sentence('s-qs-3', 3, '于是焉河伯欣然自喜，以天下之美为尽在己。'),
      sentence('s-qs-4', 4, '顺流而东行，至于北海，东面而视，不见水端。'),
      sentence('s-qs-5', 5, '于是焉河伯始旋其面目，望洋向若而叹。')
    ]
  },
  {
    id: 'chapter-tianxia',
    volumeId: 'volume-3',
    order: 1,
    title: '天下',
    summary: '总论百家之学，评骘诸家源流得失。',
    sentences: [
      sentence('s-tx-1', 1, '天下之治方术者多矣，皆以其有为不可加矣。'),
      sentence('s-tx-2', 2, '古之所谓道术者，果恶乎在？'),
      sentence('s-tx-3', 3, '曰：无乎不在。')
    ]
  }
];

function findToken(sentenceId: string, includes: string) {
  const target = chapters
    .flatMap((chapter) => chapter.sentences)
    .find((item) => item.id === sentenceId);
  return target?.tokens.find((token) => token.text.includes(includes))?.id ?? sentenceId;
}

const pengToken = findToken('s-xyy-3', '鹏');
const bianToken = findToken('s-qs-2', '辩');
const beimingToken = findToken('s-xyy-1', '北冥');

const annotations: Annotation[] = [
  {
    id: 'annotation-1',
    anchorId: 's-xyy-1',
    anchorType: 'sentence',
    kind: 'footnote',
    title: '北冥',
    body: '冥，一作溟。指北方荒远、幽深之地，不必拘定为具体海域。',
    source: '郭庆藩本',
    references: [],
    status: 'open',
    tags: ['地理', '通假'],
    conflictState: 'open',
    updatedAt: FIXED_TIME
  },
  {
    id: 'annotation-2',
    anchorId: 's-xyy-1',
    anchorType: 'sentence',
    kind: 'footnote',
    title: '北冥（异说）',
    body: '“冥”可径释为海。北冥即北海，语意直截，不烦引申。',
    source: '王先谦本',
    references: [],
    status: 'open',
    tags: ['地理'],
    conflictState: 'open',
    updatedAt: FIXED_TIME
  },
  {
    id: 'annotation-3',
    anchorId: pengToken,
    anchorType: 'word',
    kind: 'variant',
    title: '鹏字异文',
    body: '《世德堂》本作“凤”，敦煌残卷或作“朋”。据上下文及早期类书，多用“鹏”。',
    source: '校勘组',
    references: [],
    status: 'open',
    tags: ['异文', '字形'],
    conflictState: 'open',
    updatedAt: FIXED_TIME
  },
  {
    id: 'annotation-4',
    anchorId: 's-qwl-3',
    anchorType: 'sentence',
    kind: 'background',
    title: '连续设问',
    body: '三句设问并非要求事实答案，而是动摇“言必有定指”的预设。',
    source: '讲义稿',
    references: [],
    status: 'open',
    tags: ['义理'],
    conflictState: 'open',
    updatedAt: FIXED_TIME
  },
  {
    id: 'annotation-5',
    anchorId: 's-qwl-4',
    anchorType: 'sentence',
    kind: 'variant',
    title: '鷇音',
    body: '鷇音指雏鸟待哺之声。旧注或释为鸟鸣，义可并存。',
    source: '成玄英疏',
    references: [],
    status: 'resolved',
    tags: ['异文', '训诂'],
    conflictState: 'open',
    updatedAt: FIXED_TIME
  },
  {
    id: 'annotation-6',
    anchorId: bianToken,
    anchorType: 'word',
    kind: 'variant',
    title: '辩 / 辨',
    body: '“不辩牛马”与《齐物论》“亦有辩乎”字形互见。取“分别”义时“辨”更显，底本保留“辩”。',
    source: '底本保留',
    references: [],
    status: 'open',
    tags: ['异体字'],
    conflictState: 'open',
    updatedAt: FIXED_TIME
  },
  {
    id: 'annotation-7',
    anchorId: beimingToken,
    anchorType: 'word',
    kind: 'background',
    title: '北冥的空间意象',
    body: '“北冥”与后文“南冥”构成空间对举，一北一南、一起一落。',
    source: '阅读笺注',
    references: [],
    status: 'open',
    tags: ['意象'],
    conflictState: 'open',
    updatedAt: FIXED_TIME
  }
];

const crossRefs: CrossRef[] = [
  {
    id: 'ref-1',
    label: '南冥互见',
    note: '“北冥”与“南冥”对举，此处点明南冥为天池。',
    source: '结构注',
    originAnchorId: 's-xyy-1',
    originAnchorType: 'sentence',
    target: { volumeId: 'volume-1', chapterId: 'chapter-xiaoyao', sentenceId: 's-xyy-6' },
    targetQuote: '南冥者，天池也。',
    status: 'resolved',
    updatedAt: FIXED_TIME
  },
  {
    id: 'ref-2',
    label: '辩字对读',
    note: '“不辩牛马”之“辩”，与《齐物论》问辩处可对读。',
    source: '专题校记',
    originAnchorId: bianToken,
    originAnchorType: 'word',
    target: { volumeId: 'volume-1', chapterId: 'chapter-qiwulun', sentenceId: 's-qwl-5' },
    targetQuote: '其无辩乎？道恶乎隐而有真伪？',
    status: 'resolved',
    updatedAt: FIXED_TIME
  },
  {
    id: 'ref-3',
    label: '成心之说',
    note: '“以天下之美为尽在己”可与《齐物论》所讥成心对读。',
    source: '专题校记',
    originAnchorId: 's-qs-3',
    originAnchorType: 'sentence',
    target: { volumeId: 'volume-1', chapterId: 'chapter-qiwulun', sentenceId: 's-qwl-3' },
    targetQuote: '果有言邪？其未尝有言邪？',
    status: 'resolved',
    updatedAt: FIXED_TIME
  },
  {
    // 指不到目标：句子 id 在重排/改稿后已不存在 → 待办
    id: 'ref-4',
    label: '旧辑佚互见（指不到）',
    note: '旧整理照抄“说见《天下》论道术段”，未绑定句子，章序调整后落空。',
    source: '旧辑本',
    originAnchorId: 's-tx-2',
    originAnchorType: 'sentence',
    target: {
      volumeId: 'volume-3',
      chapterId: 'chapter-tianxia',
      sentenceHint: '古之得道者……'
    },
    targetQuote: '古之得道者……',
    status: 'todo',
    todoReason: 'missing-sentence',
    updatedAt: FIXED_TIME
  }
];

const unclaimed: UnclaimedFragment[] = [
  {
    id: 'unclaimed-1',
    raw: '天地与我并生，而万物与我为一。',
    chapterHint: '疑属《齐物论》',
    migratedAt: FIXED_TIME
  }
];

const baseSnapshot: VersionSnapshot = {
  id: 'snapshot-base',
  label: '丛书整理底本 v1',
  note: '三卷《庄子》选注初始整理稿，含已核对互见与一处待办。',
  createdAt: FIXED_TIME,
  volumes: structuredClone(volumes),
  chapters: structuredClone(chapters),
  annotations: structuredClone(annotations),
  crossRefs: structuredClone(crossRefs)
};

// —— 两位整理者同时编辑不同卷册的工作副本（并发现成演示） ——

const copyAChapters = structuredClone(chapters.filter((chapter) => chapter.volumeId === 'volume-1'));
// 甲把《逍遥游》最后两句次序对调，制造“章节次序调过”的场景
const xyy = copyAChapters.find((chapter) => chapter.id === 'chapter-xiaoyao')!;
[xyy.sentences[4], xyy.sentences[5]] = [xyy.sentences[5], xyy.sentences[4]];
xyy.sentences.forEach((item, index) => {
  item.order = index + 1;
});

export const demoCopyA: WorkingCopy = {
  id: 'copy-a',
  label: '甲 · 卷一工作稿',
  volumeId: 'volume-1',
  editor: '整理者甲',
  role: 'editor-a',
  status: 'editing',
  baseSnapshotId: 'snapshot-base',
  chapters: copyAChapters,
  annotations: [],
  crossRefs: [
    {
      id: 'ref-1',
      label: '南冥互见',
      note: '【甲改】南冥既已随句序前移，互见语宜从开篇读起。',
      source: '结构注',
      originAnchorId: 's-xyy-1',
      originAnchorType: 'sentence',
      target: { volumeId: 'volume-1', chapterId: 'chapter-xiaoyao', sentenceId: 's-xyy-6' },
      targetQuote: '南冥者，天池也。',
      status: 'resolved',
      updatedAt: FIXED_TIME
    },
    {
      // 同一条互见，甲在卷一侧（目标侧）也动过 —— 与卷二乙稿构成两边同改
      id: 'ref-2',
      label: '辩字对读',
      note: '【甲改】问辩当直指《齐物论》“道恶乎隐”一句，语势更切。',
      source: '专题校记',
      originAnchorId: bianToken,
      originAnchorType: 'word',
      target: { volumeId: 'volume-1', chapterId: 'chapter-qiwulun', sentenceId: 's-qwl-5' },
      targetQuote: '其无辩乎？道恶乎隐而有真伪？',
      status: 'resolved',
      updatedAt: FIXED_TIME
    }
  ],
  pendingRefs: [],
  refDecisions: [],
  failNextWrite: false,
  updatedAt: FIXED_TIME
};

const copyBChapters = structuredClone(chapters.filter((chapter) => chapter.volumeId === 'volume-2'));

export const demoCopyB: WorkingCopy = {
  id: 'copy-b',
  label: '乙 · 卷二工作稿',
  volumeId: 'volume-2',
  editor: '整理者乙',
  role: 'editor-b',
  status: 'editing',
  baseSnapshotId: 'snapshot-base',
  chapters: copyBChapters,
  annotations: [],
  crossRefs: [
    {
      id: 'ref-3',
      label: '成心之说',
      note: '【乙改】河伯自满一段，与《齐物论》成心、《天下》方术两段皆当互见。',
      source: '专题校记',
      originAnchorId: 's-qs-3',
      originAnchorType: 'sentence',
      target: { volumeId: 'volume-3', chapterId: 'chapter-tianxia', sentenceId: 's-tx-1' },
      targetQuote: '天下之治方术者多矣，皆以其有为不可加矣。',
      status: 'resolved',
      updatedAt: FIXED_TIME
    },
    {
      // 同一条互见，乙在卷二侧（出处侧）也动过 —— 与卷一甲稿构成两边同改
      id: 'ref-2',
      label: '辩字对读',
      note: '【乙改】“不辩牛马”取辨别义，互见宜注出与“亦有辩乎”同义。',
      source: '专题校记',
      originAnchorId: bianToken,
      originAnchorType: 'word',
      target: { volumeId: 'volume-1', chapterId: 'chapter-qiwulun', sentenceId: 's-qwl-4' },
      targetQuote: '其以为异于鷇音，亦有辩乎？',
      status: 'resolved',
      updatedAt: FIXED_TIME
    }
  ],
  pendingRefs: [],
  refDecisions: [],
  failNextWrite: true, // 首次写回演示失败，可从原稿重试
  updatedAt: FIXED_TIME
};

export const initialSeries: SeriesDocument = {
  id: 'zhuangzi-series',
  title: '《庄子》选注丛书',
  edition: '整理底本',
  volumes,
  chapters,
  annotations,
  crossRefs,
  unclaimed,
  workingCopies: [demoCopyA, demoCopyB],
  snapshots: [baseSnapshot],
  updatedAt: FIXED_TIME
};

export const annotationKindLabels: Record<AnnotationKind, string> = {
  footnote: '脚注',
  variant: '异文',
  background: '背景说明'
};

export const anchorTypeLabels: Record<AnchorType, string> = {
  chapter: '章节',
  sentence: '句子',
  word: '词语'
};
