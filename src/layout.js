// 계층 트리 → 블록 좌표 계산 (왼쪽 상위, 오른쪽 하위, 같은 깊이는 같은 열)
// 블록 높이는 노드의 h(포트 표시 시 커짐), 최소 폭은 minW 가 있으면 반영한다. 둘 다 없으면 기존과 같은 고정 크기.
const NODE_H = 60, ROW_GAP = 18, COL_GAP = 70, PAD = 24, CHAR_W = 7.4, MIN_W = 140, MAX_W = 320, MAX_W_PORTS = 520;

function layout(root) {
  const depthW = [];
  const st = [[root, 0]];
  while (st.length) {
    const [x, d] = st.pop();
    x.depth = d;
    if (!x.h) x.h = NODE_H;
    const len = Math.max(x.module.length, x.instance.length, x.tag ? x.tag.length * 1.3 : 0);
    const want = Math.max(len * CHAR_W + 28 + 44, x.minW || 0);
    depthW[d] = Math.max(depthW[d] || 0, Math.min(x.minW ? MAX_W_PORTS : MAX_W, Math.max(MIN_W, want)));
    for (const c of x.children) st.push([c, d + 1]);
  }
  const colX = []; let cx = PAD;
  depthW.forEach((w, i) => { colX[i] = cx; cx += w + COL_GAP; });
  const width = cx - COL_GAP + PAD;

  let nextY = PAD;
  const st1 = [[root, false]];
  while (st1.length) {
    const [n, done] = st1.pop();
    if (!done) {
      st1.push([n, true]);
      for (let i = n.children.length - 1; i >= 0; i--) st1.push([n.children[i], false]);
    } else if (n.children.length === 0) { n.y = nextY; nextY += n.h + ROW_GAP; }
    else {
      const a = n.children[0], b = n.children[n.children.length - 1];
      n.y = (a.y + a.h / 2 + b.y + b.h / 2) / 2 - n.h / 2;
      // 부모가 자식 묶음보다 높아 위로 넘치면 아래로 밀어 겹침을 막는다(자식 위치는 그대로)
      if (n.y < PAD) { const sh = PAD - n.y; n.y += sh; }
    }
  }
  const all = [], st2 = [root];
  let maxBottom = 0;
  while (st2.length) {
    const n = st2.pop();
    n.x = colX[n.depth]; n.w = depthW[n.depth]; all.push(n);
    maxBottom = Math.max(maxBottom, n.y + n.h);
    for (const c of n.children) st2.push(c);
  }
  return {nodes: all, width, height: Math.max(nextY - ROW_GAP, maxBottom) + PAD, depthCount: depthW.length};
}

if (typeof module !== "undefined" && module.exports) module.exports = {layout, NODE_H, ROW_GAP, COL_GAP, PAD};
