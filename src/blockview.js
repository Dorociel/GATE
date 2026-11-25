// 계층도 블록 안의 포트 표시(DOM/SVG). 데이터는 portinfo.js. el() 은 renderer.js 의 SVG 생성 함수를 쓴다.
//   왼쪽 = input(방향 미확인 포함), 오른쪽 = output·inout. 각 행: "포트명[폭] ◂ 상위 신호"(입력) / "포트명[폭] ▸ 상위 신호"(출력) / "◂▸"(inout)
const BV_HEADER_PLAIN = 40, BV_HEADER_TAG = 52, BV_CHAR_W = 6.7;

// 화면용 트리의 각 노드에 포트 정보·높이·최소 폭을 붙인다. ctx: {modMap, index, full:Set<id>, show:boolean}
function bvDecorate(view, ctx) {
  const st = [view];
  while (st.length) {
    const v = st.pop();
    for (const c of v.children) st.push(c);
    if (!ctx.show) continue;
    const info = ctx.index.get(v.id);
    const parent = info && info.parent ? ctx.index.get(info.parent) : null;
    const parentMod = parent ? ctx.modMap.get(parent.node.module) : null;
    const m = /#(\d+)$/.exec(v.id);
    const b = piBlock(ctx.modMap, v.module, parentMod, m ? +m[1] : 0);
    v.pb = b; v.isRoot = !parent;
    const pm = piMetrics(b, ctx.full.has(v.id), v.isRoot, v.tag ? BV_HEADER_TAG : BV_HEADER_PLAIN, BV_CHAR_W);
    if (pm) { v.pm = pm; v.h = Math.max(60, pm.h); v.minW = pm.minW; v.headerH = v.tag ? BV_HEADER_TAG : BV_HEADER_PLAIN; }
    else if (b.defined) { v.headerH = v.tag ? BV_HEADER_TAG : BV_HEADER_PLAIN; v.noPorts = true; }
  }
}

function bvClip(text, maxChars) { return text.length > maxChars ? text.slice(0, Math.max(1, maxChars - 1)) + "…" : text; }

function bvRowText(grp, x, y, anchor, r, isRoot, maxChars) {
  const t = piLabel(r, isRoot);
  const e = el("text", {x, y, "text-anchor": anchor, "font-size": "11", "font-family": MONO, class: "prow dir-" + r.dir}, grp);
  const sigPart = t.sig ? " " + t.glyph + " " + t.sig : (r.dir === "unknown" ? " (방향 미확인)" : "");
  let name = t.name, sig = sigPart;
  if ((name + sig).length > maxChars) {
    const keep = Math.max(4, maxChars - name.length);
    if (name.length > maxChars - 4) { name = bvClip(name, Math.max(6, maxChars - 4)); sig = bvClip(sigPart, 4); }
    else sig = bvClip(sigPart, keep);
  }
  const a = el("tspan", {class: "pname"}, e); a.textContent = name;
  const b = el("tspan", {class: "psig"}, e); b.textContent = sig;
  el("title", {}, e).textContent = r.full + (isRoot ? "" : "");
  return e;
}

function bvDrawPorts(grp, n) {
  const L = n.pm.layout, y0 = n.y + n.headerH, half = Math.floor((n.w - 24) / 2 / BV_CHAR_W);
  el("line", {x1: n.x + 1, x2: n.x + n.w - 1, y1: y0, y2: y0, class: "psep"}, grp);
  // 입력은 왼쪽 가장자리의 ▶ 표식, 출력·inout 은 오른쪽 가장자리의 ▶/◀▶ 표식(방향 정보가 확정된 포트만)
  const mark = (x, y, dir, side) => {
    if (dir === "unknown") return;
    el("text", {x, y, "text-anchor": side === "L" ? "start" : "end", "font-size": "9", class: "pmark dir-" + dir}, grp).textContent = dir === "inout" ? "◀▶" : "▶";
  };
  L.left.forEach((r, i) => { const y = y0 + 14 + i * PI_LINE; mark(n.x + 2, y, r.dir, "L"); bvRowText(grp, n.x + 14, y, "start", r, n.isRoot, half - 2); });
  L.right.forEach((r, i) => { const y = y0 + 14 + i * PI_LINE; mark(n.x + n.w - 2, y, r.dir, "R"); bvRowText(grp, n.x + n.w - 14, y, "end", r, n.isRoot, half - 2); });
  const b = n.pb;
  if (L.folded || (b.total > PI_FOLD)) {
    const rows = Math.max(L.left.length, L.right.length);
    const y = y0 + 14 + rows * PI_LINE;
    const t = el("g", {class: "nbtn pfold", "data-act": "ports", role: "button", "aria-label": L.folded ? "전체 포트 보기" : "포트 접기"}, grp);
    el("rect", {x: n.x + 8, y: y - 12, width: n.w - 16, height: 15, rx: "3", ry: "3"}, t);
    el("text", {x: n.x + n.w / 2, y: y - 1, "text-anchor": "middle", "font-size": "10", "font-family": UI_FONT}, t).textContent =
      L.folded ? "… 포트 " + b.total + "개 중 " + (b.total - L.hidden) + "개 표시 · 전체 포트 보기 ▾" : "포트 " + b.total + "개 전체 표시 · 접기 ▴";
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = {bvDecorate, BV_HEADER_PLAIN, BV_HEADER_TAG};
