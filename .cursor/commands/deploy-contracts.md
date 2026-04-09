# Deploy Contracts

## Objective
Compile, test, and deploy the smart contracts, then export ABIs to the shared package.

## Steps
1. Run `cd packages/contracts && forge build` to compile
2. Run `forge test` and ensure all tests pass
3. Run the deployment script: `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast`
4. Run `npm run export-abi --workspace=packages/contracts` to export ABIs to `packages/shared/src/abis/`
5. Update contract addresses in `packages/shared/src/constants/addresses.ts`
6. Run `npm run typecheck` to verify all packages compile with new ABIs

## Requirements
- All tests must pass before deployment
- Never hardcode private keys — use `cast wallet import`
- Update addresses for the correct chain
