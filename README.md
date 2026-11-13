# Wand local build

A Windows-only experiment that builds a separate local Wand/WeMod copy from an installed, supported release. It disables the daily playtime timer and the identified display/rewarded-ad paths, while retaining working trainer loading. Your normal Wand installation is the input and is not modified.

The repository contains the builder and research notes. It does **not** contain Wand executables, trainers, extracted application code, account profiles, or logs. Those stay under ignored local directories.

## Current status

- Supported and investigated application: **Wand 12.72.0**, pinned to exact archive, helper, and launcher hashes.
- User-tested: cheats work in **Slay the Spire 2** and **Assassin's Creed Mirage**.
- The successful Slay log confirms DLL injection, trainer initialization, and readiness. Two assembly warnings appeared; individual trainer options can still depend on game/trainer compatibility.
- The local timer service is disabled. A session beyond two hours has not been independently measured.
- Display ads, rewarded ads, and the dedicated ads partition are disabled. Dashboard promotions and other uninvestigated placements can still appear.
- Login, catalog access, trainer selection/downloads, and other online features still use Wand's services. This is not a fully offline clone.

## Build or verify

Requires Windows, Node.js 18.17+ and the supported Wand installation. There are no npm dependencies and no `npm install` step. REA is needed for investigating new releases, not for rebuilding this known release.

From the repository root:

```powershell
# Validate the installed source and calculate changes without writing output.
node scripts/build-local.cjs --dry-run

# First build: local-wand must not already exist.
node scripts/build-local.cjs

# Verify the current local copy without changing it.
node scripts/build-local.cjs --verify
```

Open `local-wand\Launch Wand Local.cmd`, or `local-wand\app-12.72.0\Wand.exe`. The existing manually created `local-wand\Wand Local.lnk` also points to that application. The root `local-wand\Wand.exe` is a signed launcher retained for the native layout check, rather than the modified application entrypoint.

The independent profile lives at `local-wand\profile`. A fresh build starts without copied credentials; sign in manually. Rebuilding retains this profile and its cached trainers.

The equivalent npm commands are `npm run plan`, `npm run build`, `npm run verify`, and `npm run update`.

## New games and trainers

Try the game in the local app first. Trainer metadata and binaries download through the existing APIs, so a new trainer does **not** automatically require rebuilding the application. No trainer DLL needs to be committed to Git.

If a future trainer requires a newer **Wand application version**, the current patch may no longer apply. The builder examines the newest installed stable `app-*` directory and rejects an unknown build before writing output. It does not guess offsets or silently fall back to an older release.

You can explicitly select the supported installed release:

```powershell
node scripts/build-local.cjs --dry-run --source "$env:LOCALAPPDATA\Wand\app-12.72.0"
```

## Rebuild an existing copy

Close the local Wand app completely, including any background helper processes, then run:

```powershell
node scripts/build-local.cjs --update
node scripts/build-local.cjs --verify
```

The builder patches fresh installed files in a staging directory, verifies their hashes and modified JavaScript syntax, then replaces only the local application directory. The previous application is retained under `local-wand\backups`; the profile is left in place. It never recursively deletes the output. If replacement fails, the old application directory is restored where possible and staging files are retained for diagnosis.

For a separate build location:

```powershell
node scripts/build-local.cjs --output .\analysis\test-build
node scripts/build-local.cjs --verify --output .\analysis\test-build
```

`build-manifest.json` in the output records source location, output hashes, changes, and backup location. It is generated local state, not a file to commit.

## How REA helped

REA inspected the installed Electron `app.asar`, identified its JavaScript structure, and retained static evidence for the timer and API modules. Supplementary static extraction connected the local playtime counter to account-provided settings and distinguished local trainer execution from server-side delivery.

The first modified build opened but failed with `support.client_integrity_failed`. A log exported with **Ctrl+Shift+L** located the failure at native DLL injection. REA classified the auxiliary service as a managed PE, but its metadata representation budget prevented a complete inspection. A small, execution-free CIL reader using .NET metadata APIs then traced the service's trust and layout checks.

The working build applies these changes:

1. Disable the daily timer service, display-ad activation, and rewarded-ad eligibility; block requests in the dedicated ads partition.
2. Isolate the profile and native logs; disable local app updates, protocol registration, and startup registration.
3. Regenerate integrity entries for changed archive members and the executable's embedded archive-header digest. Electron archive validation remains enabled.
4. Preserve the expected `app-*` directory beneath the original signed launcher.
5. Override the copied auxiliary service's `WinVerifyTrust` wrapper result. The certificate allowlist and later caller/module/archive/layout checks remain. **This override affects that wrapper throughout the copied helper; it is not a file-hash-specific exception.** Both modified executables lose valid publisher signatures.

The native modification is tied to the exact investigated helper hash and original instruction bytes. See [the investigation notes](docs/investigation.md) for evidence identities and patch coordinates.

## Supporting a future app release

Keep the current working build. Inspect the new installed artifact with REA, trace the timer/ad code and the native trust call again, then update the pinned identities and patch anchors only after reviewing the changed behavior. Do not merely replace the expected hashes to force an unknown release through.

Validate a fresh output directory, confirm its packed-member and executable/header hashes, and test trainer loading plus at least one gameplay effect. Record the tested app/game versions. Runtime success in one game does not establish support for every trainer.

## Repository contents

| Path | Purpose |
| --- | --- |
| `scripts/build-local.cjs` | Source discovery, version guards, patches, staging, backup, and on-disk verification |
| `docs/investigation.md` | Concise REA findings and the tested native change |
| `package.json` | Optional command aliases; no dependencies |
| `.gitignore` | Excludes generated/proprietary files, profiles, logs, and backups |
| `local-wand/` | Ignored working application and private local profile |
| `analysis/` | Ignored extracted assets, logs, verification builds, and archived exploration scripts |

Raw logs can include account, machine, game-path, and session information. Review and redact any excerpts before adding them to tracked documentation. A `.gitignore` does not remove files already tracked in Git; this repository had no tracked application files when the cleanup was performed.
