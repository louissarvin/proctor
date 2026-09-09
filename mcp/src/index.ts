#!/usr/bin/env node
/**
 * Proctor MCP server.
 *
 * MCP's own specification says, verbatim:
 *
 *   "For trust & safety and security, there SHOULD always be a human in the
 *    loop with the ability to deny tool invocations."
 *
 * It then provides no mechanism for one. Every client implements its own
 * confirmation dialog, locally, with nothing to show afterwards. An operator
 * who needs to prove a person approved a specific action has a screenshot.
 *
 * This server is that mechanism. `request_human_approval` blocks the agent on
 * a real person who is NOT the operator, fails closed on the deadline, and
 * returns a citation the caller can verify on a public ledger without trusting
 * us or the agent.
 *
 * The oversight path — evaluate, open, poll, report — has NO dependencies:
 * JSON-RPC 2.0 over stdio is a loop, and adding an SDK to a security tool is how
 * it acquires a supply chain. The x402 client is imported lazily in `pay.ts`,
 * only when a wallet is configured, so an integrator pointing at a hosted
 * Proctor never loads a Hedera SDK to ask a human a question.
 */
const PROCTOR_API = process.env.PROCTOR_API ?? 'http://localhost:3700';
const POLL_MS = 1_000;

/**
 * PAID mode when a wallet is configured, operator mode otherwise.
 *
 * In paid mode the tool hits the real x402 gate and settles through a
 * facilitator. The gate then does NOT hand back a witness link, on purpose: an
 * agent that could reach the approval URL could approve its own decision, which
 * is the one property this product sells. The human is reached through the
 * operator's own rota instead.
 */
const AGENT_ID = process.env.HEDERA_AGENT_ID ?? '';
const AGENT_KEY = process.env.HEDERA_AGENT_KEY ?? '';
const PAID = Boolean(AGENT_ID && AGENT_KEY);

interface Rpc { jsonrpc: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

const send = (msg: unknown): void => { process.stdout.write(`${JSON.stringify(msg)}\n`); };
const ok = (id: unknown, result: unknown): void => send({ jsonrpc: '2.0', id, result });
const err = (id: unknown, code: number, message: string): void => send({ jsonrpc: '2.0', id, error: { code, message } });

/** Unstructured text plus structured content, which the spec asks for together. */
const toolResult = (text: string, structured?: Record<string, unknown>, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(structured ? { structuredContent: structured } : {}),
  isError,
});

const TOOLS = [
  {
    name: 'request_human_approval',
    title: 'Request human approval',
    description:
      'Block until a verified human who is NOT the operator of this agent approves or refuses a ' +
      'high-risk action. Fails closed: no answer before the deadline is a refusal. Returns a ' +
      'tamper-evident citation on a Hedera topic with no admin key, so the decision can be proven ' +
      'to a third party later. Use before any irreversible or high-value action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'What the agent is about to do, in plain language.' },
        amount: { type: 'string', description: 'Amount, as a decimal string. Drives the policy threshold.' },
        counterparty: { type: 'string', description: 'Who receives the value.' },
        ttlSeconds: { type: 'number', description: 'Deadline. Default 300, max 900.' },
      },
      required: ['action'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        approved: { type: 'boolean' },
        outcome: { type: 'string', description: 'APPROVE, REFUSE or EXPIRE.' },
        escalated: { type: 'boolean', description: 'False when policy allowed it without a human.' },
        decisionHash: { type: 'string' },
        evidence: { type: 'string', description: 'Where the record can be verified.' },
      },
      required: ['approved', 'outcome'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
] as const;

const api = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const res = await fetch(`${PROCTOR_API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json() as { data?: Record<string, unknown>; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.data ?? {};
};

const requestApproval = async (args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> => {
  const action = String(args['action'] ?? '').slice(0, 200);
  if (!action) return toolResult('`action` is required.', undefined, true);

  const amount = String(args['amount'] ?? '41200.00');
  const counterparty = String(args['counterparty'] ?? action);
  const ttlSeconds = Math.min(Number(args['ttlSeconds']) || 300, 900);
  const gateAction = { kind: 'transfer', asset: 'EUR', amount, counterparty };

  // ALWAYS evaluate first. This call is free, and most actions stop here. An
  // oversight tool that pays on every invocation is one the agent's owner
  // switches off within a day.
  const verdict = await api('/v1/gate/evaluate', {
    method: 'POST',
    body: JSON.stringify({ action: gateAction }),
  });
  if (verdict['escalate'] === false) {
    return toolResult(
      `Proceed. Policy did not require a human (${String(verdict['reason'])}).`,
      { approved: true, outcome: 'NOT_REQUIRED', escalated: false },
    );
  }

  let decisionId: string;
  let decisionHash: string;
  let witnessUrl: string | null = null;
  let paid = false;

  if (PAID) {
    const { makePayingFetch } = await import('./pay.js');
    const payingFetch = makePayingFetch(AGENT_ID, AGENT_KEY);
    const res = await payingFetch(`${PROCTOR_API}/v1/gate/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: gateAction }),
    });
    const body = await res.json() as { data?: Record<string, unknown>; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message ?? `gate HTTP ${res.status}`);
    const d = body.data ?? {};
    decisionId = String(d['decisionId']);
    decisionHash = String(d['decisionHash'] ?? '');
    paid = true;
    process.stderr.write('[proctor] paid the gate; a witness is being dispatched from the rota\n');
  } else {
    const run = await api('/v1/demo/run', {
      method: 'POST',
      body: JSON.stringify({ amount, counterparty, ttlSeconds }),
    });
    decisionId = String(run['decisionId']);
    decisionHash = String(run['decisionHash'] ?? '');
    witnessUrl = String(run['witnessUrl'] ?? '') || null;
    process.stderr.write(`[proctor] UNPAID operator mode. Awaiting a human: ${witnessUrl}\n`);
  }

  const deadline = Date.now() + ttlSeconds * 1000 + 15_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const d = await api(`/v1/evidence/decisions/${decisionId}`);
    const outcome = d['outcome'] as string | null;
    if (!outcome) continue;

    const att = d['attestation'] as { sequenceNumber?: string | number } | null;
    const seq = att?.sequenceNumber ? String(att.sequenceNumber) : null;
    const evidence = seq ? `HCS sequence #${seq}` : 'attestation pending';
    const approved = outcome === 'APPROVE';

    return toolResult(
      approved
        ? `Approved by a verified human. ${evidence}. You may proceed.`
        : `NOT approved (${outcome}). ${evidence}. Do not proceed.`,
      {
        approved, outcome, escalated: true, paid,
        decisionHash, evidence,
        ...(witnessUrl ? { witnessUrl } : {}),
      },
      // A refusal is a legitimate answer, not a tool failure. Reporting it as
      // isError invites a model to retry around it.
      false,
    );
  }

  return toolResult(
    'No human answered before the deadline. Treated as a refusal. Do not proceed.',
    { approved: false, outcome: 'EXPIRE', escalated: true, paid },
    false,
  );
};

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;

    let msg: Rpc;
    try { msg = JSON.parse(line) as Rpc; } catch { err(null, -32700, 'Parse error'); continue; }
    const { id, method } = msg;

    void (async () => {
      try {
        switch (method) {
          case 'initialize':
            return ok(id, {
              protocolVersion: '2025-06-18',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'proctor', version: '1.0.0' },
              instructions:
                'Call request_human_approval before any irreversible or high-value action. ' +
                'It fails closed: no answer by the deadline means do not proceed.',
            });
          case 'notifications/initialized':
            return; // A notification has no id and takes no response.
          case 'tools/list':
            return ok(id, { tools: TOOLS });
          case 'tools/call': {
            const name = String(msg.params?.['name'] ?? '');
            if (name !== 'request_human_approval') return err(id, -32602, `Unknown tool: ${name}`);
            const args = (msg.params?.['arguments'] ?? {}) as Record<string, unknown>;
            return ok(id, await requestApproval(args));
          }
          case 'ping':
            return ok(id, {});
          default:
            if (id === undefined || id === null) return;
            return err(id, -32601, `Method not found: ${method}`);
        }
      } catch (e) {
        // A reachability failure must not read as a refusal: "the gate is down"
        // and "a human said no" are different facts.
        if (id !== undefined && id !== null) {
          ok(id, toolResult(
            `Proctor is unreachable at ${PROCTOR_API}: ${e instanceof Error ? e.message : String(e)}. ` +
            'This is NOT a refusal. Do not proceed on an unverified action.',
            undefined, true,
          ));
        }
      }
    })();
  }
});
