# Ape

## Objective
Ship the requested change end-to-end: sync with the latest `main`, implement, raise a PR, babysit it through CI and review, and merge once everything is green.

## Steps
1. Ensure you are on the latest `main` before forking off a new branch:
   - `git checkout main`
   - `git fetch origin`
   - `git pull --ff-only origin main` (fails safely if local `main` has diverged instead of creating a merge commit)
2. Create a new branch from the freshly updated `main` and start working.
3. Implement the requested change.
4. Raise a PR.
5. Monitor the PR and babysit it:
   - Keep pushing fixes until CI is fully green.
   - Wait for CodeRabbit to provide feedback, then implement or resolve every comment.
6. Once CI is fully green and all CodeRabbit feedback has been implemented or resolved, merge the PR.

## Requirements
- Always start from an up-to-date `main` — never branch off a stale local `main`.
- Do not merge until CI is fully green.
- Do not merge until every CodeRabbit comment has been implemented or explicitly resolved.
