// 계층도 펼치기/접기 모델(treeview.js) 검사. 실행: node test/check_tree.js
const assert = require("assert");
const {analyze, buildTree} = require("../src/analyzer.js");
const T = require("../src/treeview.js");
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("  통과  " + name); } catch (e) { fail++; console.log("  실패  " + name + " :: " + e.message); } }

const SRC = `
module leaf(input a); endmodule
module mid(input a); leaf l0(.a(a)); leaf l1(.a(a)); endmodule
module top(input a);
  mid m0(.a(a));
  mid m1(.a(a));
  ghost g0(.a(a));
  leaf lf(.a(a));
endmodule`;
const res = analyze(SRC);
const {root} = buildTree(res.modMap, "top", 1500);
const ids = n => [n.id, ...n.children.flatMap(ids)];
const find = (n, inst) => (n.instance === inst ? n : n.children.map(c => find(c, inst)).find(Boolean));
const view = ex => T.tvView(root, ex);
const vIds = ex => ids(view(ex));

t("처음(최상위만 펼침): 직접 하위만 보이고 하위의 하위는 숨김", () => {
  const v = vIds(new Set([root.id]));
  assert.strictEqual(v.length, 5);    // top + m0, m1, g0, lf
  assert(!v.some(id => id.includes("l0")));
});
t("펼칠 수 있는 블록: 하위 있는 정상 모듈만 (leaf·정의 미제공은 불가)", () => {
  assert(T.tvExpandable(find(root, "m0")));
  assert(!T.tvExpandable(find(root, "lf")));
  assert(!T.tvExpandable(find(root, "g0")));
  const v = view(new Set([root.id]));
  assert(v.children.find(c => c.instance === "m0").canExpand);
  assert(!v.children.find(c => c.instance === "g0").canExpand && !v.children.find(c => c.instance === "lf").canExpand);
  // 펼침 집합에 넣어도 펼칠 수 없는 블록은 열린 상태가 되지 않음
  const ex = new Set([root.id, find(root, "g0").id, find(root, "lf").id]);
  assert(view(ex).children.every(c => c.instance === "m0" || c.instance === "m1" ? true : !c.open && c.children.length === 0));
});
t("상위·형제 유지: m0 를 펼쳐도 top, m1, g0, lf 가 그대로 보임", () => {
  const ex = new Set([root.id]); T.tvToggle(ex, find(root, "m0").id);
  const v = vIds(ex);
  ["top", find(root, "m1").id, find(root, "g0").id, find(root, "lf").id].forEach(id => assert(v.includes(id), id));
  assert.strictEqual(v.length, 7);   // + m0 의 l0, l1
});
t("같은 블록 재토글 = 접힘, 원래 보기와 동일", () => {
  const ex = new Set([root.id]); const before = vIds(ex).join();
  const id = find(root, "m0").id;
  assert.strictEqual(T.tvToggle(ex, id), true); assert.strictEqual(T.tvToggle(ex, id), false);
  assert.strictEqual(vIds(ex).join(), before);
});
t("같은 모듈의 여러 인스턴스는 경로별로 독립", () => {
  const ex = new Set([root.id]);
  T.tvToggle(ex, find(root, "m0").id);
  const v = view(ex);
  assert(v.children.find(c => c.instance === "m0").open);
  assert(!v.children.find(c => c.instance === "m1").open);
  assert(v.children.find(c => c.instance === "m1").children.length === 0);
  T.tvToggle(ex, find(root, "m1").id); T.tvToggle(ex, find(root, "m0").id);   // m0 접고 m1 펼침
  const w = view(ex);
  assert(!w.children[0].open && w.children[1].open);
  assert.notStrictEqual(find(root, "m0").id, find(root, "m1").id);
});
t("펼침 상태 키는 모듈명이 아닌 전체 경로 (id 에 인스턴스명 포함)", () => {
  const ids0 = ids(root); assert(new Set(ids0).size === ids0.length);
  assert(/^top\/m0#\d+$/.test(find(root, "m0").id) && /^top\/m0#\d+\/l0#\d+$/.test(find(root, "l0").id));
});
t("중첩: 상위를 접으면 하위 펼침 기억을 남긴 채 숨고, 다시 펼치면 복원", () => {
  const ex = new Set([root.id]);
  const m0 = find(root, "m0").id;
  T.tvToggle(ex, m0);
  assert.strictEqual(vIds(ex).length, 7);
  T.tvToggle(ex, root.id);                 // 최상위 접기
  assert.deepStrictEqual(vIds(ex), ["top"]);
  T.tvToggle(ex, root.id);                 // 다시 펼침 → m0 의 펼침이 유지됨
  assert.strictEqual(vIds(ex).length, 7);
});
t("모두 펼치기: 펼칠 수 있는 블록만 포함, 전체 블록 수와 일치", () => {
  const all = T.tvAllExpandable(root);
  assert(all.has(root.id) && all.has(find(root, "m0").id) && !all.has(find(root, "lf").id) && !all.has(find(root, "g0").id));
  assert.strictEqual(vIds(all).length, ids(root).length);
  assert.strictEqual(T.tvFullDepth(root), 3);
});
t("원본 트리는 변하지 않음(화면용 복사본만 사용)", () => {
  const n0 = ids(root).length; view(new Set([root.id])); assert.strictEqual(ids(root).length, n0);
  assert(find(root, "m0").children.length === 2);
});
t("접힌 하위 판별: 선택된 블록이 숨겨지는 하위인지", () => {
  const m0 = find(root, "m0").id, l0 = find(root, "l0").id;
  assert(T.tvIsDescendant(l0, m0) && !T.tvIsDescendant(m0, m0) && !T.tvIsDescendant(find(root, "m1").id, m0));
});
console.log("결과: 통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
