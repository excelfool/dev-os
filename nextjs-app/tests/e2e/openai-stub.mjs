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
 *   POST /__control/reset       clear queue and log
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.OPENAI_STUB_PORT ?? 3300);

let responseQueue = [];
let requestLog = [];

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
    res.writeHead(200).end('{}');
    return;
  }

  if (url.pathname === '/__control/script') {
    const { responses } = JSON.parse(await readBody(req));
    responseQueue = [...responses];
    res.writeHead(200).end('{}');
    return;
  }

  if (url.pathname === '/__control/requests') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(requestLog));
    return;
  }

  if (url.pathname.endsWith('/chat/completions')) {
    const body = await readBody(req);
    try {
      requestLog.push(JSON.parse(body));
    } catch {
      requestLog.push({ model: 'unparsed', messages: [] });
    }

    // The last scripted response repeats once the queue drains, matching the
    // integration harness.
    const next = responseQueue.length > 1 ? responseQueue.shift() : responseQueue[0];
    const response = next ?? { content: '{}' };

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
