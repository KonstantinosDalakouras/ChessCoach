// Node transport for tests: runs the real Stockfish 19 WASM (lite, single-threaded) in-process.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const initEngine = require('stockfish');

export async function nodeTransportFactory(flavor = 'lite-single') {
  const sf = await initEngine(flavor);
  return ({ onLine }) => {
    sf.listener = line => onLine(line);
    return { send: cmd => sf.sendCommand(cmd), terminate: () => { try { sf.terminate(); } catch {} } };
  };
}
