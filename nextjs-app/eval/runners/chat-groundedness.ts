import type { SupabaseClient } from '@supabase/supabase-js';
import { repeatsPreviousAnswer } from '../lib/memory-checks';
import { callLlm } from '@/lib/ai/openai-client';
import { classifyQuery } from '@/lib/ai/query-classifier';
import { assembleChatMessages, validateCitations, isCannotFindAnswer } from '@/lib/services/chat-service';
import { getServerConfig } from '@/lib/utils/server-config';
import { normalise } from '@/lib/utils/normalise-text';
import { CHAT_QA } from '../datasets/chat-qa';
import { HALLUCINATION_PROBES } from '../datasets/hallucination';
import { MEMORY_CASES } from '../datasets/chat-memory';
import { contractById, pageCountOf } from '../lib/dataset';
import type { ChatQaPair } from '../lib/types';

/**
 * Chat groundedness (spec 17 §2, ≤ 5% hallucinated) and the per-deploy
 * hallucination regression (§5). Runs the shipped chat path: the same
 * deterministic classifier, the same context assembly, the same citation
 * validation.
 */

export type ChatVerdict = 'grounded' | 'not-found' | 'hallucinated';

export interface ChatOutcome {
  contract_id: string;
  question: string;
  label: string;
  queryClass: string;
  answer: string;
  citedPages: number[];
  verdict: ChatVerdict;
  reason: string;
}

async function ask(params: {
  supabase: SupabaseClient;
  operatorId: string;
  contractId: string;
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  const cfg = getServerConfig();
  const contract = contractById(params.contractId);
  const queryClass = classifyQuery(params.question, params.history.length > 0);

  const messages = assembleChatMessages({
    queryClass,
    contractText: contract.text,
    history: params.history,
    userMessage: params.question,
    maxHistoryTokens: cfg.MAX_CHAT_HISTORY_TOKENS,
  });

  const result = await callLlm({
    purpose: 'chat',
    messages,
    temperature: cfg.OPENAI_CHAT_TEMPERATURE,
    maxTokens: cfg.OPENAI_CHAT_MAX_TOKENS,
    userId: params.operatorId,
    supabase: params.supabase,
  });

  const citation = validateCitations(result.content, pageCountOf(contract), queryClass);
  return { queryClass, answer: result.content, citation };
}

function judge(pair: ChatQaPair, answer: string, citedPages: number[]): { verdict: ChatVerdict; reason: string } {
  const refused = isCannotFindAnswer(answer);

  if (pair.label === 'not-found') {
    // The only correct answer to an absent topic is the refusal. Anything
    // else is the model inventing contract content.
    return refused
      ? { verdict: 'not-found', reason: 'correctly refused' }
      : { verdict: 'hallucinated', reason: 'answered a question the contract does not cover' };
  }

  if (refused) {
    return { verdict: 'not-found', reason: 'refused a question the contract does answer' };
  }

  if (pair.expected_contains && !normalise(answer).includes(normalise(pair.expected_contains))) {
    return {
      verdict: 'hallucinated',
      reason: `answer does not contain the documented fact "${pair.expected_contains}"`,
    };
  }

  if (pair.expected_page !== undefined && !citedPages.includes(pair.expected_page)) {
    return {
      verdict: 'grounded',
      reason: `correct fact, cited ${citedPages.join(',') || 'nothing'} rather than page ${pair.expected_page}`,
    };
  }

  return { verdict: 'grounded', reason: 'grounded and correctly cited' };
}

export async function chatGroundedness(params: { supabase: SupabaseClient; operatorId: string }) {
  const outcomes: ChatOutcome[] = [];

  for (const pair of CHAT_QA) {
    const { queryClass, answer, citation } = await ask({
      ...params,
      contractId: pair.contract_id,
      question: pair.question,
      history: [],
    });
    const { verdict, reason } = judge(pair, answer, citation.citedPages);
    outcomes.push({
      contract_id: pair.contract_id,
      question: pair.question,
      label: pair.label,
      queryClass,
      answer,
      citedPages: citation.citedPages,
      verdict,
      reason,
    });
    console.log(`  chat: ${pair.contract_id} "${pair.question.slice(0, 40)}…" → ${verdict}`);
  }

  const hallucinated = outcomes.filter((o) => o.verdict === 'hallucinated');
  return {
    outcomes,
    total: outcomes.length,
    hallucinated: hallucinated.length,
    rate: outcomes.length === 0 ? null : hallucinated.length / outcomes.length,
    failures: hallucinated,
  };
}

/** Every probe is about an absent topic; the refusal is the only pass. */
export async function hallucinationRegression(params: {
  supabase: SupabaseClient;
  operatorId: string;
}) {
  const failures: Array<{ contract_id: string; question: string; answer: string }> = [];

  for (const probe of HALLUCINATION_PROBES) {
    const { answer } = await ask({ ...params, contractId: probe.contract_id, question: probe.question, history: [] });
    if (!isCannotFindAnswer(answer)) {
      failures.push({ contract_id: probe.contract_id, question: probe.question, answer });
    }
    console.log(`  hallucination: ${probe.contract_id} → ${isCannotFindAnswer(answer) ? 'refused' : 'ANSWERED'}`);
  }

  return {
    total: HALLUCINATION_PROBES.length,
    failures,
    rate: failures.length / HALLUCINATION_PROBES.length,
  };
}

/**
 * Conversational memory. This runner exists because of a specific escape: the
 * live four-turn memory test failed on both classification turns while every
 * unit test was green, because those tests called classifyQuery directly and
 * never reached the prompt the model is sent. Each case is a sequence, and the
 * assertion is on the ANSWER, not the class.
 */
export async function memoryRegression(params: { supabase: SupabaseClient; operatorId: string }) {
  const failures: Array<{ case: string; turn: string; expected: string; got: string }> = [];
  let turnsRun = 0;

  for (const testCase of MEMORY_CASES) {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const turn of testCase.turns) {
      const { queryClass, answer } = await ask({
        ...params,
        contractId: testCase.contract_id,
        question: turn.question,
        history: [...history],
      });
      turnsRun += 1;

      if (queryClass !== turn.expectedClass) {
        failures.push({
          case: testCase.name,
          turn: turn.question,
          expected: `class ${turn.expectedClass}`,
          got: `class ${queryClass}`,
        });
      }

      const refused = isCannotFindAnswer(answer);
      if (refused !== turn.expectRefusal) {
        failures.push({
          case: testCase.name,
          turn: turn.question,
          expected: turn.expectRefusal ? 'the refusal' : 'a substantive answer',
          got: refused ? 'the refusal' : answer.slice(0, 120),
        });
      } else if (
        turn.expectedContains &&
        !refused &&
        !normalise(answer).includes(normalise(turn.expectedContains))
      ) {
        failures.push({
          case: testCase.name,
          turn: turn.question,
          expected: `an answer containing "${turn.expectedContains}"`,
          got: answer.slice(0, 120),
        });
      }

      if (turn.mustNotRepeatPrevious) {
        const previous = [...history].reverse().find((m) => m.role === 'assistant')?.content;
        if (repeatsPreviousAnswer(answer, previous)) {
          failures.push({
            case: testCase.name,
            turn: turn.question,
            expected: 'a new answer (a summary), not the previous answer verbatim',
            got: answer.slice(0, 120),
          });
        }
      }

      history.push({ role: 'user', content: turn.question });
      history.push({ role: 'assistant', content: answer });
      console.log(`  memory: ${testCase.name} · "${turn.question.slice(0, 35)}…" → ${queryClass}${refused ? ' (refused)' : ''}`);
    }
  }

  return { turnsRun, failures };
}
