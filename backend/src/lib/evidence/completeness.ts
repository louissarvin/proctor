/**
 * Evidence completeness.
 *
 * The running hash answers "was this log altered?". It cannot answer "is this
 * log complete?", and those are different questions. Deleting a message breaks
 * the chain and is caught. Never submitting one leaves the chain pristine.
 *
 * That is the honest hole in every tamper-evident log, and it is the one an
 * operator would actually use: you do not forge a refusal, you just decline to
 * publish it. Postgres has it, HCS does not, and nothing looks wrong.
 *
 * Proctor closes it by numbering decisions densely per org at ISSUE time and
 * signing that number into the attestation. A withheld record is then a hole in
 * a sequence that a third party can see, and the operator cannot renumber
 * around it because every neighbouring number is already committed to a topic
 * with no admin key under a consensus timestamp they did not choose.
 *
 * What this still does NOT prove, stated rather than hidden: an operator can
 * stop writing entirely from some point on. A trailing gap is indistinguishable
 * from "no decisions happened". That failure is loud where suppression is
 * silent, which is the whole improvement.
 */

/** One issuance number, as known locally. */
export interface AttestedSeq {
  orgSeq: number;
  /** HCS sequence number, present once the record reached consensus. */
  sequenceNumber: string | null;
  /** Set when the record exists locally but never reached HCS. */
  unpublished?: boolean;
  /**
   * Has this decision reached an outcome?
   *
   * An OPEN decision owes the log nothing yet. Treating it as a gap is a false
   * accusation of withholding evidence, and decisions resolve OUT OF ORDER, so
   * an in-flight number routinely sits below an already-attested one. Defaults
   * true so existing callers keep their meaning.
   */
  resolved?: boolean;
}

export type GapKind = 'missing' | 'unpublished';

export interface Gap {
  orgSeq: number;
  kind: GapKind;
}

export interface CompletenessReport {
  /** Highest issuance number the org has ever assigned. */
  issued: number;
  /** How many of those are on the evidence log. */
  attested: number;
  gaps: Gap[];
  complete: boolean;
  /** Lowest issuance number this log can speak to. */
  from: number;
  /**
   * Numbers above the highest attested one. Reported apart from gaps because a
   * trailing run is the expected shape of "decisions still in flight", while an
   * interior hole never has an innocent explanation.
   */
  trailing: number[];
  /** Issued, not yet resolved. Owes the log nothing until it has an outcome. */
  inFlight: number[];
}

/**
 * Reconcile issued numbers against attested ones.
 *
 * `issued` is the org's counter, the highest number ever handed out. Anything
 * at or below it must eventually appear on the log.
 *
 * Interior holes are the finding. A trailing run is separated out so a console
 * does not cry wolf over decisions that are merely still open.
 */
export const reconcile = (issued: number, attested: AttestedSeq[], from = 1): CompletenessReport => {
  const published = new Map<number, AttestedSeq>();
  for (const a of attested) published.set(a.orgSeq, a);

  const highestAttested = attested.reduce(
    (max, a) => (a.sequenceNumber !== null && a.orgSeq > max ? a.orgSeq : max),
    0,
  );

  const gaps: Gap[] = [];
  const trailing: number[] = [];
  const inFlight: number[] = [];

  // Start at the lowest number this LOG can speak to, not at 1.
  //
  // Completeness is a property of a given log, not of an issuer's whole
  // history. An issuer that has written to an earlier topic carries issuance
  // numbers that legitimately are not on this one, and counting those as gaps
  // accuses an operator of withholding records that are simply filed
  // elsewhere. The offline verifier bounds its claim the same way.
  for (let n = Math.max(1, from); n <= issued; n++) {
    const row = published.get(n);

    // On the log. Nothing to say.
    if (row && row.sequenceNumber !== null) continue;

    // Issued but not yet decided. Not late, not withheld: in flight. Decisions
    // resolve out of order, so this legitimately sits below attested numbers.
    if (row && row.resolved === false) {
      inFlight.push(n);
      continue;
    }

    // Above every published record: still in flight, not yet suppressed.
    if (n > highestAttested) {
      trailing.push(n);
      continue;
    }

    // Interior. Either we hold it and never published it, or it is simply gone.
    gaps.push({ orgSeq: n, kind: row ? 'unpublished' : 'missing' });
  }

  return {
    issued,
    from: Math.max(1, from),
    attested: attested.filter((a) => a.sequenceNumber !== null).length,
    gaps,
    complete: gaps.length === 0,
    trailing,
    inFlight,
  };
};

/** One-line summary for a console or a CLI. */
export const describe = (r: CompletenessReport): string => {
  // Name the RANGE, not just the count. "3 of 17" reads as fourteen missing
  // records when it means "this log covers 15..17 and all three are present".
  const range = `#${r.from}..#${r.issued}`;
  return r.complete
    ? `PASS  ${range} on this evidence log, no interior gaps (${r.attested} attested).`
    : `FAIL  ${r.gaps.length} decision(s) in ${range} issued but absent from this evidence log: ` +
      r.gaps.map((g) => `#${g.orgSeq} (${g.kind})`).join(', ');
};
