// 화면(렌더러)에 노출하는 인터페이스: 클립보드에 텍스트를 쓰는 함수 하나뿐이다.
// Node/Electron 객체는 화면에 직접 넘기지 않는다.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gateClipboard", {
  writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text)
});
// Yosys 회로 변환 요청(실행은 메인 프로세스가 한다).
contextBridge.exposeInMainWorld("gateYosys", {
  convert: (req) => ipcRenderer.invoke("yosys:convert", req),
  status: () => ipcRenderer.invoke("yosys:status")
});
