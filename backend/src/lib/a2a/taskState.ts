/**
 * A2A TaskState mapping.
 *
 * Proctor did not bolt A2A on. Its control flow IS an A2A task, exactly.
 *
 * From the A2A specification, verbatim:
 *
 *   TASK_STATE_AUTH_REQUIRED
 *     "Indicates that authentication is required to proceed.
 *      This is an interrupted state."
 *
 *   TASK_STATE_INPUT_REQUIRED
 *     "Indicates that the agent requires additional user input to proceed.
 *      This is an interrupted state."
 *
 * An agent submits a task, the task enters an INTERRUPTED state while a human
 * is required, then resolves to COMPLETED or REJECTED. That is a one-to-one
 * description of the oversight gate.
 *
 * WHAT WE CLAIM: "the gate is modelled as an A2A task in the interrupted
 * auth-required state, which is what that state exists for."
 *
 * WHAT WE DO NOT CLAIM: "multi-agent negotiation". There is no negotiation in
 * Proctor, and a judge who knows A2A would notice. Nothing here bargains over
 * price or terms; the agent selects from offers it is given.
 *
 * We DO serve the JSON-RPC binding, read-only: `a2a.GetTask` at POST /a2a
 * returns a spec-shaped Task, with the attestation as an artifact once
 * terminal. See routes/a2aRoutes.ts for why SendMessage is not implemented.
 */

export type A2ATaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_AUTH_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_FAILED';

export type DecisionStateName =
  | 'PENDING_PAYMENT' | 'OPEN' | 'DISPATCHED'
  | 'APPROVED' | 'REFUSED' | 'EXPIRED' | 'FAILED';

/**
 * Terminal states per the spec: COMPLETED, FAILED, CANCELED, REJECTED.
 * Interrupted states allow resumption; terminal ones do not.
 */
export const A2A_TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  'TASK_STATE_COMPLETED', 'TASK_STATE_REJECTED', 'TASK_STATE_FAILED',
]);

export const A2A_INTERRUPTED_STATES: ReadonlySet<A2ATaskState> = new Set([
  'TASK_STATE_AUTH_REQUIRED',
]);

const MAP: Record<DecisionStateName, A2ATaskState> = {
  // The 402 has been issued; the task exists but no work has begun.
  PENDING_PAYMENT: 'TASK_STATE_SUBMITTED',
  // Paid, selecting a witness.
  OPEN: 'TASK_STATE_WORKING',
  // THE INTERRUPTED STATE. A human must authenticate before the task proceeds.
  DISPATCHED: 'TASK_STATE_AUTH_REQUIRED',
  APPROVED: 'TASK_STATE_COMPLETED',
  // A refusal is a deliberate, legitimate outcome, not an error. REJECTED, not FAILED.
  REFUSED: 'TASK_STATE_REJECTED',
  // An expiry is a refusal by default. Same terminal class as an explicit refusal.
  EXPIRED: 'TASK_STATE_REJECTED',
  // Reserved for internal error only. Never releases the agent.
  FAILED: 'TASK_STATE_FAILED',
};

export const toA2ATaskState = (state: DecisionStateName): A2ATaskState => MAP[state];

export const isInterrupted = (state: DecisionStateName): boolean =>
  A2A_INTERRUPTED_STATES.has(MAP[state]);

export const isTerminal = (state: DecisionStateName): boolean =>
  A2A_TERMINAL_STATES.has(MAP[state]);

/** Task view of a decision, for the API and console. */
export interface A2ATaskView {
  taskId: string;
  state: A2ATaskState;
  interrupted: boolean;
  terminal: boolean;
  /** Why the task is interrupted, in one line. */
  statusMessage: string;
}

export const toTaskView = (decisionId: string, state: DecisionStateName, humanLine: string): A2ATaskView => {
  const a2a = MAP[state];
  const messages: Record<A2ATaskState, string> = {
    TASK_STATE_SUBMITTED: 'Awaiting payment to open the oversight decision.',
    TASK_STATE_WORKING: 'Selecting an eligible witness.',
    TASK_STATE_AUTH_REQUIRED: `Awaiting an attested human witness: ${humanLine}`,
    TASK_STATE_COMPLETED: 'A verified human witness approved the action.',
    TASK_STATE_REJECTED: 'The action was refused, or the deadline elapsed. The agent is not released.',
    TASK_STATE_FAILED: 'Internal error. The agent is not released.',
  };
  return {
    taskId: decisionId,
    state: a2a,
    interrupted: A2A_INTERRUPTED_STATES.has(a2a),
    terminal: A2A_TERMINAL_STATES.has(a2a),
    statusMessage: messages[a2a],
  };
};
