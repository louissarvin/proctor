import { test, expect } from 'bun:test';
import {
  createOfferEIP712,
  verifyOfferSignatureEIP712,
  isEIP712SignedOffer,
} from '@x402/extensions/offer-receipt';
import { attestorAccount } from '../src/lib/attestation/build.ts';
import { hederaGateOption } from '../src/lib/x402/server.ts';

/**
 * The x402-native half of the evidence story.
 *
 * The HCS attestation is OUR record of what a human decided. A signed offer is
 * the PROTOCOL's record of what we committed to charge, produced BEFORE the
 * witness has decided anything, and checkable by a third party holding only the
 * x402 library and our published attestor address.
 *
 * The property that matters: we cannot reprice a decision once we know its
 * outcome, because we already signed the terms.
 *
 * These exercise the same primitives the resource-server extension uses, with
 * the same key. The live wire format is asserted separately by booting the
 * server; this file keeps the cryptographic property hermetic and fast.
 */
const RESOURCE = 'https://proctor.test/v1/gate/decisions';

const signedOffer = async () => {
  const account = attestorAccount();
  const gate = hederaGateOption();

  return createOfferEIP712(
    RESOURCE,
    {
      acceptIndex: 0,
      scheme: gate.scheme,
      network: gate.network,
      asset: '0.0.429274',
      payTo: gate.payTo,
      amount: '420000',
    },
    account.signTypedData.bind(account),
  );
};

test('an offer is signed by the SAME key that signs the HCS attestation', async () => {
  const offer = await signedOffer();
  expect(isEIP712SignedOffer(offer)).toBe(true);

  const result = await verifyOfferSignatureEIP712(offer);

  // One published address lets an auditor check both artefacts. Two keys would
  // mean two things to publish and two things to get wrong.
  expect(result.signer.toLowerCase()).toBe(attestorAccount().address.toLowerCase());
});

test('the offer commits to the terms a buyer would be held to', async () => {
  const { payload } = await verifyOfferSignatureEIP712(await signedOffer());

  expect(payload.resourceUrl).toBe(RESOURCE);
  expect(payload.network).toBe('hedera:testnet');
  expect(payload.asset).toBe('0.0.429274');
  expect(payload.amount).toBe('420000');
  // An offer with no expiry is an open-ended commitment.
  expect(payload.validUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
});

test('TAMPER: repricing a signed offer cannot be attributed to the attestor', async () => {
  const offer = await signedOffer();
  const honest = await verifyOfferSignatureEIP712(offer);

  // Charge ten times more, after the fact.
  const forged = {
    ...offer,
    payload: { ...offer.payload, amount: String(BigInt(offer.payload.amount) * 10n) },
  };
  const tampered = await verifyOfferSignatureEIP712(forged as never);

  // Recovery still SUCCEEDS on forged data: ECDSA recovery always yields some
  // address. It yields a different one. That distinction is the whole check,
  // and treating "recovery did not throw" as "signature is valid" is how this
  // gets implemented wrong.
  expect(tampered.signer.toLowerCase()).not.toBe(honest.signer.toLowerCase());
  expect(honest.signer.toLowerCase()).toBe(attestorAccount().address.toLowerCase());
});

test('TAMPER: redirecting the payee cannot be attributed either', async () => {
  const offer = await signedOffer();
  const honest = await verifyOfferSignatureEIP712(offer);

  const forged = { ...offer, payload: { ...offer.payload, payTo: '0.0.999999' } };
  const tampered = await verifyOfferSignatureEIP712(forged as never);

  expect(tampered.signer.toLowerCase()).not.toBe(honest.signer.toLowerCase());
});
