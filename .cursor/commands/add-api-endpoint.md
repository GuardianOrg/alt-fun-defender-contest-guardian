# Add API Endpoint

## Objective
Create a new Hono route handler with proper typing, validation, and testing.

## Steps
1. Define request/response types in `packages/shared/src/types/api.ts`
2. Create or update the route file in `apps/api/src/routes/`
3. Add input validation using `drizzle-zod` if the endpoint accepts a body
4. Add any needed Drizzle queries in the handler or a service function
5. Mount the route in `apps/api/src/index.ts` if it's a new route file
6. Write a test for the endpoint
7. Run `npm run typecheck --workspace=apps/api` to verify types

## Requirements
- Return `{ data, success: true }` on success
- Return `{ success: false, error: "message" }` on failure
- Use `HTTPException` for HTTP errors
- Validate all user input
