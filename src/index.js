// GENESIS Release Guardian — GitHub Action entrypoint.
//
// Pay-per-call x402 gate. Buyer payment credentials are read from a GitHub
// Secret and NEVER logged. The action enforces a hard spending ceiling against
// the live 402 challenge amount before any signature is produced.
//
// No @actions/* runtime deps: inputs/outputs/error/masking use the native
// GitHub Actions env-var + ::command:: protocol, keeping the supply chain
// minimal (only the x402 + viem client libraries are bundled).
import { readFileSync, appendFileSync } from 'node:fs';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const ORIGIN = 'https://genesis-agent-tools.genesisagenttools.workers.dev';
const ENDPOINT = ORIGIN + '/api/flagships/release-guardian';
const BASE_RPC = 'https://mainnet.base.org';
const USDC_DECIMALS = 1e6;
const MODE_PRICE_USD = { quick: 0.005, deep: 0.019 };

function getInput(name) {
  return (process.env['INPUT_' + name.toUpperCase().replace(/-/g, '_')] || '').trim();
}
function setOutput(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (f) appendFileSync(f, `${name}=${String(value)}\n`);
}
function fail(msg) {
  console.log(`::error::${msg}`);
  process.exit(1);
}
function warn(msg) {
  console.log(`::warning::${msg}`);
}
function mask(value) {
  console.log(`::add-mask::${value}`);
}

function loadSpec(raw, name) {
  const v = (raw || '').trim();
  if (!v) fail(`${name} is empty`);
  try {
    if (v.startsWith('{') || v.startsWith('[')) return JSON.parse(v);
    return JSON.parse(readFileSync(v, 'utf8'));
  } catch {
    fail(`${name} is not valid JSON (path or inline)`);
  }
}

async function main() {
  const mode = (getInput('mode') || 'quick').toLowerCase();
  if (mode !== 'quick' && mode !== 'deep') fail(`mode must be "quick" or "deep", got "${mode}"`);
  const dryRun = (getInput('dry-run') || 'false').toLowerCase() === 'true';
  const privateKey = getInput('private-key');
  if (!privateKey && !dryRun) fail('private-key is required (pass a GitHub Secret, never inline)');
  if (privateKey) mask(privateKey); // mask in the workflow log before anything else

  const failOn = (getInput('fail-on') || 'breaking').toLowerCase();
  if (!['breaking', 'risky', 'never'].includes(failOn)) fail(`fail-on must be breaking|risky|never`);
  const maxSpend = Number(getInput('max-spend-usd') || '0.01');
  if (!(maxSpend >= 0)) fail('max-spend-usd must be a non-negative number');

  const previous = loadSpec(getInput('previous-spec'), 'previous-spec');
  const current = loadSpec(getInput('current-spec'), 'current-spec');
  const body = JSON.stringify({ tier: mode, input: { previous, current } });

  // 1) Pre-flight: read the live 402 challenge and enforce the ceiling BEFORE
  //    producing any signature. This request never pays.
  const probe = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (probe.status !== 402) fail(`expected 402 payment challenge, got HTTP ${probe.status}`);
  const prHeader = probe.headers.get('payment-required') || probe.headers.get('x402-payment-required');
  if (!prHeader) fail('no PAYMENT-REQUIRED challenge header in 402 response');
  let challenge;
  try {
    challenge = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8'));
  } catch {
    fail('could not decode PAYMENT-REQUIRED challenge');
  }
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  const amountUsd = Number(accepts[0]?.amount) / USDC_DECIMALS;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) fail('challenge did not carry a parseable USDC amount');
  if (amountUsd > maxSpend) fail(`quoted ${amountUsd} USDC exceeds max-spend-usd ${maxSpend}; aborting before payment`);
  if (amountUsd > (MODE_PRICE_USD[mode] || 0) * 1.5) warn(`quoted ${amountUsd} USDC is higher than the published ${MODE_PRICE_USD[mode]} USDC for "${mode}"`);
  console.log(`Release Guardian (${mode}) quoted ${amountUsd} USDC — within ceiling ${maxSpend}`);

  if (dryRun) {
    console.log(`DRY RUN: skipping payment. Would pay ${amountUsd} USDC to the canonical Exodus payout.`);
    setOutput('verdict', 'DRY_RUN');
    setOutput('severity', 'NONE');
    setOutput('breaking_count', 0);
    setOutput('risk_count', 0);
    return;
  }

  // 2) Paid call. The x402 client signs the EIP-3009 authorization and retries
  //    with the PAYMENT-SIGNATURE header automatically.
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });
  const signer = toClientEvmSigner(account, publicClient);
  const scheme = new ExactEvmScheme(signer);
  const fetchWithPay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: 'eip155:8453', client: scheme }] });

  const res = await fetchWithPay(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (res.status !== 200) fail(`release-guardian returned HTTP ${res.status} (check wallet funding and USDC allowance)`);
  const out = await res.json();
  const verdict = out?.result?.status || 'UNKNOWN';
  const severity = out?.result?.severity || 'NONE';
  const breaking = out?.result?.breaking_count ?? 0;
  const risk = out?.result?.risk_count ?? 0;

  setOutput('verdict', verdict);
  setOutput('severity', severity);
  setOutput('breaking_count', breaking);
  setOutput('risk_count', risk);
  console.log(`Release Guardian verdict: ${verdict} (severity ${severity}, breaking ${breaking}, risk ${risk})`);

  const shouldFail = failOn === 'breaking' ? verdict === 'BREAKING'
    : failOn === 'risky' ? (verdict === 'BREAKING' || verdict === 'RISKY')
    : false;
  if (shouldFail) fail(`Release Guardian blocked the release: verdict ${verdict}`);
}

main().catch((e) => fail(`Release Guardian action error: ${e?.message || e}`));

