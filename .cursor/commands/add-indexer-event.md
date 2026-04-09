# Add Indexer Event Handler

## Objective
Add a new event handler to the Ponder indexer for an on-chain event.

## Steps
1. Ensure the ABI containing the event is exported in `packages/shared/src/abis/`
2. Add the contract and event to `apps/indexer/ponder.config.ts`
3. Define the database table in `apps/indexer/ponder.schema.ts` using `onchainTable`
4. Create or update the event handler file in `apps/indexer/src/`
5. Register the handler with `ponder.on("ContractName:EventName", handler)`
6. Run `npm run dev --workspace=apps/indexer` to test hot-reloading
7. Verify the data appears in Ponder's GraphQL playground

## Requirements
- Import ABIs from `@bounce/shared`
- Include `blockNumber` and `timestamp` on all records
- Use `hex` type for addresses
- Keep handlers focused — extract helpers for complex logic
