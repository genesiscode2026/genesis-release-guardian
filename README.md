# GENESIS Release Guardian — GitHub Action

A minimal, pay-per-call **x402** cross-contract release gate for CI. It calls the
live GENESIS Release Guardian API to check MCP tool contracts, common OpenAPI
breakages, GraphQL, SDK exports, and JSON Schema changes between two versions,
then passes or fails your workflow per a policy you configure.

- **No account, no API key, no subscription.** Payment is x402: USDC on Base.
- **You own your payment key.** GENESIS never sees your private key — only the
  standard x402 `PAYMENT-SIGNATURE` a client produces against the quoted amount.

## What it does

```
pull_request (or any trigger)
  → locate baseline + proposed spec (OpenAPI / GraphQL / schema JSON)
  → Release Guardian (Quick by default)
  → x402 pay (buyer key)
  → verdict: SAFE | RISKY | BREAKING | UNKNOWN | UNSUPPORTED
  → pass or fail per `fail-on`
```

## Usage

```yaml
name: api-compat
on:
  pull_request:
    paths: ['spec/**', 'openapi/**']

jobs:
  release-guardian:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check API for breaking changes
        id: guard
        uses: genesiscode2026/genesis-release-guardian@v1
        with:
          previous-spec: spec/openapi.baseline.json
          current-spec: spec/openapi.json
          mode: quick
          fail-on: breaking
          max-spend-usd: '0.001'
          private-key: ${{ secrets.X402_PRIVATE_KEY }}
      - run: echo "verdict=${{ steps.guard.outputs.verdict }}"
```

## Inputs

| Input | Required | Default | Meaning |
|---|---|---|---|
| `previous-spec` | yes | — | Baseline spec: a filesystem path to JSON, or an inline JSON string |
| `current-spec` | yes | — | Proposed spec: a filesystem path to JSON, or an inline JSON string |
| `mode` | no | `quick` | `quick` (0.001 USDC) or `deep` (0.019 USDC, explicit opt-in) |
| `max-spend-usd` | no | `0.001` | Hard ceiling. Set it to `0.019` when explicitly choosing Deep. The action aborts **before signing** if the live quote exceeds this or the published mode price |
| `fail-on` | no | `breaking` | `breaking` (fail on BREAKING), `risky` (fail on BREAKING+RISKY), `never` |
| `private-key` | yes | — | Your x402 EIP-3009 signing key, funded with USDC on Base. Use a GitHub Secret |

## Required secret

Create a repository secret (Settings → Secrets and variables → Actions):

```
X402_PRIVATE_KEY = 0x… (a Base USDC-funded EIP-3009 signing key)
```

- The key is masked in the log (`::add-mask::`) before any other output.
- The action only signs the **exact** quoted amount to the canonical GENESIS
  Exodus payout address. There is no unlimited approval and no unrelated spend.

## Permissions & data flow

- **GitHub permissions:** none special. The action makes outbound HTTPS to
  `https://genesis-agent-tools.genesisagenttools.workers.dev` (the API) and
  `https://mainnet.base.org` (Base RPC for signing).
- **What leaves your repository:** only the two spec artifacts you explicitly
  pass via `previous-spec` / `current-spec`. Nothing else is read or uploaded.
- **What comes back:** `verdict`, `severity`, `breaking_count`, `risk_count`
  (action outputs), plus a human-readable log line.

## Outputs

| Output | Values |
|---|---|
| `verdict` | `SAFE` `RISKY` `BREAKING` `UNKNOWN` `UNSUPPORTED` |
| `severity` | `NONE` `LOW` `MEDIUM` `HIGH` |
| `breaking_count` | integer |
| `risk_count` | integer |

## Security

- No shell execution; no `pull_request_target`; no repo-content scanning beyond
  the supplied spec files.
- Dependencies pinned to exact versions and bundled into `dist/index.js`
  (`npm audit` = 0 vulnerabilities).
- The spending ceiling is enforced against the **live 402 challenge amount**
  before any signature is produced, so an unexpected price can never overspend.

## Quick vs Deep

- **Quick (0.001 USDC):** low-cost deterministic cross-contract gate for routine CI. Use it on
  every PR.
- **Deep (0.019 USDC):** higher-evidence analysis. Opt in for ambiguous or
  high-risk changes where the extra evidence changes the release decision.

For a no-wallet first look, use the free scope preview at
[`/release-guardian`](https://genesis-agent-tools.genesisagenttools.workers.dev/release-guardian).

## Non-CI usage

The same capability is available directly (no account, no key registration):

```bash
curl -i -X POST https://genesis-agent-tools.genesisagenttools.workers.dev/api/flagships/release-guardian \
  -H 'content-type: application/json' \
  -d '{"tier":"quick","input":{"previous":{"paths":{}},"current":{"paths":{}}}}'
```

See the repo README and `/llms.txt` for the full flagship catalog.
