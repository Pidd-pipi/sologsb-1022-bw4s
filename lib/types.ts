export type ViewMode = 'reading' | 'editing' | 'critical';
export type AnchorType = 'chapter' | 'sentence' | 'word';
export type AnnotationKind = 'footnote' | 'variant' | 'background';
export type AnnotationStatus = 'open' | 'resolved';

export type RefStatus =
  | 'resolved' // 指针可核对：能定位到卷/章/句
  | 'quotedrift' // 能定位，但目标引文与现状不一致（句子被改写）
  | 'todo'; // 指不到目标，留作待办

export type TodoReason =
  | 'missing-sentence'
  | 'missing-chapter'
  | 'missing-volume'
  | 'unclaimed-volume'
  | 'legacy';

export interface TextToken {
  id: string;
  text: string;
}

export interface Sentence {
  id: string;
  order: number;
  text: string;
  tokens: TextToken[];
}

export interface Chapter {
  id: string;
  volumeId: string;
  order: number;
  title: string;
  summary: string;
  sentences: Sentence[];
}

export interface Volume {
  id: string;
  order: number;
  title: string;
  /** 丛书内第几卷的字面号，如 “一”“二”；待认领卷为 null */
  number: string | null;
  /** 待认领：旧稿未记卷册的章节暂存于此 */
  unclaimed?: boolean;
}

export interface Annotation {
  id: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  title: string;
  body: string;
  source: string;
  references: string[];
  status: AnnotationStatus;
  tags: string[];
  conflictState: 'open' | 'resolved';
  conflictResolution?: string;
  updatedAt: string;
}

/**
 * 互见的“指路关系”。互见不再照抄文字，而是一条可核对的指针：
 * 从 (originVolumeId 所在的句子) 指向 target 卷/章/句（或句内词语）。
 */
export interface CrossRef {
  id: string;
  label: string;
  note: string;
  source: string;
  /** 互见起点所在句（或句内词语） */
  originAnchorId: string;
  originAnchorType: AnchorType;
  /** 指针目标 */
  target: RefPointer;
  /** 建立互见时的目标原文，用于核对句子是否被改写（引文漂移） */
  targetQuote: string;
  status: RefStatus;
  /** 旧稿迁入、尚未指到目标时的说明 */
  todoReason?: TodoReason;
  updatedAt: string;
}

export interface RefPointer {
  /** 卷号字面（如“卷二”）或卷 id；待认领旧稿可能为空 */
  volumeId?: string;
  volumeHint?: string;
  chapterId?: string;
  chapterHint?: string;
  /** 指向具体句子的稳定 id（优先）；旧稿只有文字描述时走 hint */
  sentenceId?: string;
  sentenceHint?: string;
  tokenId?: string;
  tokenHint?: string;
}

export interface UnclaimedFragment {
  id: string;
  raw: string;
  chapterHint: string;
  sentenceId?: string;
  migratedAt: string;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  note: string;
  createdAt: string;
  volumes: Volume[];
  chapters: Chapter[];
  annotations: Annotation[];
  crossRefs: CrossRef[];
}

export interface SeriesDocument {
  id: string;
  title: string;
  edition: string;
  volumes: Volume[];
  chapters: Chapter[];
  annotations: Annotation[];
  crossRefs: CrossRef[];
  unclaimed: UnclaimedFragment[];
  workingCopies: WorkingCopy[];
  snapshots: VersionSnapshot[];
  updatedAt: string;
}

export type EditorRole = 'chief' | 'editor-a' | 'editor-b';

export type CopyStatus = 'editing' | 'failed' | 'merged';

export interface RefDecision {
  refId: string;
  choice: 'left' | 'right';
}

export interface PendingRefConflict {
  refId: string;
  label: string;
  left: CrossRef;
  right: CrossRef;
}

export interface WorkingCopy {
  id: string;
  label: string;
  volumeId: string;
  editor: string;
  role: EditorRole;
  status: CopyStatus;
  baseSnapshotId: string;
  /** 该卷章节的工作副本（含句序、章序、句文改动） */
  chapters: Chapter[];
  /** 本卷范围内新增/改动的注释 */
  annotations: Annotation[];
  /** 本整理者改过的互见（可跨卷指） */
  crossRefs: CrossRef[];
  /** 合并时未决、留待总校并排定夺的互见 */
  pendingRefs: PendingRefConflict[];
  refDecisions: RefDecision[];
  lastError?: string;
  failNextWrite?: boolean;
  updatedAt: string;
}

export interface WorkspaceState {
  series: SeriesDocument;
  mode: ViewMode;
  role: EditorRole;
  activeCopyId: string | null;
  selectedVolumeId: string;
  selectedChapterId: string;
  selectedSentenceId: string;
  selectedAnnotationId: string | null;
  query: string;
  dirty: boolean;
}

export interface EditorState {
  workspace: WorkspaceState;
  past: WorkspaceState[];
  future: WorkspaceState[];
  lastAction: string;
}

export interface SearchResult {
  volumeId: string;
  chapterId: string;
  sentenceId?: string;
  annotationId?: string;
  crossRefId?: string;
  title: string;
  excerpt: string;
  kind: 'text' | 'annotation' | 'crossref' | 'todo';
}

export interface ConflictGroup {
  key: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  anchorLabel: string;
  annotations: Annotation[];
}

/** 重算后的互见核对结果 */
export interface ResolvedRef {
  ref: CrossRef;
  status: RefStatus;
  reason?: TodoReason;
  volume?: Volume;
  chapter?: Chapter;
  sentence?: Sentence;
  token?: TextToken;
  /** 供“指路”展示的完整路径，如 卷一 · 逍遥游 · 第 3 句 */
  path: string;
  quoteMatches: boolean;
}

/** 重算后的脚注编号表：annotationId → 章内连续序号 */
export type FootnoteMap = Map<string, number>;

/** 供阅读/校勘/检索/导出统一使用的、重算后的视图模型 */
export interface ComputedSeries {
  series: SeriesDocument;
  chapters: Chapter[];
  annotations: Annotation[];
  crossRefs: CrossRef[];
  refs: ResolvedRef[];
  refById: Map<string, ResolvedRef>;
  /** 章 id → 该章脚注编号表 */
  footnotesByChapter: Map<string, FootnoteMap>;
  todos: ResolvedRef[];
  unclaimed: UnclaimedFragment[];
  volumes: Volume[];
}
