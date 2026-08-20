import { Server, InMemoryTransport, LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
console.log('LATEST_PROTOCOL_VERSION', LATEST_PROTOCOL_VERSION);
for (const mode of [{ pin: '2026-07-28' }, 'auto', 'legacy'] as const) {
  const server = new Server({ name: 'spike', version: '0.0.0' }, { supportedProtocolVersions: ['2026-07-28', ...SUPPORTED_PROTOCOL_VERSIONS], capabilities: { tools: {} }, cacheHints: { 'tools/list': { ttlMs: 60000, cacheScope: 'public' } } });
  server.setRequestHandler('tools/list', async () => ({ tools: [{ name: 'qa_echo', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }));
  server.setRequestHandler('tools/call', async (req, ctx) => ({ content: [{ type: 'text', text: 'ok meta=' + JSON.stringify(ctx.mcpReq._meta ?? null) }] }));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: mode as any } });
  try {
    await client.connect(ct);
    const lt = await client.listTools();
    const r = await client.callTool({ name: 'qa_echo', arguments: {}, _meta: { traceparent: '00-1-2-01' } as any });
    console.log(JSON.stringify(mode), '-> era', client.getProtocolEra(), client.getNegotiatedProtocolVersion(), '| list ttlMs', (lt as any).ttlMs, (lt as any).cacheScope, 'resultType', (lt as any).resultType, '| call', JSON.stringify(r.content));
  } catch (e) { console.log(JSON.stringify(mode), 'FAILED', (e as Error).message); }
  await client.close(); await server.close();
}
