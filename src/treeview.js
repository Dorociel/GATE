// 계층도 펼치기/접기 모델(DOM 없음). 펼침 상태는 모듈명이 아니라 노드 id(최상위부터의 전체 인스턴스 경로)로 관리한다.
//   expanded: Set<id>  — 들어 있는 id 의 직접 하위 인스턴스만 화면에 그린다. 하위 트리 전체(state.root)는 바뀌지 않는다.
//   펼칠 수 있는 블록: 정의가 있고(kind "normal") 직접 하위 인스턴스가 있는 블록. 하위가 없거나 정의 미제공·재귀 블록은 펼침 표시를 하지 않는다.

function tvExpandable(n) { return n.kind === "normal" && n.children.length > 0; }

// 전체 트리 → 화면용 트리(복사본). layout() 이 좌표를 써 넣으므로 원본 트리는 건드리지 않는다.
function tvView(node, expanded) {
  const can = tvExpandable(node), open = can && expanded.has(node.id);
  return {id: node.id, module: node.module, instance: node.instance, tag: node.tag, kind: node.kind,
    canExpand: can, open, kids: node.children.length,
    children: open ? node.children.map(c => tvView(c, expanded)) : []};
}
function tvCount(view) { let c = 0; const st = [view]; while (st.length) { const n = st.pop(); c++; for (const k of n.children) st.push(k); } return c; }
// 모든 펼칠 수 있는 블록 id
function tvAllExpandable(root) { const s = new Set(), st = [root]; while (st.length) { const n = st.pop(); if (tvExpandable(n)) s.add(n.id); for (const c of n.children) st.push(c); } return s; }
function tvFullDepth(root) { let d = 0; const st = [[root, 1]]; while (st.length) { const [n, k] = st.pop(); d = Math.max(d, k); for (const c of n.children) st.push([c, k + 1]); } return d; }
// 토글: 펼침 상태가 되었으면 true. 접을 때는 선택이 숨겨지는 하위에 있으면 selected 를 이 블록으로 옮길 수 있게 호출 쪽에서 판단한다.
// (이 파일의 순수 함수는 Node 에서 테스트한다. 포트 표시는 blockview.js 가 화면용 트리에 덧붙인다.)
function tvToggle(expanded, id) { if (expanded.has(id)) { expanded.delete(id); return false; } expanded.add(id); return true; }
function tvIsDescendant(id, ancestor) { return id.length > ancestor.length && id.startsWith(ancestor + "/"); }

if (typeof module !== "undefined" && module.exports) module.exports = {tvExpandable, tvView, tvCount, tvAllExpandable, tvFullDepth, tvToggle, tvIsDescendant};
