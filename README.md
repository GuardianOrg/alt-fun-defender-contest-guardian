# Alt Fun

Token launchpad on HyperEVM. Every token's bonding curve holds a BounceTech Leveraged Token (LT) as its reserve asset — tokens appreciate from buy pressure *and* leveraged movement of the underlying.

For the full product spec (parameters, fees, lifecycle, architecture), see [`AGENTS.md`](./AGENTS.md).

## Quickstart

```bash
nvm use
npm install
npm run setup
npm run dev
```

That's it. `npm run dev` starts the web app, API, and indexer in parallel via Turbo. Expect them on:

| Service | URL |
|---|---|
| Web | http://localhost:5173 |
| API | http://localhost:8787 |
| Indexer (GraphQL) | http://localhost:42069 |

### What `npm run setup` does

- Copies every `*.example` env file to its runtime sibling (idempotent — skips files that already exist).
- Builds `@launchpad/shared` so downstream imports resolve on first `npm run dev`.
- Lists env files that still contain `ASK_A_TEAMMATE` placeholders you'll need to fill in.

After running setup, open the flagged files and fill in the real secrets (Neon DB URLs, Alchemy RPC key, Privy app id). Ask a teammate for the shared dev values.

## Monorepo layout

| Path | What it is | Stack |
|---|---|---|
| [`apps/web/`](./apps/web/AGENTS.md) | Web app | React 19, Vite 8, CSS Modules, Redux Toolkit, TanStack Query, Privy, viem, lightweight-charts |
| [`apps/api/`](./apps/api/AGENTS.md) | REST + WebSocket API | Hono on Cloudflare Workers, Drizzle, Neon (PostgreSQL), R2, Durable Objects |
| [`apps/indexer/`](./apps/indexer/AGENTS.md) | EVM indexer | Ponder (GraphQL auto-generated from schema), Railway |
| [`packages/contracts/`](./packages/contracts/AGENTS.md) | Solidity contracts | Foundry, forked from Virtuals Protocol |
| [`packages/shared/`](./packages/shared) | Shared types, ABIs, constants, pricing helpers | TypeScript, tsup |
| [`packages/config/`](./packages/config) | Shared ESLint + TSConfig | — |

Deeper docs:

- Product spec: [`AGENTS.md`](./AGENTS.md) (root — source of truth)
- Contracts functional spec: [`docs/contracts-scope.md`](./docs/contracts-scope.md)
- Backend functional spec: [`docs/backend-scope.md`](./docs/backend-scope.md)
- Frontend functional spec: [`docs/frontend-scope.md`](./docs/frontend-scope.md)
- Per-app context: `AGENTS.md` in each `apps/*` and `packages/*` directory
- Open work items: [`TODO.md`](./TODO.md)

## Common commands

```bash
npm run dev           # start web + api + indexer (via turbo)
npm run build         # build everything
npm run typecheck     # tsc across all packages
npm run lint          # eslint across all packages
npm run test          # run all unit tests
npm run ci            # lint + typecheck + test + build (same as GitHub CI)
npm run format        # prettier across the repo
```

Each app also has its own scripts — run `npm run <script> --workspace <name>` from the root, e.g. `npm run db:studio --workspace @launchpad/api`.

## Architecture in one diagram

```
Contracts emit events
        ▼
    Ponder indexer ──▶ GraphQL (on-chain read path)
        │                   ▲
        │ live trade          │
        │ webhook             │
        ▼                   │
    Hono API ────────────┤
        │                   │
        ├─ Postgres (off-chain: profiles, token metadata)
        ├─ R2 (images)
        ├─ Durable Objects (WebSocket fan-out + LtTicker alarm loop)
        ▼
    Web app (React) ──▶ Privy ──▶ on-chain tx
        │
        └─ connects WS for live trade/price updates
```

## Contracts

Solidity work lives in [`packages/contracts/`](./packages/contracts) and is a separate flow targeted at protocol contributors. It requires Foundry (`forge`) installed locally and a deployer key in `packages/contracts/.env`. If you're just running the webapp you can ignore this entirely — deployed addresses already ship in `@launchpad/shared`.

See [`packages/contracts/AGENTS.md`](./packages/contracts/AGENTS.md) and [`docs/contracts-scope.md`](./docs/contracts-scope.md) for details.

## Troubleshooting

**Chart doesn't update live after trades.** `VITE_WS_URL` in `apps/web/.env.local` is empty or wrong. Must be `ws://localhost:8787/ws` locally and `wss://<api-host>/ws` in prod. Restart vite after changing — env vars are read at build time.

**Imports from `@launchpad/shared` fail to resolve.** `packages/shared/dist/` is missing. Run `npm run setup` (or `npm run build --workspace @launchpad/shared` if you just need this step). `turbo dev` now depends on this build so it should auto-resolve on `npm run dev`.

**Indexer isn't posting live trades to the API.** `API_WEBHOOK_URL` and/or `ADMIN_API_KEY` missing in `apps/indexer/.env.local`, or the two `ADMIN_API_KEY` values (indexer + api) don't match. The indexer fails-silent for broadcasts by design — indexing keeps working, you just lose live WS.

**LT exchange-rate updates never arrive.** The `LtTicker` Durable Object self-kickstarts on first request post-cold-boot, so just making any request to the API should fix it. Heartbeat check: `curl -H 'X-Admin-Key: dev-admin-key' http://localhost:8787/api/v1/admin/lt-ticker` should show `tickCount` advancing and `lastError: null`.

**"No react@18 source found" warning on `npm install`.** Benign. `postinstall` uses a workaround for an `ink`/`react` peer-dep conflict; the warning just means it couldn't auto-patch and things will still work.

## Deployment

| Target | Platform | Trigger |
|---|---|---|
| `apps/web` | Cloudflare Pages | GitHub integration on `main` |
| `apps/api` | Cloudflare Workers | `.github/workflows/deploy-api.yml` on `main` |
| `apps/indexer` | Railway | GitHub integration on `main` (with "Wait for CI") |

Production env vars live in each platform's dashboard, not in this repo. Pull the relevant service and check there before suspecting config drift.
