import type { Page } from "@playwright/test";
import { rutubeProtocol } from "../../lib/video/rutube-protocol";

export async function mockRutubePlayer(page: Page, quiet = false) {
  if (process.env.E2E_RUTUBE_PLAYER !== "1")
    throw new Error("Enable the Playwright-only Rutube fixture");
  await page.route(/^https:\/\/rutube\.ru\//, (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/play/embed/"))
      return route.abort();
    const html = `<!doctype html><meta charset="utf-8">
      <button id="begin">Запустить фикстуру</button><p id="state" role="status">готов</p>
      <script>
        const {events, commands} = ${JSON.stringify(rutubeProtocol)};
        const quiet = ${quiet};
        let time = 0, timer;
        const status = document.getElementById("state");
        const emit = (type, data = {}) => {
          if (!quiet) parent.postMessage(JSON.stringify({type, data}), "http://localhost:3100");
        };
        const state = (value) => { status.textContent = value; emit(events.state, {state: value}); };
        function pause() { clearInterval(timer); state("paused"); }
        function play() {
          clearInterval(timer);
          state("playing");
          emit(events.time, {time});
          timer = setInterval(() => {
            emit(events.time, {time: ++time});
            if (time >= 10) { clearInterval(timer); state("stopped"); }
          }, 200);
        }
        document.getElementById("begin").onclick = play;
        addEventListener("message", (event) => {
          if (quiet || event.origin !== "http://localhost:3100") return;
          const message = JSON.parse(event.data);
          if (message.type === commands.play) play();
          if (message.type === commands.pause) pause();
          if (message.type === commands.seek) { time = message.data.time; emit(events.time, {time}); }
        });
        addEventListener("load", () => emit(events.ready));
      </script>`;
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    });
  });
}
