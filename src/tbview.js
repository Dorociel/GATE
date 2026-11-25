// 테스트벤치 탭 화면(DOM). 분석 자체는 tbanalyze.js 가 한다.
// ctx: {res, files, roles(Map), st, onJump(tbName, instName), onRole()}
const TB_CATS = [
  ["clock", "클록"], ["reset", "리셋"], ["stimulus", "입력 자극"], ["wait", "대기 조건"],
  ["compare", "출력 비교"], ["finish", "종료·실패 조건"], ["observe", "관찰·로그·파형 기록"],
  ["unsupported", "분석 미지원·추가 확인 필요"], ["other", "그 밖의 조건문"]
];
function tbH(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }

function tbRender(panel, ctx) {
  panel.innerHTML = "";
  const wrap = tbH("div", null, "pad tb");
  panel.appendChild(wrap);
  wrap.append(tbH("div", TB_BANNER, "notice tb-banner"));
  if (!ctx.res) { wrap.append(tbH("div", "먼저 소스를 분석해 주세요. (왼쪽 파일 목록에서 파일마다 ‘설계/테스트벤치’ 역할을 지정할 수 있습니다.)", "empty")); return; }
  const cands = tbCandidates(ctx.res, ctx.roles);
  if (!cands.length) {
    wrap.append(tbH("div", "테스트벤치 후보가 없습니다. 테스트벤치 파일의 역할을 ‘테스트벤치’로 지정하거나, 포트 없이 initial/always 와 하위 인스턴스를 가진 모듈이 있는지 확인하세요.", "empty"));
    wrap.append(tbScope());
    return;
  }
  const st = ctx.st;
  if (!st.tbTop || !cands.some(c => c.name === st.tbTop)) st.tbTop = cands[0].name;
  const bar = tbH("div", null, "tb-bar");
  bar.append(tbH("label", "테스트벤치 모듈"));
  const sel = tbH("select"); sel.id = "tbSel";
  cands.forEach(c => { const o = tbH("option", c.name + "  (" + c.fileName + ":" + c.line + (c.roleTb ? "" : ", 역할 미지정·패턴으로 보임") + ")"); o.value = c.name; sel.append(o); });
  sel.value = st.tbTop;
  sel.addEventListener("change", () => { st.tbTop = sel.value; tbRender(panel, ctx); });
  bar.append(sel); wrap.append(bar);
  const a = analyzeTestbench({res: ctx.res, files: ctx.files, roles: ctx.roles, tb: st.tbTop});
  if (!a.ok) { wrap.append(tbH("div", a.error, "notice error")); wrap.append(tbScope()); return; }

  const head = tbH("div", null, "tb-head");
  head.append(tbH("span", "정의: " + a.file.displayName + " " + a.line + "–" + a.endLine + "줄", "m"));
  head.append(tbH("span", a.timescale ? "시간 단위: `timescale " + a.timescale.unit + "/" + a.timescale.precision + " (" + a.timescale.line + "줄)" : "시간 단위: `timescale 지시어를 찾지 못함", "m"));
  wrap.append(head);

  // DUT 후보
  const dsec = tbH("section", null, "tb-sec");
  dsec.append(tbH("h3", "DUT(시험 대상) 후보 — 인스턴스 " + a.dut.length + "개"));
  if (!a.dut.length) dsec.append(tbH("div", "이 모듈 안에 하위 인스턴스가 없습니다.", "empty"));
  const ul = tbH("ul", null, "tb-dut");
  for (const d of a.dut) {
    const li = tbH("li");
    li.append(tbH("span", d.instance + " : " + d.module, "m"), tbH("span", " — " + (d.candidate ? "DUT 후보(추정): " : "") + d.why + ", " + d.line + "줄", "tb-lv"));
    if (d.candidate || d.defined) {
      const b = tbH("button", "상세 보기", "btn btn-secondary btn-small"); b.type = "button"; b.dataset.dut = d.instance;
      b.title = "계층도에서 이 인스턴스의 모듈 상세를 엽니다(최상위가 이 테스트벤치로 바뀝니다).";
      b.addEventListener("click", () => ctx.onJump(a.module, d.instance));
      li.append(b);
    }
    if (d.candidate) li.append(tbH("div", "입력 연결 신호: " + (d.inputs.join(", ") || "확인 못함") + " / 출력 연결 신호: " + (d.outputs.join(", ") || "확인 못함") + " (단일 신호명으로 연결된 것만)", "tb-sub"));
    ul.append(li);
  }
  dsec.append(ul); wrap.append(dsec);

  // 병렬 블록
  const bsec = tbH("section", null, "tb-sec");
  bsec.append(tbH("h3", "병렬 블록 " + a.blocks.length + "개 (서로 동시에 실행되며 하나로 합치지 않음)"));
  const bl = tbH("ul", null, "tb-blocks");
  a.blocks.forEach(b => bl.append(tbH("li", b.title + " — " + b.start, "m")));
  if (!a.blocks.length) bl.append(tbH("li", "(없음)"));
  bsec.append(bl); wrap.append(bsec);

  for (const [k, label] of TB_CATS) {
    const list = a.sections[k];
    if (!list.length && k !== "compare") continue;
    const sec = tbH("section", null, "tb-sec tb-" + k);
    sec.append(tbH("h3", label + " (" + list.length + ")"));
    if (!list.length) sec.append(tbH("div", "자동 비교(출력과 기대값 비교) 조건을 찾지 못했습니다. 파형·로그 관찰용 테스트벤치일 수 있습니다(추정).", "empty"));
    const u = tbH("ul", null, "tb-list");
    for (const it of list) {
      const li = tbH("li", null, "tb-item lv-" + it.level);
      li.append(tbH("span", it.level === "code" ? "코드 확인" : "추정", "tb-badge " + it.level));
      li.append(tbH("span", " " + it.text));
      const meta = tbH("div", null, "tb-meta m");
      meta.textContent = it.file + " " + it.line + "줄" + (it.block ? " · " + it.block.title : "") + (it.at ? " · 시각: " + it.at : "");
      li.append(meta);
      if (it.code) li.append(tbH("code", it.code, "tb-code"));
      if (it.note) li.append(tbH("div", it.note, "tb-sub"));
      u.append(li);
    }
    sec.append(u); wrap.append(sec);
  }
  wrap.append(tbScope());
}
function tbScope() {
  const d = tbH("details", null, "tb-scope");
  d.append(tbH("summary", "테스트벤치 분석의 범위와 제한사항"));
  const u = tbH("ul"); TB_SCOPE_NOTES.forEach(t => u.append(tbH("li", t))); d.append(u);
  return d;
}
