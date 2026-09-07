/**
 * What is configured, what is not, and what each gap costs you.
 *
 * Written because a cold clone runs the whole oversight loop but produces a
 * record that is NOT independently verifiable, and nothing told you which of
 * the two it was. "It ran" and "it produced evidence" are different outcomes,
 * and a product about evidence should never leave that ambiguous.
 *
 *   bun run doctor
 */
import {
  HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_TOPIC_ID, HEDERA_AGENT_ID,
  ATTESTOR_PRIVATE_KEY, WORLD_RP_SIGNING_KEY, WORLD_APP_ID, WORLD_MODE,
  WITNESS_HEDERA_ACCOUNT, PAY_TO_HEDERA, PAY_TO_ARC, ARC_AGENT_ID,
  VAPID_PRIVATE_KEY, FACILITATOR_URL, ARC_FACILITATOR_URL, DATABASE_URL,
} from '../src/config/main-config.ts';

interface Check {
  name: string;
  ok: boolean;
  /** What stops working without it. Never "required": say what breaks. */
  cost: string;
  vars: string[];
}

const checks: Check[] = [
  {
    name: 'Database',
    ok: Boolean(DATABASE_URL),
    cost: 'nothing runs at all',
    vars: ['DATABASE_URL'],
  },
  {
    name: 'Attestation signing',
    ok: Boolean(ATTESTOR_PRIVATE_KEY),
    cost: 'records are signed with the PUBLISHED demo key, so the signature proves nothing',
    vars: ['ATTESTOR_PRIVATE_KEY'],
  },
  {
    name: 'HCS evidence log',
    ok: Boolean(HEDERA_OPERATOR_ID && HEDERA_OPERATOR_KEY && HEDERA_TOPIC_ID),
    cost: 'decisions resolve but reach no tamper-evident log, so nothing is externally ordered',
    vars: ['HEDERA_OPERATOR_ID', 'HEDERA_OPERATOR_KEY', 'HEDERA_TOPIC_ID'],
  },
  {
    name: 'x402 gate (Hedera)',
    ok: Boolean(PAY_TO_HEDERA),
    cost: 'the gate cannot quote a price, so an agent cannot pay to open a decision',
    vars: ['PAY_TO_HEDERA'],
  },
  {
    name: 'Paying agent',
    ok: Boolean(HEDERA_AGENT_ID),
    cost: 'no agent identity to pay FROM; `bun run demo` still works, the agent CLI does not',
    vars: ['HEDERA_AGENT_ID', 'HEDERA_AGENT_KEY'],
  },
  {
    name: 'Witness payout',
    ok: Boolean(WITNESS_HEDERA_ACCOUNT),
    cost: 'fees are recorded as owed but never sent, so "the witness gets paid" is not demonstrated',
    vars: ['WITNESS_HEDERA_ACCOUNT'],
  },
  {
    name: 'World ID verification',
    ok: Boolean(WORLD_RP_SIGNING_KEY && WORLD_APP_ID),
    cost: 'the witness PWA cannot open the IDKit widget; scripted demos still verify proofs offline',
    vars: ['WORLD_APP_ID', 'WORLD_RP_ID', 'WORLD_RP_SIGNING_KEY'],
  },
  {
    name: 'Push dispatch',
    ok: Boolean(VAPID_PRIVATE_KEY),
    cost: 'a witness is selected but never notified, so the phone never buzzes',
    vars: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
  },
  {
    name: 'Arc rail',
    ok: Boolean(PAY_TO_ARC && !/^0x0+$/.test(PAY_TO_ARC)),
    cost: 'the 402 advertises Hedera only; Circle Gateway has nowhere to pay',
    vars: ['PAY_TO_ARC'],
  },
  {
    name: 'Arc agent identity (ERC-8004)',
    ok: Boolean(ARC_AGENT_ID),
    cost: 'the agent card carries no Arc-native identifier',
    vars: ['ARC_PRIVATE_KEY', 'ARC_AGENT_ID'],
  },
];

const pad = (s: string, n: number) => s.padEnd(n);
const configured = checks.filter((c) => c.ok);
const missing = checks.filter((c) => !c.ok);

console.log('');
console.log(`Proctor configuration: ${configured.length}/${checks.length} legs live`);
console.log('');

for (const c of checks) {
  console.log(`  ${c.ok ? '\x1b[32mOK  \x1b[0m' : '\x1b[33m--  \x1b[0m'} ${pad(c.name, 30)} ${c.ok ? '' : c.cost}`);
}

if (missing.length > 0) {
  console.log('');
  console.log('Set these to close the gaps:');
  for (const c of missing) console.log(`  ${pad(c.name, 30)} ${c.vars.join(', ')}`);
}

console.log('');
console.log(`  facilitator (Hedera)  ${FACILITATOR_URL}`);
console.log(`  facilitator (Arc)     ${ARC_FACILITATOR_URL}`);
console.log(`  World mode            ${WORLD_MODE}${WORLD_MODE === 'DEVICE' ? '  (Selfie Check flag not granted)' : ''}`);
console.log('');

// The single question a reader actually has.
const verifiable = Boolean(ATTESTOR_PRIVATE_KEY && HEDERA_OPERATOR_ID && HEDERA_TOPIC_ID);
console.log(
  verifiable
    ? '\x1b[32mRecords produced by this configuration are independently verifiable.\x1b[0m'
    : '\x1b[33mRecords produced by this configuration are NOT independently verifiable.\x1b[0m\n' +
      'The oversight loop runs and the mechanism is real, but without an attestor key and a\n' +
      'topic there is nothing a third party can check. Fine for a walkthrough, not evidence.',
);
console.log('');
