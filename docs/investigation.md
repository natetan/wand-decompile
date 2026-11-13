# Investigation record

Investigated on November 12, 2026. Initial failures and the later successful test are separate observations.

## Artifact identities

| Artifact | Original SHA-256 |
| --- | --- |
| Wand 12.72.0 `resources/app.asar` | `5abf4b22cb0d8ad2329637c7c686d8b7efc8bb04304437c248067e0e24e123d5` |
| `WandAuxiliaryService.exe` | `1755e5306e3d28f6b92106c7b99abf36575f807862a89e4ba9fef738edda53fc` |
| Parent signed Wand launcher | `a0957390f8cf0eadcf9e2268c7147494a1fc9761807e24c81c6fd7b7a1c5f7eb` |

These bind the builder to one investigated release. Version labels alone are insufficient to authorize a byte patch.

## Local and remote boundaries

- The local daily-timer module tracks playtime on trainer activation, computes remaining time, publishes expiry, and reloads the trainer on expiration. Policy settings come from account data; its fallback allowance is 7,200 seconds.
- Account data, trainer selection, trainer binaries, and rewarded-ad progress use server APIs. Cached native trainer DLLs and injection execute locally.
- The first build's passing Electron archive hashes did not prove that the native helper would trust the client.

REA parent application evidence: `ev_53a583ac56cfc553034cf1c77b6c574c7f090e8dff0862f3a88d16c0d673d826`. Timer asset view: `ev_4c3ec82f9a782d9a75753119a3265b9118600a523b7279f5ed7ab38b965e5f0f`. API asset view: `ev_fdd9b538fd9c6ff1453e513b16bc9b961fc6442269e38c03c125ea2effaf5e24`.

The application analysis parsed 591 JavaScript files without parse failures. Expanded semantic coverage was partial because of resource budgets. Several unpacked native members contradicted their archive integrity metadata; inspection used record-and-continue, so those mismatches were retained as limitations, not interpreted as proof of tampering. Evidence IDs identify the original analysis session; that session is not embedded in this repository.

## Why trainer loading failed

The failed runtime logs reported `InjectDll: Client integrity check failed` before trainer activation. Windows Authenticode reported `HashMismatch` for the modified client executable, while the installed original and unmodified helper had valid signatures.

REA managed classification evidence: `ev_1fc3354c6b5b6e0db10be79070e174ad249eec904e13f73f64409f46ca920867`. Its metadata representation budget prevented complete managed inspection. Supplementary CIL inspection used .NET `PEReader`/`MetadataReader` without loading or executing the application's managed code.

Build-local method tokens established the following path:

- `06000084` imports `WinVerifyTrust`; wrapper `06000085` returns its result.
- `06000086` rejects failed trust results, then extracts the certificate and computes a SHA-256 certificate identity. `06000087` supplies a signer allowlist.
- `060000C4` obtains the named-pipe server PID and executable path. `060000C3` checks caller identity, signer, and the loaded system `version.dll`, then invokes further validation.
- `06000097` combines executable-image, archive, and installation-layout checks. `06000099` compares the archive-header hash with the executable's integrity resource. `0600009A` expects an `app-*` directory and validates its parent `Wand.exe` launcher.

Tokens and offsets are specific to this exact helper, not stable names for future releases.

## Applied native change

In the copied helper, method `06000085` ends with CIL `ldloc.s 7; ret`. At file offset `0x2741`, bytes `11 07` were replaced by `16 00`, producing `ldc.i4.0; nop; ret`. The wrapper still calls `WinVerifyTrust` and disposes its resources, but returns success instead of the Windows trust result. Patched helper SHA-256: `354c1f2288035f5e07e3118849f41e33829584ebbea78b481d2c1b3796baa97e`.

This is a helper-wide trust-result override. It is not an exception restricted to one modified client hash. The signer-certificate allowlist and subsequent checks were not modified. The output directory layout was corrected separately; both changes matter to the successful result. Modified publisher signatures are no longer valid.

## Runtime result and limits

The successful Slay the Spire 2 log recorded `DLL injection succeeded`, `Trainer started successfully via Tophat`, `Trainer fully initialized`, `Ready for user input`, and `trainerActive: true`. Two assembly warnings occurred before readiness, so not every option was established by the log alone.

The user subsequently confirmed working cheats in Slay the Spire 2 and reported that Mirage worked perfectly. The timer/ad patches remained in the active archive. A session longer than two hours, every ad placement, every option, and every future game have not been independently verified. Sponsored dashboard promotions can still appear.

Raw logs, extracted proprietary code, full call-edge dumps, and obsolete exploration scripts remain in the ignored local `analysis/` directory. They are not required to run the consolidated builder.

## Local pinning addition

The desktop pinning context is module `5473` in `app-b37ddaa5.39a1bc99821fabdf810c.bundle.js`. Its dedicated `canUsePinnedMods` getter gates pinning; the shared icon uses that getter to decide whether to invoke an upgrade prompt. Overlay counterparts in the `app-3d588d45` and `overlay-3d588d45` bundles forward pin changes to the host.

The builder changes only these pin-specific getters. It replaces `getPinnedMods`/`updatePinnedMods` in `app-f05ae505.07e6c696900b386d304c.bundle.js` with local per-game storage, saves before updating the visible pin state, and restores the local selection when initializing a trainer. `profile/App/local-pins.json` is written through a temporary file and replacement. Collection methods and account-level Pro/subscription checks are unchanged. The profile remains the storage boundary; pin preferences are not synchronized through Wand's pin API.

Validation included pin/unpin ordering, separate game keys, malformed data, failed storage writes, and execution of the actual patched service methods without an API object. The updated archive's 801 packed member hashes validate. The desktop pin button was observed adding Unlimited HP to a Pinned section without opening an upgrade prompt. The local helper is unchanged from the previously tested trainer build.

The final file-backed implementation restored that test pin after a complete application restart. Unpinning cleared the saved game selection, and the temporary test pin was removed. An earlier browser-storage prototype failed the restart test and was replaced before delivery. The in-game overlay pin control shares the host pin path but has not been separately exercised in a running game.
