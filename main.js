// Electron 메인 프로세스: 별도 데스크톱 창을 열고 src/index.html 을 표시한다.
const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
const path = require("path");

const INDEX_FILE = path.join(__dirname, "src", "index.html");
const MAX_CLIP_CHARS = 5 * 1024 * 1024;

// 클립보드 쓰기: 우리 화면(src/index.html)에서 온 문자열만 허용한다.
ipcMain.handle("clipboard:write-text", (event, text) => {
  const url = event.senderFrame && event.senderFrame.url;
  let ok = false;
  try { ok = path.resolve(require("url").fileURLToPath(url)) === path.resolve(INDEX_FILE); } catch (e) { ok = false; }
  if (!ok) throw new Error("허용되지 않은 요청입니다.");
  if (typeof text !== "string") throw new Error("복사할 내용이 문자열이 아닙니다.");
  if (text.length > MAX_CLIP_CHARS) throw new Error("복사할 내용이 너무 큽니다.");
  clipboard.writeText(text);
  return true;
});

// Yosys 회로 변환: 사용자가 별도 폴더에 둔 도구를 실행한다(설치·다운로드·전역 설정 변경 없음). 우리 화면에서 온 요청만 허용.
const yosysRunner = require("./yosys_runner.js");
ipcMain.handle("yosys:convert", async (event, req) => {
  const url = event.senderFrame && event.senderFrame.url;
  let ok = false;
  try { ok = path.resolve(require("url").fileURLToPath(url)) === path.resolve(INDEX_FILE); } catch (e) { ok = false; }
  if (!ok) throw new Error("허용되지 않은 요청입니다.");
  if (!req || typeof req !== "object") throw new Error("요청이 올바르지 않습니다.");
  const files = Array.isArray(req.files) ? req.files.map(f => ({name: String(f && f.name || ""), text: String(f && f.text || "")})) : [];
  return yosysRunner.convert(__dirname, {files, top: String(req.top || ""), mode: req.mode === "gate" ? "gate" : "rtl"});
});
ipcMain.handle("yosys:status", (event) => {
  const t = yosysRunner.locate(__dirname); return {found: !!t, dir: t ? t.dir : null};
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "GATE Verilog 계층도 생성기",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });
  // 외부 주소로 이동하거나 새 창을 여는 동작은 막는다. (이 프로그램은 네트워크를 사용하지 않음)
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(INDEX_FILE);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
