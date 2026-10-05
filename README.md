# TestInference

A desktop application that reads product documents and produces test
designs, test cases, runnable browser tests, and the results of running
them — keeping, at every step, a record of where each thing came from and
who approved it.

Everything it knows lives in files inside the project you point it at, so
it travels to git with your tests rather than sitting in a database
somewhere.

## What you need

| | |
|---|---|
| **Node** | 20 or newer. The worker that talks to models and drives the browser runs on it. |
| **Rust** | Stable. [rustup.rs](https://rustup.rs) |
| **A C++ toolchain** | macOS: Xcode command line tools. Windows: Visual Studio Build Tools with "Desktop development with C++". Linux: see the Tauri prerequisites. |
| **WebView2** | Windows only, and already present on Windows 11 and most Windows 10. The installer fetches it if not. |

## Getting it running

```
npm install
npx playwright install chromium
npm run dev
```

The browser download is about 100 MB and only happens once. It is needed
for Explore and for running tests; everything else works without it.

## Building something installable

```
npm run build
```

| on | you get |
|---|---|
| macOS | `src-tauri/target/release/bundle/macos/TestInference.app` and a `.dmg` |
| Windows | `src-tauri/target/release/bundle/` with an `.msi` and an NSIS `.exe` |
| Linux | `.deb` and `.AppImage` |

**Tauri does not cross-compile.** A Mac build runs on Macs only; to get a
Windows installer you have to build on Windows. Push the repository and
run the three commands above there.

### One thing this build does not do yet

The worker is not packaged inside the application. The path to it is fixed
when you compile, which means **the built application only runs on the
machine that built it, with the repository still where it was.** It also
needs Node installed on that machine.

That is fine for using it yourself. Giving it to someone else needs Node,
the worker and `node_modules` bundled into the application, which is not
built yet.

If Node is installed somewhere unusual, `TESTINFERENCE_NODE` can point at
it. The application looks on the PATH, in the usual install locations, and
in nvm's folders — an application launched from the Finder or the Start
menu sees almost no PATH, so it cannot rely on that alone.

## Where things are kept

| | |
|---|---|
| `src/` | the window: React and TypeScript |
| `src-tauri/` | the core: Rust. Stores records, schedules work, owns the keychain |
| `sidecar/` | the worker: TypeScript on Node. Talks to models, reads documents, drives the browser |
| `brand/` | the mark, and the source it was generated from |

Your API keys go to the operating system's keychain — Keychain on macOS,
Credential Manager on Windows — and never into the project or into git.

A project's own folder, wherever you put it, holds a `.testinference`
directory: the requirements, scenarios, cases, the map of the application,
the plans, the run results and the discussions. All of it is text, and all
of it is meant to be committed.

## Known differences between platforms

- **Removing a project's files** moves them to the Trash on macOS. Elsewhere
  it refuses and leaves them alone rather than deleting them outright, so
  on Windows you remove the folder yourself.
