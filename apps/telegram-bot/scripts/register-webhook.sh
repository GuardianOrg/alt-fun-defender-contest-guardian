#!/usr/bin/env bash
# Idempotently (re-)register the Telegram webhook against the deployed Worker.
#
# Why this script exists: `setWebhook`'s `allowed_updates` list is sticky on
# Telegram's side. Add a new update type to the bot (e.g. callback_query for
# inline keyboards) and the existing registration silently drops it — Telegram
# never forwards those updates and the Worker sees nothing. Running this
# script after every deploy keeps the registered allowed_updates in lockstep
# with what `routes/admin.ts → setWebhook` actually wants today.
#
# Required env:
#   WORKER_URL         e.g. https://launchpad-telegram-bot.chase-7a6.workers.dev
#   ADMIN_API_KEY      matches the Worker's ADMIN_API_KEY secret
set -euo pipefail

: "${WORKER_URL:?WORKER_URL must be set (e.g. https://launchpad-telegram-bot.chase-7a6.workers.dev)}"
: "${ADMIN_API_KEY:?ADMIN_API_KEY must be set}"

response=$(curl -fsS -X POST "${WORKER_URL}/admin/set-webhook" \
  -H "x-admin-key: ${ADMIN_API_KEY}" \
  -H "content-type: application/json" \
  -d "{\"url\":\"${WORKER_URL}/webhook\"}")

echo "${response}"
