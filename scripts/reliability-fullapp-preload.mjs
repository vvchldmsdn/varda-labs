/** Test-process transport only. Never imported by the deployed application. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const configFile = process.env.CAIRN_FULLAPP_TRANSPORT_FILE;
if (configFile) {
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  const bridge = new URL(config.bridge);
  assert.equal(bridge.protocol, 'http:');
  assert.equal(bridge.hostname, '127.0.0.1');
  assert.equal(bridge.pathname, '/sql');
  const approved = new Set(config.connectionStrings);
  assert.equal(approved.size, 2);
  for (const value of approved) assert.equal(new URL(value).hostname, 'ep-cairn-fullapp.synthetic.neon.tech');
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const connection = headers.get('Neon-Connection-String');
    if (connection) {
      assert.ok(approved.has(connection), 'Unreviewed database connection blocked');
      headers.set('X-Cairn-Test-Bridge', config.token);
      return original(bridge, { ...init, headers });
    }
    return original(input, init);
  };
}
