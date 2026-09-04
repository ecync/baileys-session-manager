# Releasing

This package publishes to npm automatically from GitHub Actions ([`.github/workflows/publish.yml`](../.github/workflows/publish.yml)) whenever a `v*` tag is pushed, `v1.0.1`, `v1.1.0`, `v2.0.0`, and so on. There's also a [CI workflow](../.github/workflows/ci.yml) (typecheck, build, test) that runs on every push to `main` and every pull request, independent of releasing.

## One-time setup: the `NPM_TOKEN` secret

The publish workflow needs an npm access token to publish on your behalf.

1. On [npmjs.com](https://www.npmjs.com), go to your avatar → **Access Tokens** → **Generate New Token** → **Classic Token**, type **Automation** (this type is meant for CI, and works even if you have 2FA required for publishing, since 2FA can't prompt inside a GitHub Actions runner).
2. Copy the token, npm only shows it once.
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `NPM_TOKEN`, paste the value.

That's it, the workflow already references `secrets.NPM_TOKEN`.

If the `@ecync` scope is an npm **organization** rather than your personal account, generate the token from an account that's a member of that org with publish rights, and add it as the org's team/repo secret the same way.

## Cutting a release

```bash
npm version patch   # or: minor / major / an explicit version like 1.2.3
git push --follow-tags
```

`npm version` bumps `package.json`'s `version`, commits that change, and creates a matching `vX.Y.Z` git tag, all in one step. `git push --follow-tags` pushes both the commit and the tag, the tag push is what triggers `publish.yml`.

## What the publish workflow does

1. Checks out the tagged commit.
2. Installs dependencies (`npm ci`, using the committed `package-lock.json` for a reproducible install).
3. Runs `npm run typecheck`, `npm test`, and `npm run build` again, even though CI already ran these on the commit before it was tagged, a tag push is a separate event and this workflow doesn't assume CI definitely passed for it.
4. `npm pack --dry-run` as a final sanity check on exactly what's about to be published.
5. `npm publish --provenance --access public`. `--provenance` attaches a Sigstore-signed attestation proving the package was built from this exact commit in this exact GitHub Actions workflow, visible on the npm package page as a "Provenance" badge, npm requires `id-token: write` permission for this, already set in the workflow. `--access public` is required for a scoped package (`@ecync/...`) to publish publicly rather than defaulting to private.
6. Creates a GitHub Release for the tag with auto-generated release notes (from the commits since the previous tag).

## Manual trigger

The workflow also supports `workflow_dispatch`, so a maintainer can re-run a publish from the **Actions** tab without pushing a new tag, useful if a publish failed for an infrastructure reason (an npm registry blip, say) rather than a problem with the code itself. It still runs against whatever's on the default branch at the time you trigger it, not a specific tag, so prefer the tag-push flow for a normal release.

## Advanced: npm Trusted Publishing (no long-lived token)

npm supports "Trusted Publishing" via GitHub Actions OIDC, where a specific repo + workflow file is registered on npmjs.com as allowed to publish a given package with no `NPM_TOKEN` secret at all, the identity is proven by GitHub's own OIDC token instead. This needs to be configured on npmjs.com under the package's **Settings → Publishing access** after the package exists (so it can't be the very first publish), and would let `publish.yml`'s `npm publish` step drop the `NODE_AUTH_TOKEN` env var entirely. Worth switching to once the package is established, not necessary to get started.
