import { Server, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createRequire } from 'node:module';
import path from 'node:path';

// --- SPIKE 1: low-level Server + InMemoryTransport + Client round trip ---
const server = new Server({ name: 'spike', version: '0.0.0' }, {
  capabilities: { tools: {} },
  cacheHints: { 'tools/list': { ttlMs: 60000, cacheScope: 'public' } },
});
server.setRequestHandler('tools/list', async (_req, ctx) => {
  console.log('[tools/list] ctx keys', Object.keys(ctx), 'mcpReq keys', Object.keys(ctx.mcpReq));
  return { tools: [{ name: 'qa_echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] };
});
server.setRequestHandler('tools/call', async (req, ctx) => {
  console.log('[tools/call]', req.params.name, JSON.stringify(req.params.arguments), '_meta', JSON.stringify(req.params._meta ?? null), 'signal?', !!ctx.mcpReq.signal);
  if (req.params.name !== 'qa_echo') return { content: [{ type: 'text', text: 'unknown tool' }], isError: true };
  return { content: [{ type: 'text', text: `echo:${(req.params.arguments as any).text}` }], structuredContent: { ok: true } };
});
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: 'spike-client', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
await client.connect(ct);
console.log('era (in-memory):', client.getProtocolEra(), 'version', client.getNegotiatedProtocolVersion());
const lt = await client.listTools();
console.log('listTools ->', JSON.stringify(lt));
const r = await client.callTool({ name: 'qa_echo', arguments: { text: 'hi' }, _meta: { traceparent: '00-abc-def-01' } as any });
console.log('callTool ->', JSON.stringify(r));
await client.close(); await server.close();

// --- SPIKE 2: spawn playwright mcp over stdio, auto era negotiation ---
const require = createRequire(import.meta.url);
const pwDir = path.dirname(require.resolve('playwright/package.json', { paths: [path.resolve('../adapter-playwright')] }));
const cli = path.join(pwDir, 'cli.js');
console.log('playwright cli:', cli);
const t = new StdioClientTransport({
  command: process.execPath,
  args: [cli, 'mcp', '--headless', '--isolated', '--caps=testing', '--snapshot-mode=full', '--image-responses=omit', '--codegen', 'none'],
  stderr: 'pipe',
});
t.stderr?.on('data', (d: Buffer) => process.stderr.write('[pw stderr] ' + d.toString()));
const pw = new Client({ name: 'spike-client', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
const t0 = Date.now();
await pw.connect(t);
console.log('pw pid', t.pid, 'era', pw.getProtocolEra(), 'version', pw.getNegotiatedProtocolVersion(), 'serverInfo', JSON.stringify(pw.getServerVersion()), 'in', Date.now() - t0, 'ms');
const tools = await pw.listTools();
console.log('pw tool count', tools.tools.length);
console.log('pw tools:', tools.tools.map((x) => x.name).join(', '));
console.log('ttlMs/cacheScope on list:', (tools as any).ttlMs, (tools as any).cacheScope);
await pw.close();
console.log('closed; pid alive?', (() => { try { process.kill(t.pid!, 0); return true; } catch { return false; } })());
setTimeout(() => { console.log('after 1s pid alive?', (() => { try { process.kill(t.pid!, 0); return true; } catch { return false; } })()); }, 1000);
