# TODO

Single source of truth for open tasks. Remove items when completed. Add items when new work is discovered.

---

## Backend API

### Hash API keys at rest

`api_keys.key` is stored in plaintext. If the database is compromised, all active keys are immediately usable. v2 should store a SHA-256 hash (with a short prefix for lookup) and compare hashes in the auth middleware. Only return the raw key once at creation time.
