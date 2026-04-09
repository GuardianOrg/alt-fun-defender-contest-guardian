FROM node:22-slim AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY apps/indexer/package.json apps/indexer/

RUN npm ci --workspace=@launchpad/indexer --workspace=@launchpad/shared --workspace=@launchpad/config

COPY packages/shared/ packages/shared/
COPY packages/config/ packages/config/
COPY apps/indexer/ apps/indexer/

RUN npm run build --workspace=@launchpad/shared

WORKDIR /app/apps/indexer

CMD ["npm", "run", "start"]
