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

The default deployment remains `shrill-sky-90dd`, pointing to QuickBooks and
using `shrill-sky-90dd-logs`:

```bash
npm run deploy
```

### Named environments

Three additional environments deploy the same code as separate Workers with
isolated R2 log buckets. Environment names are case-sensitive.

| Environment | Worker name | Upstream base URL | R2 log bucket |
| --- | --- | --- | --- |
| `Qbo` | `shrill-sky-90dd-qbo` | `https://quickbooks.api.intuit.com` | `shrill-sky-90dd-qbo-logs` |
| `Xero` | `shrill-sky-90dd-xero` | `https://api.xero.com` | `shrill-sky-90dd-xero-logs` |
| `SageCloud` | `shrill-sky-90dd-sagecloud` | `https://api.accounting.sage.com/` | `shrill-sky-90dd-sagecloud-logs` |

Each environment explicitly defines `UPSTREAM_BASE_URL`, `ERROR_PERCENTAGE`
(initially `0`), and `LOGS_BUCKET` because variables and bindings are not
inherited from the default configuration.

Worker names are explicitly lowercase to meet Cloudflare's naming requirements.
The three named-environment buckets have lifecycle rules to delete all objects
after 14 days, while preserving the default seven-day incomplete multipart
upload cleanup. These rules are configured on the buckets, not in Wrangler.
Deletion is asynchronous and typically occurs within 24 hours of expiration.

Create the buckets once before the first deployment:

```bash
npx wrangler r2 bucket create shrill-sky-90dd-qbo-logs
npx wrangler r2 bucket create shrill-sky-90dd-xero-logs
npx wrangler r2 bucket create shrill-sky-90dd-sagecloud-logs
```

Deploy each environment:

```bash
npm run deploy -- --env Qbo
npm run deploy -- --env Xero
npm run deploy -- --env SageCloud
```

For local development, use `npm run dev -- --env Qbo` (or the other environment
names).

### Cloudflare Workers Builds

After the initial deployments, connect the same repository to each new Worker
under **Settings > Builds**, with production branch `master` and the repository
root as the root directory. Leave the build command empty; Wrangler bundles the
TypeScript.

Set each Worker's deploy command to the matching `npm run deploy -- --env ...`
command above. Leave the existing Worker's deploy command as `npm run deploy`.
Pushes to `master` will then trigger independent deployments for all connected
Workers.

If preview builds are enabled, also add the matching `--env Qbo`, `--env Xero`,
or `--env SageCloud` flag to the preview command. For example,
`npx wrangler preview --env Qbo`; if using `npx wrangler versions upload`,
append the same environment flag to that command instead.

Keep runtime variables and bindings in `wrangler.jsonc`; build variables are
only available during CI, not at runtime. Configure any runtime secrets
separately for each Worker.

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
