import { test, expect } from 'bun:test';
import { TransferTransaction, TransactionId, AccountId, TokenId, Timestamp } from '@hiero-ledger/sdk';
import { extractPayer } from '../src/lib/x402/payer.ts';

const AGENT = '0.0.10359475';
const FACILITATOR = '0.0.7162784';
const TREASURY = '0.0.10349677';

/** A real signed-shape Hedera transfer whose FEE PAYER is not the spender. */
const hederaPayload = (): { payload: { transaction: string } } => {
  const tx = new TransferTransaction()
    .addTokenTransfer(TokenId.fromString('0.0.10394781'), AccountId.fromString(AGENT), -420000)
    .addTokenTransfer(TokenId.fromString('0.0.10394781'), AccountId.fromString(TREASURY), 420000)
    // The facilitator pays the network fee, exactly as Blocky402 does.
    .setTransactionId(TransactionId.withValidStart(AccountId.fromString(FACILITATOR), new Timestamp(1788967997, 0)))
    .setNodeAccountIds([AccountId.fromString('0.0.3')])
    .freeze();
  return { payload: { transaction: Buffer.from(tx.toBytes()).toString('base64') } };
};

test('THE BUG: the payer is the spender, never the fee payer', () => {
  // transactionId.accountId is the FACILITATOR on every Hedera x402 settlement.
  // Recording it would name the wrong party in the audit trail.
  const payer = extractPayer(hederaPayload());
  expect(payer).toBe(AGENT);
  expect(payer).not.toBe(FACILITATOR);
});

test('an EVM authorization names `from`', () => {
  expect(extractPayer({ payload: { authorization: { from: '0xabc' } } })).toBe('0xabc');
  expect(extractPayer({ payload: { from: '0xdef' } })).toBe('0xdef');
});

test('never throws on a shape it does not know', () => {
  // A settled payment must not be undone because we could not label it.
  expect(extractPayer(undefined)).toBeNull();
  expect(extractPayer({})).toBeNull();
  expect(extractPayer({ payload: { transaction: 'not-base64!!' } })).toBeNull();
  expect(extractPayer({ payload: { transaction: '' } })).toBeNull();
});
