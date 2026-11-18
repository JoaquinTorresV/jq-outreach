import https from 'node:https';
import type { Agent } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export function buildAgent(proxyUrl: string): Agent {
  const u = proxyUrl.trim();
  if (/^socks/i.test(u)) return new SocksProxyAgent(u) as unknown as Agent;
  if (/^https?:/i.test(u)) return new HttpsProxyAgent(u) as unknown as Agent;
  throw new Error('proxy_url debe empezar con http://, https:// o socks5://');
}

/** Comprueba que el proxy permite llegar a WhatsApp. Si falla, la cuenta NO debe conectarse (fail closed). */
export function checkProxy(agent: Agent, timeoutMs = 12_000): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const req = https.get('https://web.whatsapp.com/', { agent, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: (res.statusCode ?? 0) > 0 && (res.statusCode ?? 0) < 600, detail: `HTTP ${res.statusCode}` });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, detail: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, detail: e.message }));
  });
}
