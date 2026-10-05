import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const workerSources = fileURLToPath(new URL("./sidecar/src", import.meta.url));
const tscEntry = fileURLToPath(new URL("./node_modules/typescript/bin/tsc", import.meta.url));

/**
 * Recompiles the Node worker whenever its sources change, so the dev loop
 * treats worker code like UI code. The core watches the built entry and
 * restarts the worker itself once this finishes. Lives inside Vite so it
 * cannot outlive the dev server.
 */
function rebuildWorker(): Plugin {
  let building = false;
  let again = false;

  const build = () => {
    if (building) {
      again = true;
      return;
    }
    building = true;

    const tsc = spawn(process.execPath, [tscEntry, "-p", "tsconfig.sidecar.json"], {
      stdio: ["ignore", "inherit", "inherit"],
    });

    tsc.on("exit", (code) => {
      building = false;
      console.log(code === 0 ? "[worker] rebuilt" : `[worker] build failed with code ${code}`);
      if (again) {
        again = false;
        build();
      }
    });
  };

  return {
    name: "bedrock-rebuild-worker",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.watcher.add(workerSources);
      server.watcher.on("all", (_event, path) => {
        if (path.startsWith(workerSources) && path.endsWith(".ts")) build();
      });
    },
  };
}

// Tauri expects a fixed port and ignores vite's HMR host discovery.
export default defineConfig({
  plugins: [react(), rebuildWorker()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/sidecar/dist/**"] },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
