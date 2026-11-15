import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import * as actions from "./lib/actions.svelte";
import * as state from "./lib/app.svelte";
import { backend } from "./lib/backend";
import { demoAssets } from "./lib/backend/web";
import { soundState } from "./lib/juice/sound";
import { measure, meter, sceneStats } from "./lib/perf";
import { settings } from "./lib/settings.svelte";

const app = mount(App, { target: document.getElementById("app")! });

// Dev-only console hooks. `__pw.demo(300)` fills the board with generated images
// (browser mode only); `__pw.state` / `__pw.actions` expose the live modules.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __pw: {
      state,
      actions,
      settings,
      sound: soundState,
      /** Live backend, so tests can stub dialogs (e.g. `__pw.backend.confirm = async () => true`). */
      backend,
      /** `await __pw.perf.measure(2000, () => …)` → fps, avg/p95/worst frame ms, janky frames. */
      perf: { measure, summary: (ms?: number) => meter.summary(ms), scene: sceneStats },
      async demo(count = 200) {
        if (backend.kind !== "web") throw new Error("demo() needs the browser backend");
        const assets = await demoAssets(count);
        const viewport = document.querySelector(".viewport")!.getBoundingClientRect();
        state.importDropped(viewport.width / 2, viewport.height / 2, { assets, skipped: [] }, viewport);
      },
    },
  });
}

export default app;
