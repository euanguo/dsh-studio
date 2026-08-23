<p align="center">
  <a href="./usage.md">简体中文</a> ·
  <strong>English</strong> ·
  <a href="../README.en.md">Back to README</a>
</p>

# Installation, operations, and troubleshooting

## Choose a distribution

- Install **DSH Studio** for the complete local workbench.
- Install **DSH Studio Web** for browser-only use without Electron.
- Install **DSH Studio TUI** for terminal-only use without Electron or browser UI.

The full distribution includes all three surfaces, so one installation
supports `desktop`, `web`, and `tui`.

## Install the full distribution

### macOS

1. Download the DMG from the latest Release.
2. Drag **DSH Studio** into Applications.
3. For an unnotarized test build, right-click the app in Finder and choose
   **Open** on first launch.

If a verified Release download remains quarantined, apply this to the actual
downloaded file:

```sh
xattr -d com.apple.quarantine ~/Downloads/DSH Studio-*.dmg
```

Install the unified command:

```sh
sudo ln -sf \
  "/Applications/DSH Studio.app/Contents/Resources/bin/dsh-studio" \
  /usr/local/bin/dsh-studio
```

### Linux

AppImage:

```sh
chmod +x DSH Studio-*.AppImage
./DSH Studio-*.AppImage
```

deb:

```sh
sudo apt install ./DSH Studio-*.deb
```

### Windows

Run the Windows installer from the Release and start **DSH Studio**. The unified CLI is
`bin\dsh-studio.cmd` under the application resources directory; add that directory
to `PATH` if desired.

An unsigned installer may trigger Windows SmartScreen. After verifying that it
came from the project Release, choose **More info**, then **Run anyway**. The
installer may request administrator approval.

### Desktop online updates

Choose **DSH Studio -> Check for Updates...** from the application menu.
The updater checks only stable GitHub Releases from
`hust-open-atom-club/oh-dsh`; it does not need a GitHub login or token.

- macOS, Windows, and Linux AppImage can restart and install after a verified
  download, or install on the next application quit.
- `.deb` downloads and opens the system package installer. It never runs
  `sudo`, `apt`, or `dpkg` around the system permission boundary.
- The updater uses the system proxy configuration. Offline, proxy-auth, 404,
  insufficient-space, verification, cancellation, and retry states are shown
  in the update window. A verification failure never replaces the current app.
- An update replaces only the application. DSH data, workspace settings,
  sessions, installed plugins, and marketplace receipts remain in the existing
  data directory.

Automatic updates require a signed packaged Desktop build. Versions installed
before the first updater-enabled Release need one manual install; local
development builds and Releases without a matching platform package fall back
to the official Release page.

## Install Web-only

```sh
tar -xzf dsh-studio-web-*.tar.gz
cd dsh-studio-web-*/
./bin/dsh-studio web
```

Windows:

```bat
bin\dsh-studio.cmd web
```

Common options:

| Option | Default | Description |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `3080` | Listen port; `0` selects a random port |
| `--data` | `~/.dsh-studio` | Shared DSH Studio data root for all surfaces |
| `--channel` | `stable` | Choose `~/.dsh-studio` or `~/.dsh-studio-dev`; `--data` / `DSH_STUDIO_HOME` win |
| `--no-open` | off | Do not open the browser automatically |
| `--trusted-host` | none | Add a trusted authority; repeatable |

Equivalent environment variables include `DSH_STUDIO_WEB_HOST`,
`DSH_STUDIO_WEB_PORT`, `DSH_STUDIO_WEB_HOME`, and `DSH_STUDIO_WEB_OPEN`. `DSH_STUDIO_HOME`
overrides the data root for Desktop, Web, and TUI together. When no absolute
root is set, `DSH_STUDIO_CHANNEL` selects `~/.dsh-studio` or `~/.dsh-studio-dev`. Press
`Ctrl+C` for a graceful shutdown.

Do not bind to `0.0.0.0` without an access boundary. For LAN exposure, add
`--trusted-host` and put authentication and TLS in a trusted reverse proxy.

## Install TUI-only

```sh
tar -xzf dsh-studio-tui-*.tar.gz
cd dsh-studio-tui-*/
./bin/dsh-studio tui
```

Use `bin\dsh-studio.cmd tui` on Windows. TUI requires a real interactive terminal.
It uses the alternate screen by default; upstream `dsh-TUI` owns fullscreen
selection, scrolling, and copy behavior.

## Unified commands

```sh
dsh-studio desktop
dsh-studio gui
dsh-studio web
dsh-studio tui
```

- `desktop` opens the installed app and falls back to the Electron development
  entry when run from a source checkout. The formal package defaults to `stable`
  (`~/.dsh-studio`); the Dev DMG is stamped at packaging time to default to `dev`
  (`~/.dsh-studio-dev`), as do `pnpm start` / `pnpm dev`. Override with
  `--channel stable|dev`.
- `gui` is an alias for `desktop`.
- `web` starts the HTTP service and prints its URL.
- `tui` initializes its Profile and attaches the upstream renderer to the
  current terminal.

Common TUI options:

| Option | Default | Description |
| --- | --- | --- |
| `--cwd` | Current directory | Workspace |
| `--data` | `~/.dsh-studio` | Shared DSH Studio data root for all surfaces |
| `--channel` | `stable` | Choose `~/.dsh-studio` or `~/.dsh-studio-dev`; `--data` / `DSH_STUDIO_HOME` win |
| `--resume` | New session | Resume a Session id |
| `--lang` | Upstream preference | `zh` or `en` |
| `--preset` | `standard` | Initial Agent preset |
| `--inline` | Off | Preserve terminal scrollback instead of alternate screen |

## Image recognition

Desktop, Web, and TUI all load the bundled `@dsh-studio/vision` plugin. DSH owns
image paste, thumbnails, attachment storage, and submission through its native
attachment rail. DeepSeek V4 is still described as text-only by the pinned DSH
metadata; the plugin only admits V4 at the Host's final image-capability check.
The Host then describes each native image attachment through the configured
vision backend before the pinned text-only adapter serializes the same turn. It
does not intercept the composer or create a second thumbnail/reference path.
The `view_image` tool remains available for explicit workspace-local paths,
HTTP(S) URLs, and image data URLs.

In Desktop or Web UI, copy a PNG, JPEG, WebP, or GIF, focus the message
composer, and press `⌘V` on macOS or `Ctrl+V` on Windows/Linux. DSH's native
composer displays the thumbnail inside the input card and owns remove, drag/drop,
size limits, and submission. The plugin does not intercept this flow. TUI has
no graphical thumbnail; provide a workspace-local image path or HTTP(S) URL in
the prompt to use the same `view_image` tool.

The default backend uses Zhipu `glm-4.6v-flash`. In the native
`Settings → Plugins → Plugin configuration → Vision` card, confirm the cloud
endpoint first, then click `Get a Zhipu key` to open the Zhipu console. Paste
the returned key into the password-style field; it is stored in the shared data
root's credential file (`~/.dsh-studio/.credentials.yaml` by default):

```yaml
ZHIPUAI_API_KEY: your-api-key
```

Keep the credential file owner-readable only, for example with
`chmod 600 ~/.dsh-studio/.credentials.yaml` on macOS/Linux. Exporting
`ZHIPUAI_API_KEY` before launch is also supported. The legacy
`VISION_API_KEY` name remains a migration fallback.

Override the backend and model in the shared `~/.dsh-studio/settings.yaml`:

```yaml
dsh-studio-vision:
  baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: qwen3-vl-flash
  apiKeyEnv: DASHSCOPE_API_KEY
  maxTokens: 2048
  timeoutMs: 60000
maxImageBytes: 10485760
```

The card intentionally shows only the cloud endpoint, cloud model, and one
masked Zhipu key field. The key is write-only through the DSH credential store
and is never returned in a settings snapshot. Retry, fallback, timeout, image
size, and local OCR/VLM options remain available to the Agent or through
advanced `settings.yaml` configuration, so users do not have to enter several
keys. Claude/Anthropic keys belong to their model provider and are not treated
as the Zhipu Vision key.

A local Ollama endpoint needs no key:

```yaml
dsh-studio-vision:
  baseURL: http://localhost:11434/v1
  model: qwen3-vl:4b
```

Cloud credentials are attempted first with bounded retries and configured cloud
fallback models. If the cloud request is rate-limited, unavailable, or returns
an incompatible response, a configured local OCR/VLM model is tried. If that
path also fails, one final cloud recovery is attempted before the error points
you to the Vision card, a new cloud key, or a local model. `localModel` is the
model ID you choose from your local Ollama/LM Studio-compatible installation;
an empty value disables the local fallback. `localApiKeyEnv` is only needed for
a non-local endpoint.

```yaml
dsh-studio-vision:
  apiKeyEnv: ZHIPUAI_API_KEY
  retryAttempts: 3
  retryBackoffMs: 1000
  localBaseURL: http://localhost:11434/v1
  localModel: glm-ocr
  localFallbackModels:
    - qwen2.5-vl:7b
```

Each backend has a bounded exponential retry. When both backends fail, the
error tells the user to check the cloud key or install/configure a local
OpenAI-compatible OCR/VLM model. The plugin does not embed or fetch a shared
cloud secret; the user's authorized key remains in DSH credentials or the
configured environment variable.

Local image paths must remain inside the active Session workspace, including
after symlink resolution. Remote URLs or local image bytes are sent to the
configured vision endpoint only when `view_image` is called. The browser's
attachment button, paste, and drag-and-drop remain native DSH image input;
DeepSeek V4 is admitted by the plugin's final check, while other models keep
their declared image-input behavior.

## Desktop operations

### Conversation input history

With the main conversation composer focused, `ArrowUp` at the start of the
first line recalls the preceding submitted message. `ArrowDown` at the end of
the last line moves forward and eventually restores the draft that was present
before browsing. In a multi-line draft, arrows away from those boundaries keep
their normal caret movement.

History is scoped to the current session, contains only confirmed text user
messages, and remains in memory only for the current application run. The
composer keeps the most recent 100 entries and loads older session messages on
demand while that window has capacity.

| Action | macOS shortcut |
| --- | --- |
| Toggle the left sidebar | `⌘B` |
| Toggle the bottom Terminal | `⌘J` |
| Toggle the right sidebar | `⌥⌘B` |
| Open Review | `⌃⇧G` |
| Open Browser | `⌘T` |
| Open Files | `⌘P` |
| Start a Side chat | `⌥⌘S` |
| Leave sidebar focus mode | `Esc` |

Settings covers language, models, permissions, Agent presets, plugin config,
and DSH Studio skins. Its modal covers and blurs every workspace and sidebar.

Choose a skin from Settings on Web or Desktop. In TUI, run `/theme` to select
the same Deep Current, Jade Circuit, Porcelain, or Ember Dusk palette. The
choice applies immediately and survives restarts.

## Plugin marketplace

Recommended flow:

1. Choose a plugin from Not installed.
2. Inspect its source, commit, permissions, and risk level.
3. Prepare a candidate and preview it in an isolated Profile.
4. Discard it if the result is unsuitable; the current Desktop is unchanged.
5. Apply it explicitly, then enable it separately when needed.
6. Recover the previous state if an update fails.

An Agent can initiate the same operation through chat, but still passes
through preview, risk approval, and apply. It cannot directly mutate the
current Profile.

## Run and package from source

```sh
git submodule update --init --recursive
pnpm install
pnpm run build:dsh
pnpm run build
pnpm run stage:dsh
export PATH="$PWD/bin:$PATH"

dsh-studio desktop
dsh-studio web --port 3080
dsh-studio tui
```

Packaging commands:

```sh
pnpm run dist:mac       # macOS full distribution
pnpm run dist:linux     # Linux full distribution
pnpm run dist:win       # Windows full distribution
pnpm run dist:web       # Web-only lightweight distribution
pnpm run dist:tui       # TUI-only terminal distribution
```

The release workflow produces formally signed packages when all GitHub Actions
secrets for macOS signing/notarization and Windows Authenticode signing are
available. If either credential set is incomplete, the workflow emits an
explicit warning and falls back to an ad-hoc-signed macOS package or an
unsigned Windows installer without blocking Web, TUI, and Desktop packaging.
Fallback artifacts support only the manual installation described above and
must not be treated as supporting automatic updates. Formal signing requires
`MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WINDOWS_CSC_LINK`, and
`WINDOWS_CSC_KEY_PASSWORD`. Installers, embedded or external blockmaps, and
`latest*.yml` metadata remain strictly validated and stop the release when
missing. Run the Release workflow manually from Actions for a four-platform
packaging check; manual runs upload workflow artifacts without creating a
GitHub Release.

## Data and troubleshooting

Desktop, Web, and TUI share `~/.dsh-studio` by default and do not load global plugin
configuration from `~/.dsh`. They keep separate `profiles/desktop`,
`profiles/web`, and `profiles/tui` compositions while sharing sessions,
credentials, skins, and plugin caches. Electron-specific data lives under
`<DSH_STUDIO_HOME>/desktop`. Override all surfaces with `DSH_STUDIO_HOME`, or switch
to `~/.dsh-studio-dev` with `DSH_STUDIO_CHANNEL=dev` / `--channel dev`. Isolate one
Web or TUI process with `--data`. Configure the DeepSeek API key in Models
settings or in `.env` under the active data root.

The formal package, Dev DMG, and a source verification instance can run together:
the formal package writes `~/.dsh-studio`, while the Dev DMG and
`pnpm start` / `pnpm dev` write `~/.dsh-studio-dev`. Profiles, plugins, and
workspace behavior stay the same; only the data root and single-instance lock
change. The Dev window title includes `(Dev)`, and the Dev DMG uses a separate
Dev app id and `DSH Studio-Dev` artifact name. To make a Dev instance read
production state, launch it with `--channel stable` or set `DSH_STUDIO_HOME`.

On first use of the shared root, Desktop imports sessions, credentials, plugins,
and UI preferences from the old system `DSH Studio` application-data
directory. Web imports the former `~/.dsh-studio-web/dsh` root and a nested `dsh/`
inside the selected data directory, plus root-level skin and sidebar
preferences. Migration copies only missing data and leaves legacy directories
in place for rollback; existing shared state is not replaced.

Desktop environment: when launched from Finder, Launchpad, or `open -a "DSH Studio"`, macOS and Linux do not automatically load the terminal's Shell configuration, so Desktop reads the user's POSIX login-shell environment at startup and invalidates the cached result when rc files such as `~/.zshrc` change. Windows uses the user and system environment already inherited by the GUI process and recognizes `Path`, `PATHEXT`, and `ComSpec`. User-visible processes (embedded terminal, Agent terminals, Git, and user commands) resolve PATH user-first, with the app's bundled Node adapters only as a fallback; Marketplace and plugin previews keep the bundled runtime first so pnpm and plugin builds stay consistent. Commands such as `codex`, `pi`, and `gh`, plus the user's own `node`, are therefore available directly. If a POSIX Shell configuration cannot start or times out, Desktop falls back to its base environment and records only redacted status in diagnostics; set `DSH_STUDIO_DISABLE_ENV_CACHE=1` to disable the environment cache. The marketplace GitHub credential helper is scoped to marketplace processes; normal terminals and project Git continue to use the user's Git configuration and macOS Keychain.

Interpreter variable boundary: the app reuses its own Electron binary as the Node interpreter (no standalone Node ships), so `ELECTRON_RUN_AS_NODE=1` exists only inside launch environments that exec that binary as an interpreter. The runtime process deletes the variable from its own environment through a preload at boot, so agent sessions and their tool shells inherit only the user environment plus `DSH_*`-namespaced variables — every command an agent runs on your behalf, including windowed Electron programs such as this repository's `pnpm run dev`, sees a clean environment. Marketplace builds are the one exec boundary that keeps the variable (their pnpm must run on the shared interpreter).

Troubleshooting order:

1. Run `dsh-studio --help` to confirm the CLI source.
2. Run `dsh-studio web --help` to inspect options.
3. Run `dsh-studio tui --help`, then use `dsh-studio tui --inline` to isolate
   alternate-screen terminal compatibility.
4. Test a random port with `dsh-studio web --port 0 --no-open`.
5. Confirm that required plugins are both installed and enabled in the Profile.
6. If Desktop does not start, run its bundled `bin/dsh-studio desktop` in a terminal
   to capture logs.

See [design and plugin boundaries](./design.en.md) for architecture and
upstream relationships.
