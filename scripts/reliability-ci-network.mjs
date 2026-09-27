import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const localHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const fontHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export function permitsConnection(options, allowFonts = false) {
  if (options.path) return true; // Local Unix socket or Windows named pipe.
  const host = String(options.host ?? options.hostname ?? 'localhost').toLowerCase();
  return localHosts.has(host) || (allowFonts && fontHosts.has(host));
}

// This guard is a local regression check, not a security sandbox for hostile PR
// code. Hosted PR jobs receive no environment secrets or persisted Git token.
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const input = Array.isArray(args[0]) ? args[0] : args;
  const first = input[0];
  const options = typeof first === 'object' && first !== null ? first
    : typeof first === 'string' && !/^\d+$/.test(first) ? { path: first }
      : { port: first, host: typeof input[1] === 'string' ? input[1] : 'localhost' };
  if (!permitsConnection(options, process.env.CAIRN_CI_ALLOW_FONT_NETWORK === '1')) {
    const error = new Error('Reliability CI blocks non-loopback data connections');
    error.code = 'CAIRN_CI_EXTERNAL_NETWORK_BLOCKED';
    throw error;
  }
  return Reflect.apply(originalConnect, this, args);
};
syncBuiltinESMExports();
