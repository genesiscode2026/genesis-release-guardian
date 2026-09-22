# Security

## Reporting a vulnerability

Email `chitara.trading@proton.me`. Please include a description and, where
possible, a minimal reproduction. Do not open a public issue for a security
finding.

## Buyer credentials

- The Release Guardian Action never contains seller/founder secrets.
- The buyer's x402 signing key (`X402_PRIVATE_KEY`) is supplied via a GitHub
  Secret and is masked in logs; it is never logged or persisted.
- Payment is x402 (USDC on Base) to the canonical GENESIS Exodus payout
  address; there is no unlimited approval and no unrelated transaction.

## Recommended safe use

- Use `pull_request` (not `pull_request_target`) so untrusted PR code cannot
  run with your secret.
- Pin the action to a release tag (`@v1`) and, for high-assurance repos, to a
  full commit SHA.
- Set `max-spend-usd` to a value you accept for a single invocation.

## Dependencies

Production dependencies are pinned to exact versions and bundled into
`dist/index.js` (`npm audit` reports 0 vulnerabilities at publish time).
