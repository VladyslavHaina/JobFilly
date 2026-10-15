import path from "node:path";
import { startServer } from "@jobfilly/server/node";
import { app, BrowserWindow } from "electron";

// Smoke mode (JOBFILLY_DESKTOP_SMOKE=1) loads the UI in a hidden window,
// waits for it to reach the server, prints the result and quits. It checks a
// build end to end without showing anything on screen.
const smoke = process.env.JOBFILLY_DESKTOP_SMOKE === "1";

async function open(): Promise<void> {
  const server = await startServer({
    hostname: "127.0.0.1",
    port: 0,
    version: app.getVersion(),
    webDist: process.env.JOBFILLY_WEB_DIST ?? path.join(import.meta.dirname, "../../web/dist"),
  });

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    show: !smoke,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // The window only ever shows the local server. Opening links elsewhere is a
  // deliberate feature for later; until then every other destination is denied.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(server.url).origin) event.preventDefault();
  });
  window.on("closed", () => {
    void server.close();
  });

  await window.loadURL(server.url);
  if (smoke) await reportSmoke(window);
}

async function reportSmoke(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 15_000;
  let status = "";
  while (Date.now() < deadline) {
    status = await window.webContents.executeJavaScript(
      `document.querySelector('[role="status"]')?.textContent ?? ""`,
    );
    if (status.startsWith("Server ok")) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  const ok = status.startsWith("Server ok");
  console.log(ok ? `desktop smoke ok: ${status}` : `desktop smoke failed: "${status}"`);
  app.exit(ok ? 0 : 1);
}

if (smoke) app.dock?.hide();
app.on("window-all-closed", () => app.quit());
app.whenReady().then(open, (err: unknown) => {
  console.error(err);
  app.exit(1);
});
