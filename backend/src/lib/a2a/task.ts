/**
 * Spec-shaped A2A Task objects.
 *
 * `toTaskView` (taskState.ts) is a convenience summary carried inside our own
 * REST responses. It is NOT the wire object an A2A client expects. This builds
 * that one, per the specification's Task shape:
 *
 *   id, contextId, status { state, message, timestamp }, artifacts, history, metadata
 *
 * The interesting part for Proctor is the artifact. Once a decision is
 * terminal, the evidence record is returned to the calling agent as a Task
 * artifact, so an A2A client receives the attestation without knowing anything
 * about Hedera: the decision hash, the topic, and the sequence number it can
 * re-verify against a public mirror node.
 */
import { toA2ATaskState, A2A_TERMINAL_STATES, type A2ATaskState, type DecisionStateName } from './taskState.ts';

export interface A2AMessage {
  role: 'agent' | 'user';
  parts: { kind: 'text'; text: string }[];
  messageId: string;
  taskId: string;
}

export interface A2AArtifact {
  artifactId: string;
  name: string;
  description: string;
  parts: { kind: 'data'; data: Record<string, unknown> }[];
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: { state: A2ATaskState; message: A2AMessage; timestamp: string };
  artifacts: A2AArtifact[];
  history: A2AMessage[];
  metadata: Record<string, unknown>;
}

/** One row of the append-only decision trail. */
export interface TaskEvent { kind: string; at: Date }

export interface TaskSource {
  id: string;
  state: DecisionStateName;
  humanLine: string;
  orgSlug: string;
  orgSeq: number;
  decisionHash: string;
  outcome: string | null;
  statusMessage: string;
  attestation: { sequenceNumber: string | null; topicId: string | null } | null;
  events: TaskEvent[];
}

export const buildA2ATask = (d: TaskSource): A2ATask => {
  const state = toA2ATaskState(d.state);
  const artifacts: A2AArtifact[] = [];

  // Only once terminal. An in-flight decision has no evidence record yet, and
  // emitting a half-formed one would invite a client to treat it as final.
  if (A2A_TERMINAL_STATES.has(state) && d.attestation?.sequenceNumber) {
    artifacts.push({
      artifactId: `attestation-${d.id}`,
      name: 'oversight-attestation',
      description: 'Tamper-evident record of the human decision, on a Hedera topic with no admin key.',
      parts: [{
        kind: 'data',
        data: {
          decisionHash: d.decisionHash,
          outcome: d.outcome,
          orgSeq: d.orgSeq,
          topicId: d.attestation.topicId,
          sequenceNumber: d.attestation.sequenceNumber,
          verify: `https://hashscan.io/testnet/topic/${d.attestation.topicId}`,
        },
      }],
    });
  }

  return {
    id: d.id,
    // Decisions are scoped to an org, which is the natural A2A context.
    contextId: d.orgSlug,
    status: {
      state,
      message: {
        role: 'agent',
        parts: [{ kind: 'text', text: d.statusMessage }],
        messageId: `status-${d.id}`,
        taskId: d.id,
      },
      timestamp: new Date().toISOString(),
    },
    artifacts,
    // Only the event KIND and timestamp. `detail` carries payer addresses and
    // verification outcomes, which the calling agent has no need for and which
    // would leak another party's data into a task response.
    history: d.events.map((e, i) => ({
      role: 'agent' as const,
      parts: [{ kind: 'text' as const, text: e.kind }],
      messageId: `event-${d.id}-${i}`,
      taskId: d.id,
    })),
    metadata: {
      humanLine: d.humanLine,
      // The claim an auditor checks. Dense per org, so a hole is visible.
      orgSeq: d.orgSeq,
    },
  };
};
