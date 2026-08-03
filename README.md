# DriverPick

A Windows desktop app that finds the correct printer driver **better than Windows' built-in
Add Printer flow**, installs it, and sends a test page.

Proof-of-concept for driver-selection quality: no accounts, no backend, no telemetry, no
bundled driver binaries. Everything runs locally; drivers are fetched at runtime from the
Microsoft Update Catalog.

## Build

```bash
npm install
npm run dev        # hot-reloading dev session (Electron + Vite)
npm run test       # unit tests (catalog scraper, ranking, INF parser)
npm run typecheck  # strict TypeScript across main + renderer
npm run dist       # produces dist/DriverPick-Setup.exe (NSIS) and dist/DriverPick-Portable.exe
```

Both Windows targets are built with `requestedExecutionLevel: requireAdministrator` — driver
installation needs elevation, so the whole app prompts UAC on launch. `npm run dist` must be
run on Windows (or a wine-equipped CI) to produce the exe targets.

## How it works

### 1 · Discover

Runs four discovery mechanisms in parallel on launch (rescan any time):

- **mDNS** — browses `_ipp._tcp`, `_pdl-datastream._tcp`, `_printer._tcp`. The `ty`/`product`
  TXT records give the exact make/model; `pdl` lists supported page description languages.
- **SNMP v2c/v1** (community `public`) across the local /24 — `sysDescr`, `hrDeviceDescr`,
  and the prtGeneral printer name (`.1.3.6.1.2.1.43.5.1.1.16.1`).
- **TCP probe** of ports 9100/631 — finds print hosts that answer neither of the above.
- **USB** — `Win32_PnPEntity` filtered to the printer class and `USBPRINT\` instances,
  capturing the **full HardwareIDs array** (the highest-value data we collect).

Results are merged and deduplicated by IP / device ID. No SNMP or mDNS response is treated as
normal, not an error. A free-text make/model box covers printers we can't reach yet.

### 2 · Select driver — the ranking

The Microsoft Update Catalog has no API, so DriverPick scrapes it politely (one request at a
time, in-memory session cache). It searches by hardware ID when one exists **and** by
normalized make/model, then merges and ranks:

| Signal | Score |
| --- | --- |
| Exact hardware ID match (catalog metadata, re-verified against the INF at install time) | **+100** |
| Title contains the exact model token (`M404dn`), incl. range titles (`M404-M405`) | **+50** |
| Newer version/date among otherwise-equal candidates | **+20** |
| "series" / "universal" / "class" driver (kept, ranked below model-specific) | **−20** |
| Microsoft IPP Class Driver | always shown, pinned **last**, labeled "what Windows would likely install by default" |

Hard filters: architecture must match the host (x64/ARM64) and the OS applicability must
include the running Windows version. Every candidate shows its score, version, date, size and
a one-line reason. The top pick is preselected — the user always confirms; nothing is chosen
silently.

Download URLs are resolved with the well-known `DownloadDialog.aspx` POST used by
PSWindowsUpdate, yielding `.cab` files on `download.windowsupdate.com`.

### 3 · Install

Every command and its full output streams to the always-visible log pane and to a log file
(next to the exe for the portable build, else `%LOCALAPPDATA%\DriverPick\logs`). The pane has
Copy (whole log to clipboard) and Open folder buttons for pasting diagnostics into tickets.
If the app is somehow running without elevation (e.g. `npm run dev`), a banner warns that
driver installation will fail before anything is attempted.

1. Download the `.cab`, check size against catalog metadata.
2. `expand.exe -F:* driver.cab <dest>`.
3. **INF verification (the differentiator):** parse the extracted INF `[Models]` sections and
   confirm the device's hardware ID (or model string for network/manual printers) actually
   appears. On a mismatch the app warns loudly and recommends the next candidate — installing
   anyway requires an explicit override.
4. `pnputil /add-driver <inf> /install` (published `oemNN.inf` name captured for rollback).
5. `Add-PrinterDriver` with the INF model name, then `Add-PrinterPort` (RAW 9100,
   `IP_<addr>`) + `Add-Printer` for network printers, or reuse of the existing `USB00x` port
   for USB. Already-staged drivers, existing ports and printer-name collisions are handled
   idempotently (name collisions get a numeric suffix).

Each candidate also links straight to its page on the Microsoft Update Catalog
("view in catalog ↗") so the pick can be verified independently, and driver downloads
report live progress (MB received / total).

### 4 · Verify

- Test page via CIM `Win32_Printer.PrintTestPage`, falling back to
  `rundll32 printui.dll,PrintUIEntry /k /n "<printer>"`.
- Final state shown: printer, driver + version, port, staged package, INF verification result.
- **"Remove what I just did"** reverts everything: `Remove-Printer`, `Remove-PrinterPort`
  (only if DriverPick created it), `Remove-PrinterDriver`, `pnputil /delete-driver`.

## Check for updates

The header has a manual **Check for updates** button. It queries this repository's GitHub
Releases; when a newer tag exists it downloads the latest exe (portable preferred) to the
Downloads folder. No background polling, no auto-install.

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds both exes on
`windows-latest` and attaches them to the GitHub release — that's what the button consumes.

## Project structure

```
src/main            Electron main process — all shell/SNMP/scraping work
  discovery/        mDNS, SNMP, TCP probe, USB (PowerShell), merge/dedupe
  catalog/          catalogClient.ts (isolated scraper, unit-tested), ranking.ts, search.ts
  install/          download → expand → INF parse/verify → pnputil → printer setup; rollback
  verify/           test page
src/preload         contextBridge exposing the typed DriverPickApi
src/renderer        pure-UI React app (4 screens + log pane)
src/shared/types.ts typed IPC contract shared by both sides
tests/              vitest units with fixture HTML for the catalog scraper
```

## Known limitations

- **Catalog scraping is inherently fragile.** The parser is isolated in
  `src/main/catalog/catalogClient.ts` with fixture-based tests; if Microsoft changes the page
  layout, the app shows a clear error plus a link to the same search on the catalog website.
- Catalog metadata rarely includes hardware IDs, so the +100 signal usually comes from the
  INF verification stage; the catalog-side score then relies on model tokens.
- SNMP sweep covers the local /24 only; printers on other subnets need the manual search.
- Multi-function devices: print driver only — no scanner/fax software is installed.
- `.exe` self-extracting driver packages (rare in the catalog for drivers) are not handled —
  only `.cab`.
- pnputil "Published Name" parsing is locale-dependent (best effort on non-English Windows;
  rollback of the staged package may require manual `pnputil /enum-drivers`).
- USB port detection assumes the standard `USB00x` port naming.
