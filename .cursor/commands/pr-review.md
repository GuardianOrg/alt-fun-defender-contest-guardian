# PR Review

## Objective
Run all quality checks across affected packages and summarize changes.

## Steps
1. Run `npm run lint` to check for linting issues
2. Run `npm run typecheck` to verify TypeScript compilation
3. Run `npm run test` to run all tests
4. If contracts changed: run `cd packages/contracts && forge test -vv`
5. Review the git diff for:
   - Any `console.log` statements left in
   - Any hardcoded secrets or API keys
   - Any `any` types introduced
   - Proper error handling
   - Consistent use of project terminology
6. Summarize the changes and their impact

## Requirements
- All checks must pass
- No `any` types
- No `console.log` in production code
- All new public contract functions have NatSpec
