/**
 * The policy engine. Pure, no I/O, four predicates.
 *
 * Deliberately NOT a generic policy language. Four predicates is a demo you can
 * read on screen in two seconds; a rules DSL is a different product.
 *
 * The overwhelming majority of agent actions never touch the gate. This
 * function answering "not required" is the common path, and it is free.
 */

export type ActionKind = 'transfer' | 'contract_call' | 'data_export' | 'custom';

export interface AgentAction {
  kind: ActionKind;
  asset: string;
  /** Decimal string. NEVER a float: money is never a float anywhere in this repo. */
  amount: string;
  counterparty: string;
  counterpartyAccount?: string;
  memo?: string;
}

export interface PolicyRules {
  /** Escalate at or above this amount. Decimal string. */
  amountThreshold: string;
  /** Action kinds that always escalate regardless of amount. */
  alwaysEscalateKinds: ActionKind[];
  /** Counterparties that never escalate (known-good suppliers). */
  allowlistedCounterparties: string[];
  /** Counterparties that always escalate. */
  denylistedCounterparties: string[];
}

export interface PolicyDecision {
  escalate: boolean;
  /** Which predicate fired. Shown in the console, and recorded in evidence. */
  reason: 'below_threshold' | 'amount_threshold' | 'action_kind' | 'denylisted' | 'allowlisted';
  humanLine: string;
}

/** Compare decimal strings without floats. */
const gte = (a: string, b: string): boolean => {
  const norm = (s: string) => {
    const [i = '0', f = ''] = s.replace(/[, ]/g, '').split('.');
    return { i: i.replace(/^0+(?=\d)/, ''), f };
  };
  const A = norm(a), B = norm(b);
  if (A.i.length !== B.i.length) return A.i.length > B.i.length;
  if (A.i !== B.i) return A.i > B.i;
  const len = Math.max(A.f.length, B.f.length);
  return A.f.padEnd(len, '0') >= B.f.padEnd(len, '0');
};

const fmtAmount = (amount: string): string => {
  const [i = '0', f] = amount.split('.');
  const withSep = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f && Number(f) > 0 ? `${withSep}.${f}` : withSep;
};

/** The single line the witness sees on their phone. Keep it one line. */
export const buildHumanLine = (action: AgentAction): string => {
  const amount = `${action.asset} ${fmtAmount(action.amount)}`;
  switch (action.kind) {
    case 'transfer':      return `Release ${amount} to ${action.counterparty}?`;
    case 'contract_call': return `Call ${action.counterparty} moving ${amount}?`;
    case 'data_export':   return `Export ${action.counterparty} dataset?`;
    default:              return `Approve ${amount} action with ${action.counterparty}?`;
  }
};

export const evaluatePolicy = (action: AgentAction, rules: PolicyRules): PolicyDecision => {
  const humanLine = buildHumanLine(action);

  // 1. Denylist wins over everything.
  if (rules.denylistedCounterparties.includes(action.counterparty)) {
    return { escalate: true, reason: 'denylisted', humanLine };
  }
  // 2. Allowlist skips the gate entirely.
  if (rules.allowlistedCounterparties.includes(action.counterparty)) {
    return { escalate: false, reason: 'allowlisted', humanLine };
  }
  // 3. Some action kinds always escalate regardless of amount.
  if (rules.alwaysEscalateKinds.includes(action.kind)) {
    return { escalate: true, reason: 'action_kind', humanLine };
  }
  // 4. Amount threshold.
  if (gte(action.amount, rules.amountThreshold)) {
    return { escalate: true, reason: 'amount_threshold', humanLine };
  }
  return { escalate: false, reason: 'below_threshold', humanLine };
};

/** The demo policy. EUR 41,200 to Meridian Logistics escalates on the threshold. */
export const DEMO_POLICY: PolicyRules = {
  amountThreshold: '25000',
  alwaysEscalateKinds: ['data_export'],
  allowlistedCounterparties: [],
  denylistedCounterparties: [],
};
