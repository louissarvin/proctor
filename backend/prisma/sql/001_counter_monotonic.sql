-- Issuance counters must be monotonic for the LIFETIME OF THE ISSUER.
--
-- Not per topic, and not per environment. `Decision.orgSeq` is signed into an
-- attestation and committed to an append-only log with no admin key. Lowering
-- the counter lets a later decision reuse a number that is already on that log,
-- and the two records then become indistinguishable from a withheld one: the
-- completeness check sees min..max with a hole in the middle and correctly
-- reports evidence as missing, forever, on a log nobody can edit.
--
-- This is not hypothetical. Resetting a demo counter by hand produced exactly
-- that: a topic permanently carrying sq 1,2,3 and 12,13,14 from one issuer,
-- with 4..11 unexplainable. Prisma cannot express the constraint, so it lives
-- here and is applied by `bun run db:constraints`.
CREATE OR REPLACE FUNCTION proctor_counter_never_decreases()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."decisionCounter" < OLD."decisionCounter" THEN
    RAISE EXCEPTION
      'decisionCounter must never decrease (% -> %). Issuance numbers are committed to an append-only log; reusing one is indistinguishable from withholding a record.',
      OLD."decisionCounter", NEW."decisionCounter";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS org_counter_monotonic ON "Org";
CREATE TRIGGER org_counter_monotonic
  BEFORE UPDATE ON "Org"
  FOR EACH ROW EXECUTE FUNCTION proctor_counter_never_decreases();
