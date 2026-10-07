import { createInitialPersist } from '../../lib/series/seed';
import { recompute } from '../../lib/series/engine';
import { moveSentence, shiftSentence, deleteSentence, addSentence, findChapter } from '../../lib/series/structure';
import { migrateLegacy } from '../../lib/series/migration';
import { openBranch, applyWriteback, planWriteback, resolveConflict, retryWriteback } from '../../lib/series/merge';
import { addCrossref, updateCrossrefTarget } from '../../lib/series/annotations';
import type { PersistState } from '../../lib/series/types';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name, detail); }
}
function clone<T>(v: T): T { return structuredClone(v); }

// 1. 初始重算
{
  const state = createInitialPersist();
  const idx = recompute(state.trunk);
  const linked = idx.crossrefs.filter(r => r.status === 'linked');
  const dangling = idx.crossrefs.filter(r => r.status === 'dangling');
  const unclaimedX = state.trunk.unclaimed.filter(u => u.kind === 'crossref');
  console.log('初始: 互见', idx.crossrefs.length, 'linked', linked.length, 'dangling', dangling.length, 'unclaimed', state.trunk.unclaimed.length);
  ok('跨卷互见 x-3 可核对', linked.some(r => r.id === 'x-3'));
  const x3 = linked.find(r => r.id === 'x-3')!;
  ok('x-3 目标地址含齐物论', x3.targetAddress.includes('齐物论') && x3.targetAddress.includes('外篇') === false);
  ok('x-3 起点地址在外篇·秋水', x3.anchorAddress.includes('外篇') && x3.anchorAddress.includes('秋水'));
  ok('x-dangling 判为指空', dangling.some(r => r.id === 'x-dangling'));
  ok('指空进待办', idx.todos.some(t => t.kind === 'dangling-crossref' && t.title.includes('畏垒')));
  ok('没记卷册的残签入待认领', unclaimedX.some(u => u.label.includes('南冥')));
  ok('引句重出的“辩”入待认领', unclaimedX.some(u => u.label.includes('辩')));
  ok('唯一引句的旧注自动挂上', state.trunk.notes.some(n => n.sentenceId === 's-gs-2'));
  ok('找不到引句的旧注入待认领', state.trunk.unclaimed.some(u => u.kind === 'note' && u.label.includes('丧我')));
}

// 2. 章节调序/挪句后地址与脚注号重算
{
  const state = createInitialPersist();
  const before = recompute(state.trunk);
  const n1 = before.notes.find(n => n.id === 'n-1')!;
  ok('初始 n-1 为第 1 号', n1.number === 1, `got ${n1.number}`);
  // 在第一章开头插一句，脚注号不变（n-1 所在句仍是第一句）
  const ch = state.trunk.volumes[0].chapters[0];
  // 把第二章的句子挪到第一章开头之前
  moveSentence(state.trunk, 's-qw-1', { chapterId: 'ch-xiaoyao', beforeSentenceId: 's-xy-1' });
  const after = recompute(state.trunk);
  const x1 = after.crossrefs.find(r => r.id === 'x-1')!;
  ok('挪章后 x-1 仍 linked（稳定 ID）', x1.status === 'linked');
  const loc = after.locations.get('s-qw-1')!;
  ok('s-qw-1 已挪到内篇·逍遥游', loc.chapter.id === 'ch-xiaoyao');
  ok('x-3 起点句 s-qs-3 的地址仍在秋水', x1 ? after.crossrefs.find(r=>r.id==='x-3')!.anchorAddress.includes('秋水') : false);
  // 章内脚注号按新句序
  const nums = after.notes.filter(n => n.kind==='footnote' && after.locations.get(n.sentenceId)?.chapter.id==='ch-xiaoyao').map(n=>n.number);
  ok('逍遥游脚注号连续从1开始', JSON.stringify(nums) === JSON.stringify([1]), JSON.stringify(nums));
  // 句序调整
  const xy2 = after.locations.get('s-xy-2')!;
  ok('s-xy-2 句号后移（qw-1 插入）', xy2.sentenceIndex === 2, `got ${xy2.sentenceIndex}`);
}

// 3. 删句 → 指路不硬修，落待办
{
  const state = createInitialPersist();
  deleteSentence(state.trunk, 's-xy-6'); // x-1, x-2 目标
  const idx = recompute(state.trunk);
  const x1 = idx.crossrefs.find(r => r.id === 'x-1')!;
  ok('删目标句后 x-1 变 dangling', x1.status === 'dangling');
  ok('待办含 x-1', idx.todos.some(t => t.detail.includes('北冥南冥') || t.title.includes('北冥南冥')));
  ok('互见记录本身未被删除', state.trunk.crossrefs.some(r => r.id === 'x-1'));
}

// 4. 迁移：唯一命中自动指路；无卷册待认领
{
  const state = createInitialPersist();
  const res = migrateLegacy(state.trunk, [
    { from: '南冥者，天池也', quote: '秋水时至', volume: '外篇', label: 't1', raw: 'r1' },
    { quote: '辩', label: 't2', raw: 'r2' },
    { from: '北冥有鱼', quote: '不知其几千里也', label: 't3', raw: 'r3' }, // 多命中（两句“几千里”）
  ], []);
  ok('唯一命中自动成指路', res.crossrefs.length === 1 && res.report.crossrefLinked === 1, JSON.stringify({l:res.crossrefs.length,u:res.unclaimed.length}));
  ok('重出引句待认领', res.unclaimed.some(u => u.label === 't2'));
  ok('多命中待认领（不猜）', res.unclaimed.some(u => u.label === 't3'));
}

// 5. 分支写回：只一边动 → 自动并入
{
  const state = createInitialPersist();
  const br = openBranch(state, { editorId: 'editor-zhao', editorName: '赵校理（内篇）', ownedVolumeIds: ['vol-inner'] });
  // 赵改 x-1 的目标（trunk 未动）
  updateCrossrefTarget(br.series, 'x-1', { target: { volumeId: 'vol-inner', chapterId: 'ch-qiwu', sentenceId: 's-qw-3' } });
  const rep = applyWriteback(state, br.id);
  ok('自动写回成功', rep.ok === true);
  const idx = recompute(state.trunk);
  const x1 = idx.crossrefs.find(r => r.id === 'x-1')!;
  ok('x-1 目标已更新到齐物论第3句', x1.status === 'linked' && x1.targetAddress.includes('齐物论') && x1.targetAddress.includes('第 3 句'));
  ok('无冲突登记', state.conflicts.length === 0);
  ok('分支 base 已前移', br.baseRevision === state.trunk.revision);
}

// 6. 两边同改同一互见 → 并排冲突，总校定后写回
{
  const state = createInitialPersist();
  const br = openBranch(state, { editorId: 'editor-zhao', editorName: '赵校理（内篇）', ownedVolumeIds: ['vol-inner'] });
  // 总校先改 x-1 → s-qw-1
  updateCrossrefTarget(state.trunk, 'x-1', { target: { volumeId: 'vol-inner', chapterId: 'ch-qiwu', sentenceId: 's-qw-1' } });
  // 赵在自己分支（基于开分支时的 base，那时 trunk 未改）改 x-1 → s-qw-5
  updateCrossrefTarget(br.series, 'x-1', { target: { volumeId: 'vol-inner', chapterId: 'ch-qiwu', sentenceId: 's-qw-5' } });
  const plan = planWriteback(state, br);
  ok('试算发现 1 处冲突', plan.conflicts.length === 1, `got ${plan.conflicts.length}`);
  const rep = applyWriteback(state, br.id);
  ok('写回 ok 但有冲突待裁', rep.ok && rep.conflictsRaised === 1);
  ok('冲突队列有一条 open', state.conflicts.filter(c => c.status === 'open').length === 1);
  // trunk 此时保留总校版本（指向 s-qw-1）
  let idx = recompute(state.trunk);
  ok('未裁定前 trunk 保持总校版本', idx.crossrefs.find(r=>r.id==='x-1')!.targetSentenceId === 's-qw-1');
  const cf = state.conflicts[0];
  ok('冲突并排保留两边文本', cf.trunk?.targetSentenceId === 's-qw-1' && cf.theirs?.targetSentenceId === 's-qw-5');
  resolveConflict(state, cf.id, { side: 'theirs' });
  idx = recompute(state.trunk);
  ok('总校采用整理者后指向 s-qw-5', idx.crossrefs.find(r=>r.id==='x-1')!.targetSentenceId === 's-qw-5');
  ok('冲突标记 resolved', state.conflicts[0].status === 'resolved');
}

// 7. 一删一改 → delete-vs-edit 冲突，可裁定为删除
{
  const state = createInitialPersist();
  const br = openBranch(state, { editorId: 'editor-qian', editorName: '钱校理（外篇）', ownedVolumeIds: ['vol-outer'] });
  // 总校改 x-3
  updateCrossrefTarget(state.trunk, 'x-3', { label: '总校改的名' });
  // 钱删除 x-3
  br.series.crossrefs = br.series.crossrefs.filter(r => r.id !== 'x-3');
  applyWriteback(state, br.id);
  ok('一删一改也进冲突', state.conflicts.some(c => c.reason === 'delete-vs-edit' && c.status === 'open'));
  const cf = state.conflicts.find(c => c.crossrefId === 'x-3')!;
  ok('互见在裁定前仍保留在 trunk', state.trunk.crossrefs.some(r => r.id === 'x-3'));
  resolveConflict(state, cf.id, { side: 'theirs', keepDeleted: true });
  ok('裁定删除后 trunk 无 x-3', !state.trunk.crossrefs.some(r => r.id === 'x-3'));
}

// 8. 写回失败 → 原稿保留，可从原稿重试
{
  const state = createInitialPersist();
  const br = openBranch(state, { editorId: 'editor-sun', editorName: '孙校理（杂篇）', ownedVolumeIds: ['vol-misc'] });
  addCrossref(br.series, { anchorSentenceId: 's-tx-1', label: '新增互见Z', target: { volumeId: 'vol-inner', chapterId: 'ch-xiaoyao', sentenceId: 's-xy-3' }, editorId: 'editor-sun' });
  state.forceFail = true;
  const rep1 = applyWriteback(state, br.id);
  ok('模拟失败返回 ok:false', rep1.ok === false);
  ok('trunk 未被改动（无互见Z）', !state.trunk.crossrefs.some(r => r.label === '新增互见Z'));
  ok('分支保留工作稿（互见Z 还在）', br.series.crossrefs.some(r => r.label === '新增互见Z'));
  ok('base 原稿仍在', br.base.crossrefs.length === createInitialPersist().trunk.crossrefs.length);
  ok('分支状态为 writeback-failed', br.status === 'writeback-failed');
  state.forceFail = false;
  const rep2 = retryWriteback(state, br.id);
  ok('重试成功', rep2.ok === true);
  ok('trunk 收到互见Z', state.trunk.crossrefs.some(r => r.label === '新增互见Z'));
}

// 9. 脚注号：句移动到别章后按新章编号
{
  const state = createInitialPersist();
  // s-qw-4 上有 n-3（脚注）。把它挪到秋水章，编号应进入秋水序列
  moveSentence(state.trunk, 's-qw-4', { chapterId: 'ch-qiushui', beforeSentenceId: 's-qs-1' });
  const idx = recompute(state.trunk);
  const qiushui = idx.notes.filter(n => n.kind === 'footnote' && idx.locations.get(n.sentenceId)?.chapter.id === 'ch-qiushui');
  ok('秋水章脚注号 1..n 连续', qiushui.every((n, i) => n.number === i + 1), JSON.stringify(qiushui.map(n=>[n.id,n.number])));
  const qiwu = idx.notes.filter(n => n.kind === 'footnote' && idx.locations.get(n.sentenceId)?.chapter.id === 'ch-qiwu');
  ok('齐物论章脚注为空（n-3 已随句挪走）', qiwu.length === 0);
}

// 10. 新建互见必须句 ID 存在；目标不存在则拒绝
{
  const state = createInitialPersist();
  const created = addCrossref(state.trunk, { anchorSentenceId: 's-xy-1', label: 'X', target: { volumeId: 'vol-inner', chapterId: 'ch-xiaoyao', sentenceId: 's-xy-2' } });
  ok('正常建立互见', Boolean(created));
  const bad = addCrossref(state.trunk, { anchorSentenceId: 's-xy-1', label: 'Y', target: { volumeId: 'vol-inner', chapterId: 'ch-xiaoyao', sentenceId: 'nope' } });
  ok('目标句不存在时拒绝', bad === undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
