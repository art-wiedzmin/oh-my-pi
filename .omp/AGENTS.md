# WiedzminVer Custom Branch

This repo has a custom branch `wiedzmin/custom` (fork: `art-wiedzmin/oh-my-pi`) with patches on top of upstream `can1357/oh-my-pi`.

## Branch Structure

- **Remote `origin`**: `can1357/oh-my-pi` (upstream)
- **Remote `fork`**: `art-wiedzmin/oh-my-pi` (our fork)
- **Branch `wiedzmin/custom`**: our patches, rebased on `origin/main`
- **PR branch `fix/skill-basedir-windows`**: upstream fix (PR #554), will be deleted after merge

## Custom Patches

Three commits on top of upstream main:

### 1. Skill baseDir Windows fix (PR #554)

**File:** `packages/coding-agent/src/extensibility/skills.ts`

`skill.baseDir` is computed by stripping `SKILL.md` from the path. The upstream regex `/\/SKILL\.md$/` only matches forward slashes — fails on Windows backslash paths. Fix: `[/\\]SKILL\.md$`.

Three occurrences (lines ~57, ~171, ~207). Search for `SKILL\.md`.

### 2. TTSR per-session state + gitignore-free config discovery

**File:** `packages/coding-agent/src/sdk.ts`

Commented out `ttsrManager.restoreInjected(existingSession.injectedTtsrRules)` in `discoverTtsrRules` block (~line 794). Without this, TTSR injection state bleeds across sessions in the same workspace — once a rule fires in session A, it's marked as "already fired" in session B. With parallel agents, this makes TTSR rules fire only once across all agents instead of once per agent.

Search for `restoreInjected` or `Disabled: TTSR state is per-session`.

**File:** `packages/coding-agent/src/discovery/helpers.ts`

Changed `loadFilesFromDir` default for `gitignore` from `true` to `false`. The upstream glob uses `gitignore: true`, which causes `.omp/rules/` files to be invisible when `.omp/` is gitignored (common in projects with catch-all `*` gitignore). OMP config files are not project source code and should not be subject to gitignore filtering.

Search for `gitignore` in `loadFilesFromDir` options.

### 3. WiedzminVer branding

**File:** `packages/coding-agent/src/modes/components/welcome.ts`

Added `| WiedzminVer` label next to `Tips` on the home screen (~line 123). Color: `customMessageLabel` (purple/pink `#c678dd` in dark-one theme).

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
  && bun build --compile --define PI_COMPILED=true --root . \
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
# Resolve conflicts if any — patches are in 4 files:
#   skills.ts, sdk.ts, helpers.ts, welcome.ts
# Rebuild (see above)
```

After rebase, verify patches are intact:
- `skills.ts`: `[/\\]SKILL\.md$` (not `/SKILL\.md$`)
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
