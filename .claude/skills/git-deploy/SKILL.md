---
name: git-deploy
description: >
  Deploy, release, commit and push, bump version, push with personal SSH key,
  commit bump and push, update the repo and push. Use when the user wants to
  commit their changes, bump the version, and push to origin.
---

# Git Deploy

Perform a conventional commit, optional version bump, and push using the personal SSH key.

## Steps

1. **Stage** — add the relevant files (never `git add -A` blindly; check `git status` first)
2. **Bump version** — check the latest version from `git log --oneline -5`, increment the patch (e.g. v2.1.6 → v2.1.7)
3. **Commit** — always include the version in the message: `chore: bump to vX.Y.Z`
4. **Push** — always use the personal SSH key:
   ```bash
   GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_personal -o IdentitiesOnly=yes" git push origin <branch>
   ```

## SSH Key Note

The default SSH agent may not have the personal key loaded. Always override with `GIT_SSH_COMMAND` as shown above. Do not use `git push` bare — it will fail or push with the wrong key.

## Version Bump

If `.claude-plugin/plugin.json` exists in the repo, update its `"version"` field to match the new version before committing. Otherwise version is tracked in git commit messages only.
