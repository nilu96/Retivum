# Retivum repository guidance

This file applies to the entire repository. It contains operational context for coding agents and maintainers. Product behavior and durable architecture belong in `README.md` and `docs/architecture.md`; machine-specific source locations, generated-artifact details, implementation notes, and working conventions belong here.

## Project summary

Retivum is a local-first Svelte 5, TypeScript, and Vite client for Reticulum and LXMF. The same application assets run in current browsers, Capacitor on iOS/Android, and a sandboxed Electron shell on macOS/Windows/Linux.

Keep these boundaries intact:

- There is no Retivum application backend, bundled Reticulum endpoint, runtime CDN, or production localhost server.
- One dedicated module worker owns the mutable Leviculum `ReticulumNode`, LXMF router, runtime interface indexes, ticks, and persistence snapshots.
- Retivum can store multiple identities but runs exactly one active identity/node/router at a time.
- Feature components use app-owned ports and stores. Do not import Electron, Capacitor, browser device handles, or generated WASM internals directly into feature code.
- Remote packets, announces, labels, LXMF fields, NomadNet pages, provisioning responses, imported files, and transport errors are untrusted input.
- Private identity material and runtime snapshots are sensitive. Do not log them or include them in ordinary support exports.
- All user-facing strings, including accessibility text and errors, go through the bundled localization catalog. English source strings live in `src/i18n/locales/en.json`.

## Start here

- `README.md` describes the product, current implementation status, development prerequisites, and public security status.
- `docs/architecture.md` records durable product boundaries, system architecture, platform behavior, security rules, and release requirements.
- `package.json` is authoritative for JavaScript dependencies and runnable npm scripts.
- `src/workers/reticulum.worker.ts` is the central Reticulum/LXMF runtime owner.
- `src/infrastructure/reticulum/protocol.ts` is the typed UI/worker/platform message contract.
- `src/infrastructure/reticulum/runtime.ts` is the renderer-side runtime facade and reactive state bridge.
- `src/infrastructure/platform/` owns RNode, TCP, UDP, BLE, serial, and native-shell adapters.
- `src/domain/` owns durable application types and policy that should remain independent of Svelte and platform APIs.

## Repository source map

- `src/app/`: composition, routes, and application lifecycle.
- `src/features/`: user-facing Chat, NomadNet, Tools, and Settings features.
- `src/domain/`: app-owned records, normalization, state rules, and security policy.
- `src/i18n/`: localization service and bundled catalogs.
- `src/infrastructure/database/`: IndexedDB repositories and persistence coordination.
- `src/infrastructure/platform/`: browser, Capacitor, and Electron transport/platform adapters.
- `src/infrastructure/reticulum/`: worker protocol, renderer facade, WASM-facing helpers, and runtime state.
- `src/lib/`: shared Svelte components and utilities.
- `src/styles/`: application-wide styles and responsive layout rules.
- `src/workers/reticulum.worker.ts`: sole owner of the live Leviculum node.
- `electron/`: sandboxed main/preload boundary and validated desktop device/socket bridges.
- `android/` and `ios/`: generated and maintained Capacitor projects.
- `leviculum_wasm/`: generated `wasm-bindgen` output consumed by Retivum; do not hand-edit.

Tests are colocated as `*.test.ts` files. Prefer adding focused tests beside the code being changed.

## Local Leviculum and reference implementations

The local Leviculum checkout is:

`/Users/nils-lucas/Downloads/leviculum`

Use that checkout before internet research when answering protocol questions or implementing Reticulum, LXMF, RNode, KISS, NomadNet, or WASM changes. It contains both the Rust implementation and local mirrors of the reference Python implementations.

### Leviculum implementation sources

- `leviculum-core/`: no-std Reticulum core and protocol logic.
- `leviculum-core/src/rnode.rs`: RNode/KISS command constants plus shared telemetry decoders.
- `leviculum-std/src/interfaces/rnode.rs`: standard RNode interface, KISS framing, telemetry application, flow control, timers, and tests.
- `leviculum-wasm/`: WASM facade source used to generate Retivum's bundled output.
- `leviculum-lxmf/`: LXMF implementation used by the WASM facade.
- `docs/src/rnode-protocol.md`: consolidated KISS/RNode protocol guide, payload layouts, telemetry cadence, battery states, channel statistics, and captured behavior.

For RNode status work, inspect all three of `docs/src/rnode-protocol.md`, `leviculum-core/src/rnode.rs`, and `leviculum-std/src/interfaces/rnode.rs`. The protocol includes, among others:

- `CMD_STAT_RX` (`0x21`) and `CMD_STAT_TX` (`0x22`) packet counters;
- `CMD_STAT_RSSI` (`0x23`) and `CMD_STAT_SNR` (`0x24`);
- `CMD_STAT_CHTM` (`0x25`) airtime, channel-load, current-RSSI, noise-floor, and interference values;
- `CMD_STAT_PHYPRM` (`0x26`) physical-layer timing parameters;
- `CMD_STAT_BAT` (`0x27`) battery state and percentage;
- `CMD_STAT_CSMA` (`0x28`) and `CMD_STAT_TEMP` (`0x29`).

Do not infer payload layouts from command names. Use the protocol guide and reference decoders, including the single-interface versus multi-interface differences.

### Python reference sources

The complete Python Reticulum reference is under `reference/Reticulum/`. Important files include:

- `reference/Reticulum/RNS/Interfaces/RNodeInterface.py`: authoritative Python RNode KISS host behavior and telemetry decoding.
- `reference/Reticulum/RNS/Interfaces/Android/RNodeInterface.py`: Android-specific reference behavior.
- `reference/Reticulum/RNS/Interfaces/RNodeMultiInterface.py`: multi-interface RNode framing and telemetry differences.
- `reference/Reticulum/RNS/Interfaces/KISSInterface.py`: generic KISS interface behavior.
- `reference/Reticulum/RNS/Interfaces/Interface.py`: generic byte counters, interface modes, announce queues, and incoming/outgoing announce-frequency calculations.
- `reference/Reticulum/RNS/Reticulum.py`: interface construction and exported interface statistics.
- `reference/Reticulum/RNS/Utilities/rnstatus.py`: reference presentation and names/units for interface statistics.
- `reference/Reticulum/RNS/Packet.py`, `Transport.py`, `Link.py`, and `Resource.py`: packet, routing, link, and resource semantics.

Additional local references:

- `reference/RNode_Firmware/`: firmware-side KISS behavior and emitted telemetry.
- `reference/RNode_Firmware/Python Module/RNode.py`: standalone Python RNode host implementation.
- `reference/LXMF/LXMF/`: Python LXMF reference, especially `LXMRouter.py`, `LXMessage.py`, and `LXMF.py`.
- `reference/LXST/`: LXST reference implementation.

Treat these reference directories as read-only unless the task explicitly asks to update the Leviculum checkout. Retivum changes belong in this repository; Leviculum changes belong in its own checkout and build flow.

### Source state and provenance caution

The local Leviculum checkout currently reports version `0.7.1`, origin `https://codeberg.org/nilu96/leviculum.git`, upstream `https://codeberg.org/Lew_Palm/leviculum.git`, and Git commit `216c44f0505dee8e1790a675496f3a3dd57aa761`. The generated WASM below was rebuilt from this committed `feat/wasm` source with a clean Leviculum worktree. This source includes optional `interfaceIndex` targeting for `announceLxmf()`.

If provenance matters, capture the complete dirty source state or create an immutable commit/archive before publishing a rebuilt artifact.

## Generated Leviculum WASM

`leviculum_wasm/` contains vendored/generated `wasm-bindgen` output. Never edit these files by hand:

- `leviculum_wasm.js`
- `leviculum_wasm_bg.wasm`
- `leviculum_wasm.d.ts`
- `leviculum_wasm_bg.wasm.d.ts`

Current fingerprints:

| Artifact | SHA-256 |
| --- | --- |
| `leviculum_wasm.js` | `2ccdd05f46d6b95b4ef23ef92afd066bb70bb02063bf903e9a1a6c3b2d26859f` |
| `leviculum_wasm_bg.wasm` | `8f48e01aa3eaef095d7f2803be87346c2ef41c0048f89e2d6a9f466e34693f82` |
| `leviculum_wasm.d.ts` | `d142050185cd595c1c88e588313f524e8f091e0dd74cf60bf17b4528151013ce` |
| `leviculum_wasm_bg.wasm.d.ts` | `e07a872c38ff5d585a3f20131ba74152293001b8ad55a1340fb6fec673f43692` |

The current build was produced with Rust 1.95.0 and `wasm-bindgen` 0.2.126. From the Leviculum checkout, the documented development build is:

```sh
cargo build -p leviculum-wasm --target wasm32-unknown-unknown
wasm-bindgen --target web \
  --out-dir /Users/nils-lucas/Downloads/ReticulumChat/leviculum_wasm \
  target/wasm32-unknown-unknown/debug/leviculum_wasm.wasm
```

Rebuilding overwrites generated application inputs. Do it only when the task requires a Leviculum API/core change, review the generated diff and hashes, and run the complete Retivum validation suite afterward. A release needs an immutable source reference or archive, license metadata, exact toolchain/profile/features, rebuild command, API version, and generated hashes.

## Leviculum runtime constraints

The current generated API imposes these constraints:

- `transportEnabled` is constructor-only; changing it requires a controlled runtime rebuild.
- Retivum's vendored build exposes `ReticulumNode.transportedPacketCount()`, backed by `Node::transport_stats().packets_forwarded()`. The corresponding local source method is in `/Users/nils-lucas/Downloads/leviculum/leviculum-wasm/src/lib.rs`; preserve it when rebuilding or upstream the binding first.
- Interfaces can be added and marked online/offline, but cannot be removed or updated live; edits and deletion require a controlled runtime rebuild.
- Stable application interface UUIDs are distinct from runtime numeric indexes returned by `addInterface()`.
- WebSocket endpoint/TLS/reconnection behavior belongs to the host driver, not WASM.
- Exported persistent state contains identity private material and must be encrypted before durable storage.
- WASM storage is memory-backed; the host must persist validated snapshots.
- Stamp work and runtime ticks must remain off the UI thread.
- The WASM exports generic link/request/resource primitives, not a complete NomadNet client.
- One `ReticulumNode` owns one identity and LXMF router.

Wrap generated `any` values at the worker boundary. Do not let untyped WASM options, events, actions, or persistence payloads spread through feature code.

## Current implementation notes

These notes describe code behavior that is useful while modifying the implementation but should not be treated as the public product specification:

- The worker classifies `announceReceived` events using the bundled LXMF parsers and projects recognized destinations into reactive state before IndexedDB persistence.
- Incoming LXMF messages follow the same UI-first, durable-follow-up flow. Overlapping identity-directory loads merge rather than replace live events.
- Outbound LXMF uses the WASM router queue, preserves stable logical messages across propagation fallback, and reuses active direct or identified backchannel links.
- User contact names are local metadata, take precedence over announce labels, and are never transmitted.
- NomadNet root requests normalize to `/page/index.mu`; the worker reuses links, bounds page resources to 1.05 MB, unwraps MessagePack response values, and decodes binary/string payloads as UTF-8.
- NomadNet links stay live only in worker memory. They are not serialized across application or runtime restarts. Form submission and persistent page caching remain future work.
- Same-node NomadNet navigation resolves locally; cross-node navigation requires a known public key, normally learned from an announce.
- Provisioning reads may recover once after a broken established link. Mutating provisioning operations are never automatically replayed because the firmware protocol has no idempotency key or duplicate-request cache.
- The current Electron development shell loads built `dist/index.html` directly. Production packaging still requires the reviewed secure local scheme, vault integration, signing, and packaged lifecycle/security verification.

## Change rules

- Preserve unrelated user changes. The worktree may already be dirty.
- Update persistent schema versions and normalization/migration paths together. Test both new and legacy records.
- Keep runtime status separate from persisted interface configuration.
- Keep application interface IDs stable across worker/node rebuilds; never expose runtime indexes to UI or storage.
- Keep RNode KISS logic centralized in `src/infrastructure/platform/rnode-host.ts`; BLE and serial adapters should remain byte transports.
- Keep TCP HDLC framing and UDP datagram boundaries above platform-specific socket adapters.
- Never add browser-only APIs without capability checks and equivalent native behavior or an explicitly hidden unsupported feature.
- Never weaken TLS, Electron sandboxing, sender validation, CSP, navigation restrictions, or permission policies to make a test endpoint work.
- Do not inject NomadNet content with `{@html}`, iframe privileges, `eval`, or dynamic remote modules. Parse into bounded application-owned structures.
- Avoid persisting live device objects, browser handles, native plugin objects, or runtime interface indexes.
- Prefer stable error codes across worker/platform boundaries and localize them in the UI.

## Validation

Use the smallest relevant checks while iterating, then run the full standard suite for completed changes:

```sh
npm run check
npm test
npm run build
```

Useful commands:

```sh
npm run dev
npm run test:watch
npm run desktop:run
npm run native:sync
npm run ios:open
npm run android:open
```

`predev` and `prebuild` regenerate application icons. Native projects consume local `dist/` assets; Capacitor live reload is not configured.

When changing protocol/runtime code, test at least:

- worker protocol serialization and event normalization;
- reconnect and controlled-restart behavior;
- snapshot export/import and persistence failure paths;
- multiple simultaneous interfaces and stable-ID routing;
- malformed, oversized, duplicated, and late inputs;
- any matching behavior against the local Python reference implementation.

When changing RNode/KISS behavior, add byte-level fixtures for escaping, fragmentation, concatenated frames, exact payload lengths, unsolicited telemetry, reset/error frames, and both supported connection types. Compare units and signed/unsigned conversions with the local protocol guide and Python decoders.
