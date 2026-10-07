// 丛书分卷整理的领域模型。
// 关键约定：互见不是照抄的文字，而是一条“指路关系”——
// 用稳定 ID 记住起点句与目标句，人读的卷/章/句地址一律在重算阶段生成。

export type ViewMode = 'reading' | 'editing' | 'critical';
export type NoteKind = 'footnote' | 'variant';

/** 互见核对结果：linked 可核对；dangling 指不到（留待办）；unclaimed 旧稿未记卷册（待认领） */
export type CrossRefStatus = 'linked' | 'dangling' | 'unclaimed';

export interface SeriesSentence {
  id: string;
  order: number;
  text: string;
}

export interface SeriesChapter {
  id: string;
  order: number;
  title: string;
  sentences: SeriesSentence[];
}

export interface Volume {
  id: string;
  order: number;
  title: string;
  /** 该卷的责任整理者 ID */
  editorId?: string;
  chapters: SeriesChapter[];
}

/** 脚注 / 异文，挂在稳定的句子 ID 上；编号在重算阶段给出 */
export interface Note {
  id: string;
  kind: NoteKind;
  sentenceId: string;
  title: string;
  body: string;
  source: string;
}

/**
 * 互见（指路关系）。
 * anchorSentenceId：互见所在句；target*：指向的卷/章/句（稳定 ID）。
 * 没记卷册（targetVolumeId 缺失）的迁移件不进正文，先入 unclaimed 待认领。
 */
export interface CrossRef {
  id: string;
  anchorSentenceId: string;
  label: string;
  targetVolumeId?: string;
  targetChapterId?: string;
  targetSentenceId?: string;
  editorId?: string;
  updatedAt: string;
}

/** 旧稿迁移：无法自动定位的互见/注，归入待认领处 */
export interface UnclaimedItem {
  id: string;
  kind: 'crossref' | 'note';
  /** 原稿照抄文字 */
  label: string;
  /** 原稿里写到的目标引句（若有） */
  quote?: string;
  /** 原稿里写到但对不上的卷名 */
  volumeHint?: string;
  /** 原始整行，供重试/人工核对 */
  raw: string;
  migratedAt: string;
}

export interface SeriesDocument {
  revision: number;
  title: string;
  volumes: Volume[];
  crossrefs: CrossRef[];
  notes: Note[];
  unclaimed: UnclaimedItem[];
  updatedAt: string;
}

// ---- 重算产物（阅读/校勘/检索/导出都只认这里） ----

export interface OrderedChapter extends SeriesChapter {
  sentences: SeriesSentence[];
}

export interface OrderedVolume extends Volume {
  chapters: OrderedChapter[];
}

export interface SentenceLocation {
  volume: Volume;
  chapter: SeriesChapter;
  sentence: SeriesSentence;
  volumeIndex: number;
  chapterIndex: number;
  sentenceIndex: number;
}

export interface ResolvedCrossRef extends CrossRef {
  status: CrossRefStatus;
  /** 起点地址，如《内篇》·逍遥游·第 1 句 */
  anchorAddress: string;
  anchorExcerpt: string;
  /** 目标地址；dangling 时给出最后线索 */
  targetAddress: string;
  targetExcerpt: string;
  /** 不能核对的原因 */
  reason?: string;
}

export interface ResolvedNote extends Note {
  status: 'linked' | 'dangling';
  /** 章内脚注序号；异文或悬空时为 null */
  number: number | null;
  address: string;
  excerpt: string;
}

export interface TodoItem {
  id: string;
  kind: 'dangling-crossref' | 'dangling-note' | 'unclaimed';
  title: string;
  detail: string;
  sentenceId?: string;
  unclaimedId?: string;
}

export interface SearchHit {
  volumeId: string;
  chapterId: string;
  sentenceId?: string;
  title: string;
  excerpt: string;
  address: string;
  matchKind: '正文' | '脚注' | '异文' | '互见' | '待认领';
}

export interface SeriesIndex {
  revision: number;
  volumes: OrderedVolume[];
  locations: Map<string, SentenceLocation>;
  crossrefs: ResolvedCrossRef[];
  notes: ResolvedNote[];
  todos: TodoItem[];
}

// ---- 会校（多人分卷 + 写回） ----

export interface CrossRefMemento {
  label: string;
  targetVolumeId?: string;
  targetChapterId?: string;
  targetSentenceId?: string;
  /** true 表示该互见在此版本中被删除 */
  deleted?: boolean;
}

export interface NoteMemento {
  title: string;
  body: string;
  source: string;
  deleted?: boolean;
}

/** 同一处互见两边都动过，并排交总校裁定 */
export interface CrossConflict {
  id: string;
  crossrefId: string;
  reason: 'modified-both' | 'delete-vs-edit';
  status: 'open' | 'resolved';
  editorId: string;
  /** 起点地址快照 */
  anchorAddress: string;
  label: string;
  trunk: CrossRefMemento | null;
  trunkExcerpt: string;
  theirs: CrossRefMemento | null;
  theirsExcerpt: string;
  base: CrossRefMemento | null;
  createdAt: string;
  decidedAt?: string;
}

export interface Editor {
  id: string;
  name: string;
}

export interface Branch {
  id: string;
  editorId: string;
  editorName: string;
  ownedVolumeIds: string[];
  /** 开分支时的底本（三方合并的 base），原样保留供“从原稿重试” */
  base: SeriesDocument;
  /** 整理者工作稿 */
  series: SeriesDocument;
  baseRevision: number;
  status: 'clean' | 'editing' | 'writeback-failed';
  lastError?: string;
  lastWriteAt?: string;
}

export interface WritebackReport {
  ok: boolean;
  appliedCrossrefs: number;
  appliedNotes: number;
  appliedStructure: boolean;
  conflictsRaised?: number;
  error?: string;
}

export interface PersistState {
  trunk: SeriesDocument;
  branches: Branch[];
  conflicts: CrossConflict[];
  /** 模拟接口：下一次写回是否失败 */
  forceFail: boolean;
  log: string[];
}

export type Scope = { kind: 'trunk' } | { kind: 'branch'; branchId: string };

export interface SeriesUiState {
  scope: Scope;
  role: string; // 'chief' 或 editor id
  mode: ViewMode;
  volumeId: string;
  chapterId: string;
  sentenceId: string;
  query: string;
  tab: string;
}
