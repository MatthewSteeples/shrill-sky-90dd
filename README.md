# shrill-sky-90dd

Cloudflare Worker that forwards incoming HTTP requests to an upstream API and writes request/response logs to an R2 bucket.

## What it does

- Proxies every request to `UPSTREAM_BASE_URL` while preserving method, headers, query string, and request body.
- Rewrites protocol/host/path to the configured upstream base.
- Returns the upstream response to the caller.
- Asynchronously stores four text logs in R2 for each request:
  - `request-headers.txt`
  - `request-body.txt`
  - `response-headers.txt`
  - `response-body.txt`

Each log set is written under a deterministic prefix based on request path + timestamp + URL hash.

## Tech stack

- Cloudflare Workers
- Cloudflare R2
- TypeScript
- Wrangler
- Vitest

## Prerequisites

- Node.js 20+ and npm
- A Cloudflare account
- Wrangler CLI (installed via project dependencies)
- An R2 bucket for logs

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Authenticate Wrangler:

   ```bash
   npx wrangler login
   ```

3. Create an R2 bucket (or use an existing one):

   ```bash
   npx wrangler r2 bucket create shrill-sky-90dd-logs
   ```

4. Configure `wrangler.jsonc`:
   - Set `vars.UPSTREAM_BASE_URL` to your upstream API base URL.
   - Set `r2_buckets[0].bucket_name` to your R2 bucket name.

Current required bindings/config:

- `UPSTREAM_BASE_URL` (string)
- `LOGS_BUCKET` (R2 bucket binding)

## Run locally

```bash
npm run dev
```

By default Wrangler serves the worker at `http://localhost:8787`.

## Deploy

```bash
npm run deploy
```

## Test

```bash
npm test -- --run
```

## Project structure

```text
src/index.ts        Worker proxy and logging logic
test/index.spec.ts  Worker behavior tests
wrangler.jsonc      Worker + binding configuration
```
