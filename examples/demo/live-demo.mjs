import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createRedactor, parseConfig } from '@qa-brain/core';
import { createGateway, createLogger } from '@qa-brain/gateway';
import { createSqliteStore } from '@qa-brain/store';
import { startStaticSite } from '../static-site/serve.js';

/** Headed demo: a real Chromium window opens and you watch QA Brain drive it. */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (t) => console.log(t);
const step = (n, t) => console.log(`\n\x1b[1m\x1b[36m[${n}]\x1b[0m \x1b[1m${t}\x1b[0m`);
const textOf = (r) =>
  r.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

const home = mkdtempSync(path.join(process.env.TEMP || '/tmp', 'qa-brain-live-'));
const dbUrl = `file:${path.join(home, 'demo.db').replace(/\\/g, '/')}`;

const PASSWORD = 'hunter2-secret';
const site = await startStaticSite();
say(`\n\x1b[2mExample shop running at ${site.url}\x1b[0m`);

step(1, 'Opening a real browser window — watch your screen');
const config = parseConfig({
  log: { level: 'silent' },
  store: { driver: 'sqlite', url: dbUrl },
  mcpServers: {
    playwright: {
      command: 'playwright',
      adapter: 'playwright',
      prefix: 'web_',
      strip: 'browser_',
      // No --headless: we want a visible window. Everything else matches the shipped defaults.
      args: [
        'mcp',
        '--isolated',
        '--caps=testing',
        '--snapshot-mode=full',
        '--image-responses=omit',
        '--codegen',
        'none',
        '--viewport-size',
        '1200x800',
        '--output-dir',
        path.join(home, 'pw-out'),
        '--timeout-action',
        '10000',
        '--timeout-navigation',
        '30000',
      ],
    },
  },
});

const gateway = await createGateway({
  config,
  homeDir: home,
  eraCacheFile: null,
  store: await createSqliteStore({ url: dbUrl }),
  logger: createLogger({ level: 'silent', redactor: createRedactor() }),
  // In a real run this comes from `${TEST_PASSWORD}` in the config: loadConfig registers every value it
  // expanded from the environment as a secret. That is the only reason the gateway can strip it below.
  secrets: [PASSWORD],
});
await gateway.start();

const server = gateway.buildServer({ transport: 'inmemory', principal: 'demo' });
const [c, s] = InMemoryTransport.createLinkedPair();
await server.connect(s);
const llm = new Client({ name: 'demo', version: '1.0' }, { versionNegotiation: { mode: 'auto' } });
await llm.connect(c);

const call = async (name, args, label) => {
  const r = await llm.callTool({ name, arguments: args });
  say(`    ${label ?? name}${r.isError ? '  \x1b[31m✗ REFUSED\x1b[0m' : '  \x1b[32m✓\x1b[0m'}`);
  return r;
};

const run = await llm.callTool({ name: 'qa_run_start', arguments: { name: 'live demo' } });
const run_id = run.structuredContent.run_id;

step(2, 'Going to the shop page');
await call('web_navigate', { url: `${site.url}/index.html`, run_id }, 'navigate to the shop');
await wait(2500);

step(3, 'Reading the page the way the AI does (no screenshots — a text outline)');
const snap = await llm.callTool({ name: 'web_snapshot', arguments: { run_id } });
const tree = textOf(snap);
for (const l of tree
  .split('\n')
  .filter((l) => l.includes('[ref='))
  .slice(0, 8))
  say(`    \x1b[2m${l.trim()}\x1b[0m`);
const cartRef = /\[ref=(e\d+)\]/.exec(
  tree.split('\n').find((l) => l.includes('Add to cart') && l.includes('[ref=')),
)[1];
say(`\n    → the AI decides: "Add to cart" is \x1b[1m${cartRef}\x1b[0m`);
await wait(3000);

step(4, 'Clicking "Add to cart" — watch the cart counter go 0 → 1');
await call('web_click', { element: 'Add to cart button', target: cartRef, run_id }, 'click Add to cart');
await wait(1000);
await call('web_verify_text_visible', { text: 'Added to cart', run_id }, 'check "Added to cart" appeared');
await wait(2500);

step(5, 'Now a login form: navigate, fill it, submit');
await call('web_navigate', { url: `${site.url}/form.html`, run_id }, 'go to the Sign in page');
await wait(2000);

const formSnap = await llm.callTool({ name: 'web_snapshot', arguments: { run_id } });
const formTree = textOf(formSnap);
say('    the AI reads the form:');
for (const l of formTree
  .split('\n')
  .filter((l) => l.includes('[ref='))
  .slice(0, 8)) {
  say(`    \x1b[2m${l.trim()}\x1b[0m`);
}
// Match on the ROLE too: `- generic [ref=f1e4]: Email` is the label, `- textbox "Email" [ref=f1e5]` is the
// field the AI actually needs. Picking by text alone grabs the label and types into nothing.
const refFor = (role, name) => {
  const line = formTree
    .split('\n')
    .find((l) => l.trim().startsWith(`- ${role} "${name}"`) && l.includes('[ref='));
  const m = line ? /\[ref=([^\]]+)\]/.exec(line) : null;
  return m ? m[1] : null;
};
const emailRef = refFor('textbox', 'Email');
const passRef = refFor('textbox', 'Password');
const submitRef = refFor('button', 'Sign in');
say(`\n    → email=${emailRef}  password=${passRef}  submit=${submitRef}  (the fields, not the labels)`);

await call(
  'web_type',
  { element: 'Email field', target: emailRef, text: 'student@example.com', run_id },
  'type the email',
);
await wait(1200);
await call(
  'web_type',
  { element: 'Password field', target: passRef, text: PASSWORD, run_id },
  'type the password',
);
await wait(1200);
await call('web_click', { element: 'Sign in button', target: submitRef, run_id }, 'click Sign in');
await wait(1200);
await call(
  'web_verify_text_visible',
  { text: 'Signed in as student@example.com', run_id },
  'check it signed in',
);
await wait(3000);

step(6, 'The AI tries something dangerous — the gateway refuses');
await call(
  'web_run_code_unsafe',
  { code: 'require("fs").rmSync("C:/", {recursive: true})' },
  'run arbitrary code',
);
await call(
  'qa_call_tool',
  { name: 'web_evaluate', arguments: { function: '() => document.cookie' } },
  'steal cookies via the side door',
);
await wait(2000);

step(7, 'The logbook — every action, with the password stripped out');
const fin = await llm.callTool({ name: 'qa_run_finish', arguments: { run_id, status: 'passed' } });
const rows = await gateway.store.actionLog.query({ runId: run_id, limit: 30 });
say('');
say('    tool                        ms   arguments recorded');
say(`    ${'─'.repeat(72)}`);
for (const r of [...rows].reverse()) {
  say(
    `    ${r.tool.padEnd(26)} ${String(r.durationMs).padStart(4)}   ${JSON.stringify(r.argsRedacted ?? {})
      .replace(/"run_id":"[^"]+",?/, '')
      .slice(0, 64)}`,
  );
}
say(
  `\n    run finished: \x1b[32m${fin.structuredContent.status}\x1b[0m — ${fin.structuredContent.actions} actions, ${fin.structuredContent.errors} errors`,
);
say('    \x1b[1mnotice the password is [REDACTED] — the gateway stripped it before saving\x1b[0m');

await wait(4000);
step(8, 'Closing the browser');
await llm.close();
await gateway.close();
await site.close();
say('    done — browser closed, nothing left running\n');
