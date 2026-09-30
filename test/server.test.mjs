import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';
import { createApiClient } from '../dist/client.js';

test('SDK client discovers tools, calls a regulation and reads citation guidance', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const document = { text: 'Regulation text.', inlineCitation: '[31 C.F.R. § 10.1](https://ecfr.io/Title-31/Section-10.1)', sourceDate: '2026-09-28' };
  const server = createServer({ titles: async () => ({titles: []}), search: async () => ({results: []}), document: async () => document });
  const client = new Client({ name: 'test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['search_regulations', 'get_regulation', 'list_titles']);
    const result = await client.callTool({ name: 'get_regulation', arguments: {path: '/Title-31/Section-10.1'} });
    assert.equal(result.structuredContent.data.inlineCitation, document.inlineCitation);
    assert.ok((await client.readResource({uri: 'ecfr://citation-guide'})).contents[0].text.includes('ecfr.io'));
    assert.equal((await client.getPrompt({name: 'cite_regulations', arguments: {question: 'Research a rule'}})).messages[0].role, 'user');
    const invalid = await client.callTool({ name: 'search_regulations', arguments: { query: 'test', limit: 500 }});
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await server.close(); }
});

test('API client encodes queries, applies timeout and rejects non-JSON/errors', async () => {
  let observed;
  const api = createApiClient('https://ecfr.io', async (url, options) => {
    observed = {url, options};
    return Response.json({results: []});
  });
  await api.search('safety & health', 7);
  assert.equal(observed.url.searchParams.get('q'), 'safety & health');
  assert.equal(observed.url.searchParams.get('limit'), '7');
  assert.ok(observed.options.signal);
  await assert.rejects(createApiClient('https://ecfr.io', async () => new Response('Unavailable', {status: 503})).titles(), /503/);
  await assert.rejects(createApiClient('https://ecfr.io', async () => new Response('<html>Challenge</html>')).titles(), /JSON/);
  assert.throws(() => createApiClient('http://public.example'), /HTTPS/);
});
