/**
 * Standalone OpenAI stub for Playwright.
 *
 * The integration harness starts its stub in-process and hands the app an
 * `OPENAI_BASE_URL` (handoff §5). Playwright's app is a separate `next dev`
 * process it starts itself, so the stub has to be a real server on a known
 * port, with a control channel the spec files can drive over HTTP.
 *
 *   POST /v1/chat/completions   the model
 *   POST /__control/script      { responses: [{ content, status?, delayMs? }] }
 *   GET  /__control/requests    every request body the app has sent
 *   POST /__control/reset       clear queues and logs
 *   POST /__control/script-enhancer   { responses: [...] } for the query enhancer
 *   GET  /__control/enhancer-requests every query-enhancer request
 *
 * Query-enhancer calls (spec 08 v1.1 §B) have their own queue and log, as in
 * the integration harness: an enhancer call never consumes a scripted answer,
 * and unscripted it answers {"query": null} — no rewrite.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.OPENAI_STUB_PORT ?? 3300);

let responseQueue = [];
let requestLog = [];
let enhancerQueue = [];
let enhancerLog = [];

const ENHANCER_REQUEST = /^Rewrite the user's question about a contract/;
const NO_REWRITE = { content: '{"query": null}' };

function isEnhancerRequest(request) {
  const first = request.messages?.[0];
  return first?.role === 'system' && ENHANCER_REQUEST.test(first.content ?? '');
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/__control/reset') {
    responseQueue = [];
    requestLog = [];
    enhancerQueue = [];
    enhancerLog = [];
    res.writeHead(200).end('{}');
    return;
  }

  if (url.pathname === '/__control/script') {
    const { responses } = JSON.parse(await readBody(req));
    responseQueue = [...responses];
    res.writeHead(200).end('{}');
    return;
  }

  if (url.pathname === '/__control/script-enhancer') {
    const { responses } = JSON.parse(await readBody(req));
    enhancerQueue = [...responses];
    res.writeHead(200).end('{}');
    return;
  }

  if (url.pathname === '/__control/enhancer-requests') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(enhancerLog));
    return;
  }

  if (url.pathname === '/__control/requests') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(requestLog));
    return;
  }

  if (url.pathname.endsWith('/chat/completions')) {
    const body = await readBody(req);
    let request;
    try {
      request = JSON.parse(body);
    } catch {
      request = { model: 'unparsed', messages: [] };
    }

    // The last scripted response repeats once the queue drains, matching the
    // integration harness.
    let response;
    if (isEnhancerRequest(request)) {
      enhancerLog.push(request);
      response = (enhancerQueue.length > 1 ? enhancerQueue.shift() : enhancerQueue[0]) ?? NO_REWRITE;
    } else {
      requestLog.push(request);
      const next = responseQueue.length > 1 ? responseQueue.shift() : responseQueue[0];
      response = next ?? { content: '{}' };
    }

    if (response.delayMs) await new Promise((r) => setTimeout(r, response.delayMs));

    const status = response.status ?? 200;
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'stubbed failure', type: 'server_error' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-stub',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          { index: 0, message: { role: 'assistant', content: response.content }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
      }),
    );
    return;
  }

  res.writeHead(404).end('{}');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`openai stub listening on ${PORT}`);
});
