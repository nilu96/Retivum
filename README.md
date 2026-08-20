# Retivum

Retivum is a local-first Reticulum and LXMF messenger built with Svelte. The same application is intended to run in current browsers, Capacitor on iOS and Android, and Electron on macOS, Windows, and Linux.

The durable product and system architecture lives in [docs/architecture.md](docs/architecture.md). Repository-specific implementation guidance lives in [AGENTS.md](AGENTS.md).

The `leviculum_wasm` folder contains the built WebAssembly artifacts from [Leviculum](https://codeberg.org/Lew_Palm/leviculum).

## Current implementation status

The initial application foundation includes:

- a Svelte 5, TypeScript, and Vite client-only application;
- adaptive desktop sidebar and mobile bottom-tab navigation;
- Chat, NomadNet, Tools, and Settings views with Reticulum logs, Path management, Remote provisioning, local serial/BLE RNode configuration, live status, and raw destination probing available from the Tools directory;
- a bundled typed English localization catalog used by all GUI components;
- IndexedDB-backed application preferences, NomadNet directories, and persistent heterogeneous interface definitions;
- a capability-filtered interface registry with editable WebSocket, RNode LoRa (BLE/Web Serial), native TCP, and native UDP configurations, including per-interface IFAC network-name, passphrase, and optional size controls with media-appropriate Leviculum defaults;
- one shared RNode KISS implementation with firmware/radio negotiation, flow control, MTU enforcement, heartbeat, and platform byte-stream adapters;
- a capability-gated local RNode configuration tool that reuses authorized/configured Web Serial or BLE devices across browser, Capacitor, and Electron transports, automatically recovers interrupted serial maintenance sessions, temporarily claims live interfaces, exposes the standard RNode KISS node configuration (device, radio/boot mode, Bluetooth, Wi-Fi, display, and EEPROM), optionally consumes microReticulum-compatible local schema provisioning, and restores the interface on exit;
- Capacitor BLE, TCP, and UDP adapters for iOS/Android plus a minimal sandboxed Electron shell with native BLE, Web Serial, `node:net`, and `node:dgram` main/preload bridges;
- the bundled Leviculum/LXMF WASM running in a dedicated module worker;
- first-run Reticulum identity generation plus AES-GCM-encrypted private-key and runtime-snapshot persistence;
- persistent multi-identity management with add, edit, activate, delete, standard 64-byte Reticulum identity import/export, and legacy Retivum JSON import compatibility;
- a bounded current-session Reticulum log viewer for WASM, persistence, and WebSocket diagnostics;
- real binary WebSocket interface drivers, including simultaneous configured interfaces and bounded text-frame compatibility;
- live LXMF delivery-announce and inbound-message projection from the WASM worker into persistent, identity-scoped Chat directories and conversation history;
- outbound LXMF composition with recipient-identity discovery before queueing, direct or opportunistic primary delivery, optional propagation fallback after terminal failure, persistent delivery-state updates, stable message IDs, and open-link reuse;
- manual, interval-based, or optional app-resume retrieval of waiting LXMF messages from a configured propagation node, independently of whether propagation sending is enabled; interval synchronization defaults to never and resume synchronization defaults to off;
- persistent identity-scoped contacts with local custom names, including announce-name prefilling;
- persistent global NomadNet announces plus identity-scoped bookmarks with searchable local names;
- live NomadNet page requests over reusable Reticulum links, bounded resource handling, Micron rendering, and same-node or announced cross-node page navigation;
- native Reticulum provisioning for announced microReticulum management destinations, including schema-driven settings, staged save/commit, discard, reboot, and factory reset without an `rnsapid` WebSocket dependency;
- direct/opportunistic LXMF delivery preferences plus explicitly enabled, hash-validated propagation-node routing;
- manual and configurable automatic LXMF destination announcements, plus offline-generated interoperable LXMA address QR codes;
- generated Capacitor 8 projects for iOS and Android using `de.nilu96.retivum`;
- unit tests, Svelte diagnostics, and a production build.

NomadNet form submission and page caching, the PWA offline cache, native secure-vault storage adapters, and signed Electron distribution packaging remain subsequent implementation slices. Remote provisioning is experimental and requires firmware that announces `rnstransport.remote.management` and authorizes the active Retivum identity.

## Development

Requirements:

- Node.js 24 or newer
- npm 11 or newer
- Xcode 26 or newer for iOS development
- Android Studio 2025.2.1 or newer, its bundled supported JDK, and Android SDK 36 for Android development

The standalone Java 26 installation currently selected on this workstation is newer than the generated Gradle 8.14.3 toolchain supports. Run Android builds through Android Studio or point `JAVA_HOME` at Android Studio's bundled JDK.

Install and verify:

```sh
npm install
npm run check
npm test
npm run build
```

Run the browser development build:

```sh
npm run dev
```

Build and run the local Electron desktop shell:

```sh
npm run desktop:run
```

This command rebuilds Noble only on macOS and Windows, refreshes `dist/`, and launches Electron. Linux uses Noble's JavaScript D-Bus backend and therefore skips native compilation. The Electron shell loads the same bundled assets without an application web server. TCP and UDP are available through validated `node:net` and `node:dgram` bridges. RNode BLE uses a fixed-service native bridge so bonded devices can be rediscovered after restart; RNode serial selection continues to use Electron's Web Serial permission events.

Create an unsigned distributable for the current desktop platform and architecture:

```sh
npm run desktop:package
```

The platform-specific aliases are `desktop:package:mac`, `desktop:package:win`, and `desktop:package:linux`; each must run on its matching operating system. Artifacts are written to `release/`. GitHub Actions builds macOS x64/arm64, Windows x64, and Linux x64/arm64 artifacts. These development artifacts are not signed or notarized; signing and the remaining release-security requirements must be completed before public distribution.

Synchronize the production web assets into both mobile projects:

```sh
npm run native:sync
```

Open a native project after synchronizing:

```sh
npm run ios:open
npm run android:open
```

Development live reload is not configured in `capacitor.config.ts`; native builds consume the local `dist/` assets.

## Data and security status

The browser build generates a non-extractable AES-GCM wrapping key and stores it with the encrypted private identity key and encrypted runtime snapshot in origin-bound IndexedDB. This protects the private bytes at rest, but any code executing under the same browser origin can use the wrapping key; the Settings screen discloses this weaker browser protection. User-requested identity exports necessarily contain an unencrypted private key and show a confirmation plus persistent warning. Native Keychain, Keystore, and desktop secure-storage adapters are still required before production native distribution. Messages, settings, interface configurations, announces, bookmarks, and bounded session logs intentionally remain plaintext inside the application sandbox for v1; interface configurations include plaintext IFAC passphrases.

## License

Retivum is licensed under `AGPL-3.0`. The bundled Leviculum-derived WASM is also AGPL-licensed.
