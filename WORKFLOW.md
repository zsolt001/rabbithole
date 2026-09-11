# Fork workflow

How this fork (`zsolt001/rabbithole`) tracks upstream
(`shlokkhemani/rabbithole`), keeps a personal build, and feeds selected
features back upstream.

This file lives on the `live` branch only — never on `main`. A commit on `main`
would break the fast-forward sync from upstream (see below).

## Remotes

| Remote | URL | Role |
|---|---|---|
| `origin` | `git@github.com:zsolt001/rabbithole.git` | Your public fork. All your branches live here. |
| `upstream` | `https://github.com/shlokkhemani/rabbithole.git` | The original project. Read-only for you. |

## Branch roles

| Branch | Role | Rule |
|---|---|---|
| `main` | Pristine mirror of `upstream/main`. | **Never commit here.** Only fast-forward from upstream, then push to `origin`. |
| `feat/<x>` | One unit of work (a feature or fix). | **Always branched off `main`**, never off `live`. Kept focused enough to become a PR. |
| `live` | Your combined, deployable build — what you actually run. | Only ever *merges in* `feat/*` branches. Rebased onto `main` on every sync. |

The one discipline that makes this work: **features are born off `main` and flow
*into* `live` — never the reverse.** That is what lets any single feature go
upstream as a clean PR while `live` still carries every feature stacked together.

## The loops

### Sync with upstream (before starting work / weekly)

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout live && git rebase main
git push --force-with-lease origin live
```

If `merge --ff-only` ever refuses, something committed to `main` directly —
reset it to match upstream (`git reset --hard upstream/main`) after confirming
nothing valuable is only there.

### Start a feature (contributable or private — same start)

```bash
git checkout main && git checkout -b feat/x   # off pristine main, NOT live
```

### Run it in your combined build

```bash
git checkout live && git merge feat/x
npm run build && git commit -am "chore: rebuild dist"   # rebuild once, on live
```

### Send one feature upstream

```bash
git checkout feat/x && git rebase upstream/main
npm run build && npm run check:dist          # CI requires committed dist current
npm run test:unit && npm run test:contracts  # plus any tier the change touches
git push origin feat/x
gh pr create --repo shlokkhemani/rabbithole --base main --head zsolt001:feat/x
```

After it merges upstream: the next sync brings it into `main`, and rebasing
`live` drops the now-redundant commits automatically. Delete `feat/x`.

## `dist/` — rebuild, never hand-merge

`dist/` is generated and committed, and CI runs `check:dist`.

- On `feat/*` branches, keep commits source-only and add the `npm run build`
  dist commit **last** (or only at PR time). Source-only intermediate history
  rebases and cherry-picks cleanly.
- On `live`, rebuild **once** after merging features rather than merging each
  branch's dist commit.
- If a rebase/merge conflicts inside `dist/`, don't resolve by hand: take either
  side, re-run `npm run build`, and commit.

## Notes

- All branches are public (they live on the public fork). "Private" here means
  "not sent upstream," not "hidden."
- The separate `../rabbithole` checkout is redundant now that this checkout has
  an `upstream` remote. Keep it only if you want a physically separate pristine
  mirror.
