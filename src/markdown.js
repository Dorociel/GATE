// 인식 결과 → Markdown 변환 (화면 DOM을 읽지 않고, analyze()가 돌려준 결과 데이터만 사용)
// 계층도 블록 수는 이 문서에 넣지 않는다. (인스턴스 선언 수와 구분하기 위함)

// 표·본문에 들어가는 일반 텍스트: 줄바꿈은 공백으로, Markdown 특수문자는 이스케이프
function mdText(s) {
  return String(s).replace(/\s*[\r\n]+\s*/g, " ").replace(/[\\`*_\[\]<>|]/g, c => "\\" + c);
}
// 모듈명·인스턴스명: 인라인 코드. 이름 안의 백틱보다 긴 백틱 울타리를 쓰고, 표가 깨지지 않게 | 는 \| 로 바꾼다.
function mdCode(s) {
  const v = String(s).replace(/\s*[\r\n]+\s*/g, " ").replace(/\|/g, "\\|");
  let n = 1;
  (v.match(/`+/g) || []).forEach(r => { if (r.length >= n) n = r.length + 1; });
  const f = "`".repeat(n);
  const pad = /^`|`$/.test(v) ? " " : "";
  return f + pad + v + pad + f;
}

// renderer.js 의 styleOf 와 같은 표기를 쓴다. (renderer.js 는 DOM 의존이라 Node 에서 불러오지 못해 별도로 둠)
function connStyleLabel(x) {
  const k = new Set(x.conns.map(c => c.kind === "positional" ? "positional" : c.kind === "implicit" ? "implicit" : "named"));
  if (!x.conns.length) return "포트 없음";
  if (k.has("implicit")) return ".* (확인 필요)";
  if (k.has("positional") && k.size > 1) return "혼합(확인 필요)";
  if (k.has("positional")) return "위치 기반(확인 필요)";
  return "이름 기반";
}

// 확인 필요 항목: 화면의 ‘확인이 필요한 항목’ 및 상태줄의 건수와 같은 기준
function collectNotes(res) {
  const notes = [];
  res.warnings.forEach(w => notes.push({text: mdText(w)}));
  res.modules.forEach(m => m.warns.forEach(w => notes.push({mod: m.name, text: mdText(w)})));
  (res.conflicts || []).forEach(c => notes.push({text: "모듈명 " + mdCode(c.name) + " 정의 충돌(어느 정의를 쓸지 정하지 않음): " +
    c.defs.map(d => mdText(d.displayName + " " + d.line + "줄")).join(", ")}));
  if (res.undef.length)
    notes.push({text: "정의가 입력 코드에 없는 모듈: " + res.undef.map(mdCode).join(", ") + " → 계층도에서 ‘정의 미제공’으로 표시하며 펼치지 않음"});
  return notes;
}

function toMarkdown(res) {
  if (!res || res.error || !res.modules) throw new Error("분석에 성공한 결과가 없습니다.");
  const notes = collectNotes(res);
  const L = [];
  L.push("# Verilog 모듈 분석 결과", "");
  L.push("## 요약", "");
  L.push("- 모듈 수: " + res.modules.length);
  L.push("- 인스턴스 선언 수: " + res.instCount + " (입력 코드에 적힌 인스턴스 선언의 개수)");
  L.push("- 최상위 후보 수: " + res.roots.length);
  L.push("- 확인 필요 건수: " + notes.length, "");

  L.push("## 최상위 후보", "");
  if (res.roots.length) res.roots.forEach(r => L.push("- " + mdCode(r)));
  else L.push("- 없음 (모든 모듈이 다른 모듈에서 인스턴스화되어 있음)");
  L.push("");

  L.push("## 모듈 목록", "");
  const multi = !!res.files;   // 여러 파일 통합 결과면 파일명을 함께 적는다(줄 번호는 그 파일 기준)
  if (multi) {
    L.push("| 모듈명 | 정의 파일 | 정의 시작 줄(파일 기준) | 하위 인스턴스 선언 수 |", "| --- | --- | --- | --- |");
    res.modules.forEach(m => L.push("| " + mdCode(m.name) + " | " + mdText(m.file.displayName) + " | " + m.line + " | " + m.instances.length + " |"));
  } else {
    L.push("| 모듈명 | 정의 시작 줄 | 하위 인스턴스 선언 수 |", "| --- | --- | --- |");
    res.modules.forEach(m => L.push("| " + mdCode(m.name) + " | " + m.line + " | " + m.instances.length + " |"));
  }
  L.push("");

  L.push("## 모듈별 인스턴스", "");
  res.modules.forEach(m => {
    L.push("### " + mdCode(m.name), "");
    if (multi) L.push("- 정의 파일: " + mdText(m.file.displayName));
    L.push("- 정의 시작 줄: " + m.line + (multi ? " (해당 파일 기준)" : ""));
    L.push("- 하위 인스턴스 선언 수: " + m.instances.length, "");
    if (m.instances.length) {
      L.push("| 인스턴스명 | 모듈명 | 정의 여부 | 포트 연결 형식 | 줄 |", "| --- | --- | --- | --- | --- |");
      m.instances.forEach(x => L.push("| " + mdCode(x.name) + " | " + mdCode(x.module) + " | " +
        (res.modMap.has(x.module) ? "정의됨" : res.defs && res.defs.has(x.module) ? "정의 충돌" : "정의 미제공") + " | " +
        mdText(connStyleLabel(x) + (x.array ? " · 배열" : "")) + " | " + x.line + " |"));
    } else L.push("인식된 인스턴스 없음");
    L.push("");
  });

  L.push("## 확인 필요 항목", "");
  if (notes.length) notes.forEach(n => L.push("- " + (n.mod ? mdCode(n.mod) + ": " : "") + n.text));
  else L.push("- 프로그램이 표시한 확인 필요 항목 없음 (아래 분석 제한 안내 참고)");
  L.push("");

  L.push("## 분석 제한 안내", "");
  L.push("- 이 결과는 간이 텍스트 패턴 분석으로 얻은 것이며, 누락·오인식이 있을 수 있으므로 실제 코드와 대조가 필요합니다.");
  L.push("- 지원 범위: `module ~ endmodule` 정의, 선언문당 인스턴스 1개, 이름 기반 포트 연결, `//`·`/* */` 주석 무시");
  L.push("- 지원하지 않거나 확인이 필요한 항목: generate/genvar 내부, 매크로·컴파일러 지시어, SystemVerilog 문법, 위치 기반 포트 연결·인스턴스 배열(관계만 인식)");
  L.push("- 게이트 프리미티브(and, or 등)는 모듈 인스턴스로 취급하지 않으며, 포트·신호 연결은 분석하지 않습니다.");
  L.push("- 입력 코드에 정의가 없는 모듈은 ‘정의 미제공’으로 표시합니다.");
  return L.join("\n") + "\n";
}

if (typeof module !== "undefined" && module.exports) module.exports = {toMarkdown, mdText, mdCode, collectNotes, connStyleLabel};
