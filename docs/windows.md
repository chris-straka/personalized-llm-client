# Windows installer (NSIS)

The Windows build produces **NSIS `.exe` installers** (one per architecture)
on GitHub Actions only. There is no Microsoft Store (MSIX) package and no
supported local Windows build — maintainers develop on macOS.

## What CI builds

Workflow: [.github/workflows/release-windows.yml](../.github/workflows/release-windows.yml).
It fires on the same `v*` tag push as `release.yml` / `release-linux.yml` and
attaches its artifacts to the same draft GitHub Release.

| Arch  | Runner          | Rust target                |
| ----- | --------------- | -------------------------- |
| x64   | `windows-latest` | `x86_64-pc-windows-msvc`  |
| ARM64 | `windows-11-arm` | `aarch64-pc-windows-msvc` |

Only the NSIS bundle is built (`--bundles nsis`); the WiX `.msi` is skipped —
MSI distribution is out of scope. NSIS itself is provisioned on the runner by
`tauri-apps/tauri-action`; no manual `choco install nsis` step is needed.

ARM64 needs the `windows-11-arm` runner (native build; cross-linking ARM64
from an x64 runner is not trivial). That label is GA for **public**
repositories only — if this repo ever goes private, delete the ARM64 matrix
entry; x64 is unaffected.

## Installer configuration

NSIS options live in `src-tauri/tauri.conf.json` under `bundle.windows`:

- `nsis.installerIcon: icons/icon.ico` — the installer (and uninstaller
  fallback) art. The file already ships in `src-tauri/icons/`.
- `installMode: currentUser` — installs without Administrator rights,
  metadata under `HKCU`. (`perMachine` would force a UAC prompt; `both`
  forces one even for per-user installs.)
- `languages: ["English"]`, `displayLanguageSelector: false` — single
  language, no picker dialog.
- `compression: lzma` — best ratio, the NSIS default made explicit.
- `startMenuFolder: "Ccez LLM"` — groups the Start Menu shortcut.

## WebView2 notes

Tauri renders with the system **WebView2** runtime. The configured mode is
`downloadBootstrapper` (silent): the installer stays small and downloads the
WebView2 bootstrapper at install time, so **installing requires an internet
connection**. The alternatives, cheapest first:

- `embedBootstrapper` — bundles the ~1.8 MB bootstrapper (still needs
  internet at install, better Windows 7 support).
- `offlineInstaller` — bundles the full ~127 MB runtime; works offline.
- `skip` — install nothing; the app fails on machines without WebView2
  (practically all Windows 10 1803+ / 11 ship it, but do not rely on this).

To switch, change `bundle.windows.webviewInstallMode.type` in
`src-tauri/tauri.conf.json`. Note the updater bundle always uses
`downloadBootstrapper` regardless of this setting.

## Secrets — none new

The in-app updater artifacts (`*.nsis.zip` + `*.nsis.zip.sig`) are signed
with the **same** secrets as `release.yml`:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

If those secrets are absent the build still succeeds but no `.sig` files are
produced and the in-app updater cannot verify Windows updates.

## What to expect on first install

The `.exe` is **not Authenticode-signed** (no code-signing certificate is
configured), so Windows SmartScreen shows an "Unknown publisher" warning and
users must click "More info → Run anyway". This is unrelated to the updater
signature above. Buying/configuring an EV cert (or Store listing) is a future
option, not part of this setup.

## Cutting a release

```sh
git tag v0.1.0 && git push origin v0.1.0
```

then check the draft Release on GitHub: it should contain the macOS, Android,
Linux, and Windows (`*-setup.exe`, `*.nsis.zip`, `*.nsis.zip.sig`) assets.
Publish the draft when all platform jobs are green.
