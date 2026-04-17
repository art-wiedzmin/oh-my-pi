# WiedzminVer Custom Branch

This repo has a custom branch `wiedzmin/custom` (fork: `art-wiedzmin/oh-my-pi`) with patches on top of upstream `can1357/oh-my-pi`.

## Branch Structure

- **Remote `origin`**: `can1357/oh-my-pi` (upstream)
- **Remote `fork`**: `art-wiedzmin/oh-my-pi` (our fork)
- **Branch `wiedzmin/custom`**: our patches, rebased on `origin/main`

## Custom Patches

Six commits on top of upstream main, grouped by concern:

### TTSR per-session + gitignore-free config discovery (`e93e9b521`)

**`packages/coding-agent/src/sdk.ts`** — commented out `ttsrManager.restoreInjected(existingSession.injectedTtsrRules)` in the `discoverTtsrRules` block. Without this, TTSR injection state bleeds across sessions in the same workspace — once a rule fires in session A, it's marked as "already fired" in session B, so parallel agents get the rule exactly once total instead of once each.

Search: `restoreInjected` or `Disabled: TTSR state is per-session`.

**`packages/coding-agent/src/discovery/helpers.ts`** — `loadFilesFromDir` default for `gitignore` is `false`. Upstream hardcodes `gitignore: true`, which hides `.omp/rules/` in projects with catch-all `*` gitignore. OMP config files are not project source.

Search: `gitignore` in `loadFilesFromDir` options.

### WiedzminVer branding (`1d2422c9d`)

**`packages/coding-agent/src/modes/components/welcome.ts`** — `| WiedzminVer` label next to `Tips` on home screen (~line 123). Color: `customMessageLabel` (purple/pink `#c678dd` in dark-one theme).

### This doc (`50ee45fdc`)

**`.omp/AGENTS.md`** — patch docs and build instructions.

### Editor borders (`92861c21b`)

Horizontal editor borders, below-editor status line, `EditorBorderStyle` enum. Multiple files under `packages/coding-agent/src/modes/`.

### `process.exit(0)` on `--resume` early returns (`66b44da75`)

Process hangs on background marketplace refresh when `--resume` bails early. Explicit `process.exit(0)` on the early-return paths in the CLI entry.

## Build Process

Prerequisites: `bun` (installed globally via `npm install -g bun`).

Native addons must be in `packages/natives/native/` — copy from installed OMP if missing:
```bash
cp "$LOCALAPPDATA/omp/pi_natives.win32-x64-modern.node" packages/natives/native/
cp "$LOCALAPPDATA/omp/pi_natives.win32-x64-baseline.node" packages/natives/native/
```

Build:
```bash
bun --cwd=packages/natives run embed:native \
  && bun build --compile --define PI_COMPILED=true --external mupdf --root . \
     ./packages/coding-agent/src/cli.ts \
     --outfile packages/coding-agent/dist/omp \
  && bun --cwd=packages/natives run embed:native --reset
```

Install:
```powershell
cp packages/coding-agent/dist/omp.exe "$env:LOCALAPPDATA\omp\omp-patched.exe"
# Close all OMP sessions, then:
mv -Force "$env:LOCALAPPDATA\omp\omp-patched.exe" "$env:LOCALAPPDATA\omp\omp.exe"
```

## Updating from Upstream

```bash
git fetch origin
git rebase origin/main
# Resolve conflicts if any — patches touch:
#   sdk.ts, helpers.ts, welcome.ts, cli.ts, settings-schema.ts, settings-defs.ts
# Rebuild (see above)
```

After rebase, verify patches are intact:
- `sdk.ts`: `restoreInjected` is commented out
- `helpers.ts`: `gitignore = false` default in `loadFilesFromDir`
- `welcome.ts`: `WiedzminVer` label present

Push:
```bash
git push fork wiedzmin/custom --force
```

## Sparse Checkout

`.omp/` is excluded via sparse checkout (upstream has `.omp/commands/`, `.omp/rules/`, `.omp/skills/` tracked). Our local `.omp/` is untracked and contains only this `AGENTS.md`. The sparse checkout config lives in `.git/info/sparse-checkout`:
```
/*
!/.omp
```

`.git/info/exclude` also has `.omp/` to prevent git from showing it as untracked.
