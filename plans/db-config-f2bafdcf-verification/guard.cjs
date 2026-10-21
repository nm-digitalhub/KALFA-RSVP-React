const net = require('node:net'); const fs = require('node:fs');
const log = (m) => { try { fs.appendFileSync(process.env.NET_LOG, `${process.pid} ${m}\n`); } catch {} };
const DB = new Set([5432, 6543, 54322]); const orig = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const o = typeof a[0] === 'object' ? a[0] : { port: a[0], host: a[1] };
  const host = String(o.host ?? 'localhost'); const port = Number(o.port);
  if (o.path || (['127.0.0.1', 'localhost', '::1'].includes(host) && !DB.has(port))) return orig.apply(this, a);
  log(`BLOCKED ${host}:${port}`); this.destroy(new Error('network blocked (mutation run)')); return this;
};
globalThis.fetch = async (u) => { log(`BLOCKED fetch ${String(u).slice(0, 80)}`); throw new Error('network blocked (mutation run)'); };
