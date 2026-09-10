# Linux distribution: .deb, AUR, AppImage

Ccez LLM is a Tauri v2 app (currently tauri 2.11.5 / tauri-build 2.6.3 per
`src-tauri/Cargo.lock`). Every Linux build needs the WebKitGTK 4.1 stack at
**build time** and the WebKitGTK/GTK runtime libs at **install time**.
`src-tauri/tauri.conf.json` currently has no `bundle.linux` section and
`bundle.targets` is `"all"` (see the required patch in
[Required tauri.conf.json patch](#required-tauriconfjson-patch) — owned by
another agent, do NOT edit that file from this track).

## .deb (Debian / Ubuntu / Pop!_OS)

Built by CI: `.github/workflows/release-linux.yml` runs `tauri build`
on **ubuntu-22.04** with `--bundles deb,appimage` and attaches
`src-tauri/target/release/bundle/deb/*.deb` to the draft release for each
`v*` tag. Install with:

```sh
sudo apt install ./ccez-llm_0.1.0_amd64.deb
```

`apt install ./file.deb` (not `dpkg -i`) resolves the runtime deps below
automatically. The stock Tauri .deb already declares `libwebkit2gtk-4.1-0`
and `libgtk-3-0` (plus `libappindicator3-1` when the tray is used); extra
deps can be appended via `bundle.linux.deb.depends` (see patch).

Why 22.04 and not `ubuntu-latest`: the binary links against the build
host's glibc, so building on the oldest supported base keeps it runnable on
newer systems. Building on 24.04+ raises the minimum glibc and breaks older
installs with `version 'GLIBC_*' not found`. Same rule applies to Asahi
Fedora Remix / Debian-on-Asahi users: prefer the CI-built .deb over a local
build on a newer toolchain.

## AUR (Arch Linux)

Use the `-bin` package — it repackages the official CI-built .deb, so no
compilation and no webkit build toolchain needed:

```sh
git clone https://aur.archlinux.org/ccez-llm-bin.git
cd ccez-llm-bin
makepkg -si
# or: yay -S ccez-llm-bin
```

Source: `packaging/aur/PKGBUILD`. Details:

- Downloads `ccez-llm_${pkgver}_amd64.deb` from the GitHub release tag
  `v${pkgver}` plus the `LICENSE` file; replace both `SKIP` checksums with
  `updpkgsums` output before submitting to the AUR.
- `depends=('webkit2gtk-4.1' 'gtk3' 'libappindicator-gtk3' 'librsvg'
  'openssl')` — pacman cannot see .deb metadata, so the WebKitGTK runtime
  (mandatory for every Tauri v2 app) is declared explicitly.
- Adds a `ccez-llm` → `ccez-studio` symlink in `/usr/bin` and installs the
  license under `/usr/share/licenses/ccez-llm-bin/`.
- After bumping `pkgver`, regenerate AUR metadata on an Arch box:
  `makepkg --printsrcinfo > .SRCINFO` (cannot be done on macOS — no
  `makepkg` here).

## AppImage (distro-agnostic fallback)

The same CI job builds `*.AppImage` via `--bundles appimage`. Run it with:

```sh
chmod a+x ./*.AppImage
./Ccez_LLM_*.AppImage
```

Notes (per the [Tauri AppImage guide](https://v2.tauri.app/distribute/appimage/)):

- The AppImage bundles most deps but still expects a WebKitGTK 4.1-capable
  host; oldest-supported-base rule from the .deb section applies — that is
  why CI builds on ubuntu-22.04.
- This app does not currently need audio/video playback, so
  `bundle.linux.appimage.bundleMediaFramework` stays `false` (it would pull
  gstreamer into the bundle and is only fully supported on Ubuntu builders).
  If media playback is added later, flip it to `true` in the patch below.
- Updater artifacts (`*.AppImage.tar.gz` + `.sig`) are produced because
  `createUpdaterArtifacts` is already `true`; they are signed only when the
  `TAURI_SIGNING_*` secrets are configured (same secrets as `release.yml`).

## System dependencies

Build-time packages (also installed verbatim by `release-linux.yml`).
Sources: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/),
Debian/AppImage guides.

Debian / Ubuntu / Pop!_OS:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Arch (only needed to build from source; `-bin` users skip this):

```sh
sudo pacman -Syu
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg \
  xdotool
```

Fedora / Asahi Fedora Remix (source builds only):

```sh
sudo dnf install webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libxdo-devel
sudo dnf group install "c-development"
```

## Required tauri.conf.json patch

**Owned by another agent — report only, do NOT apply.** Merge this
`bundle` delta into `src-tauri/tauri.conf.json` (has
`productName: "Ccez LLM"`, `identifier: "studio.ccez.app"`, version
`0.1.0`, `bundle.targets: "all"`, no `category`, no `bundle.linux`;
note a sibling track has added a `bundle.windows` block — add `linux`
alongside it, key order irrelevant):

```diff
   "bundle": {
     "active": true,
     "targets": "all",
     "createUpdaterArtifacts": true,
+    "category": "Education",
+    "shortDescription": "BYOK desktop chatbot with language-learner aids",
+    "longDescription": "Ccez LLM is a Tauri + SvelteKit desktop chatbot with language-learner aids.",
+    "linux": {
+      "deb": {
+        "depends": [
+          "libwebkit2gtk-4.1-0",
+          "libgtk-3-0",
+          "libayatana-appindicator3-0"
+        ]
+      },
+      "appimage": {
+        "bundleMediaFramework": false
+      }
+    },
     "icon": [
       "icons/32x32.png",
       "icons/128x128.png",
```

Rationale per key:

- `category: "Education"` — freedesktop category for the generated
  `.desktop` `Categories=` entry; the app is a language-learning aid
  (a reference copy lives at `packaging/ccez-llm.desktop`).
- `shortDescription` / `longDescription` — feed the .deb control file
  `Description:` field; currently unset.
- `linux.deb.depends` — pins the exact runtime libs the stock bundler
  emits (`libwebkit2gtk-4.1-0`, `libgtk-3-0` per the
  [Debian guide](https://v2.tauri.app/distribute/debian/)) plus the
  ayatana indicator lib for tray support.
- `linux.appimage.bundleMediaFramework: false` — explicit opt-out of the
  gstreamer payload; flip to `true` if media playback lands.
- `targets` stays `"all"` so macOS/Android jobs are unaffected; the Linux
  job selects `--bundles deb,appimage` on the CLI instead.

## Verification status

Checked on macOS (Darwin arm64) 2026-09-10:

- `release-linux.yml` parses as valid YAML (`python3 -c yaml.safe_load`)
  and uses only existing repo paths (`src-tauri/target/...` output globs,
  `oven-sh/setup-bun@v2`, `tauri-apps/tauri-action@v1` — same pins as the
  existing `release.yml`).
- `packaging/aur/PKGBUILD` follows `makepkg` conventions by inspection
  (`pkgname -bin`, `arch=('x86_64')`, `!strip`, `bsdtar` two-step .deb
  extraction, matching `sha256sums` entries).

NOT verifiable on this host (no Linux tooling: `dpkg-deb`,
`desktop-file-validate`, `appimagetool`, `makepkg` all absent):

- actual `tauri build --bundles deb,appimage` output and .deb contents;
- `desktop-file-validate packaging/ccez-llm.desktop`;
- `makepkg --printsrcinfo` / `.SRCINFO` generation and `namcap` lint of
  the PKGBUILD;
- end-to-end `release-linux.yml` run (needs a `v*` tag push + secrets).
