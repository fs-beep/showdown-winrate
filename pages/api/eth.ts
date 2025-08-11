import type { NextApiRequest, NextApiResponse } from 'next';
import { Interface } from 'ethers';

const MAX_SPAN = 100_000;
const DEFAULT_RPC = process.env.RPC_URL || 'https://carrot.megaeth.com/rpc';
const DEFAULT_CONTRACT = process.env.CONTRACT_ADDRESS || '0xae2afe4d192127e6617cfa638a94384b53facec1';
const TOPIC0 = '0xccc938abc01344413efee36b5d484cedd3bf4ce93b496e8021ba021fed9e2725';

const iface = new Interface([
  'event GameResultEvent(uint256 gameNumber, string gameId, string startedAt, string winningPlayer, string winningClasses, string losingPlayer, string losingClasses, string gameLength, string endReason)',
]);

function toHex(n: number) { return '0x' + n.toString(16); }

async function rpc(url: string, body: any, attempts = 5, baseDelay = 200) {
  let lastErr: any = null;
  for (let i=0;i<attempts;i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) throw new Error(`RPC HTTP ${res.status}`);
      }
      const j = await res.json();
      if (Array.isArray(j)) {
        const itemErr = j.find((x:any) => x && x.error);
        if (itemErr) throw new Error(itemErr.error?.message || 'RPC batch error');
      } else if (j && j.error) {
        throw new Error(j.error?.message || 'RPC error');
      }
      return j;
    } catch (e:any) {
      lastErr = e;
      const delay = Math.round(baseDelay * Math.pow(1.6, i) + Math.random()*120);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error('RPC failed after retries');
}

async function getBlockByTag(url: string, tag: string): Promise<{ num:number; ts:number }> {
  const j = await rpc(url, { jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: [tag, false] });
  const blk = j?.result;
  if (!blk) throw new Error('Block not found');
  return { num: parseInt(blk.number, 16), ts: parseInt(blk.timestamp, 16) };
}
async function getBlockByNumber(url: string, n: number) { return getBlockByTag(url, toHex(n)); }
async function getEarliest(url: string) { return getBlockByTag(url, 'earliest'); }
async function getLatest(url: string) { return getBlockByTag(url, 'latest'); }

async function findBlockAtOrAfter(url: string, targetTs: number): Promise<number> {
  const earliest = await getEarliest(url);
  const latest = await getLatest(url);
  if (targetTs <= earliest.ts) return earliest.num;
  if (targetTs > latest.ts) return latest.num;
  let lo = earliest.num, hi = latest.num;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const b = await getBlockByNumber(url, mid);
    if (b.ts >= targetTs) hi = mid; else lo = mid + 1;
  }
  return lo;
}
async function findBlockAtOrBefore(url: string, targetTs: number): Promise<number> {
  const earliest = await getEarliest(url);
  const latest = await getLatest(url);
  if (targetTs < earliest.ts) return earliest.num;
  if (targetTs >= latest.ts) return latest.num;
  let lo = earliest.num, hi = latest.num;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo + 1) / 2);
    const b = await getBlockByNumber(url, mid);
    if (b.ts <= targetTs) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function buildRanges(fromBlock: number, toBlock: number) {
  const ranges: Array<{ from: number; to: number }> = [];
  let s = fromBlock;
  while (s <= toBlock) {
    const e = Math.min(s + MAX_SPAN - 1, toBlock);
    ranges.push({ from: s, to: e });
    s = e + 1;
  }
  return ranges;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { rpc: rpcIn, address: addrIn, startTs, endTs } = req.body || {};
    const rpcUrl: string = rpcIn || DEFAULT_RPC;
    const address: string = (addrIn || DEFAULT_CONTRACT).toLowerCase();

    const earliest = await getEarliest(rpcUrl);
    const latest = await getLatest(rpcUrl);
    const fromBlock = (typeof startTs === 'number' && startTs > 0) ? await findBlockAtOrAfter(rpcUrl, startTs) : earliest.num;
    const toBlock = (typeof endTs === 'number' && endTs > 0) ? await findBlockAtOrBefore(rpcUrl, endTs) : latest.num;
    if (toBlock < fromBlock) return res.status(200).json({ ok: true, rows: [] });

    const ranges = buildRanges(fromBlock, toBlock);
    const BATCH = 8;
    const allLogs: any[] = [];
    for (let i = 0; i < ranges.length; i += BATCH) {
      const chunk = ranges.slice(i, i + BATCH);
      const batch = chunk.map((r, idx) => ({
        jsonrpc: '2.0',
        id: i + idx + 100,
        method: 'eth_getLogs',
        params: [{ fromBlock: toHex(r.from), toBlock: toHex(r.to), address, topics: [TOPIC0] }],
      }));
      const resp = await rpc(rpcUrl, batch);
      for (const item of resp) {
        if (Array.isArray(item.result)) allLogs.push(...item.result);
      }
    }

    const uniq = new Map<string, any>();
    for (const log of allLogs) {
      const key = `${log.transactionHash}-${parseInt(log.logIndex, 16)}`;
      uniq.set(key, log);
    }
    const logs = Array.from(uniq.values());

const rows = logs
  .map((log: any) => {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) return null; // <-- fixes “parsed is possibly null” under strict TS

      const [
        gameNumber,
        gameId,
        startedAt,
        winningPlayer,
        winningClasses,
        losingPlayer,
        losingClasses,
        gameLength,
        endReason,
      ] = (parsed as any).args as any[];

      return {
        blockNumber: parseInt(log.blockNumber, 16),
        txHash: log.transactionHash,
        gameNumber: Number(gameNumber?.toString?.() ?? gameNumber),
        gameId: String(gameId),
        startedAt: String(startedAt),
        winningPlayer: String(winningPlayer),
        winningClasses: String(winningClasses),
        losingPlayer: String(losingPlayer),
        losingClasses: String(losingClasses),
        gameLength: String(gameLength),
        endReason: String(endReason),
      };
    } catch {
      return null;
    }
  })
  .filter(Boolean) as any[];


    res.status(200).json({ ok: true, rows });
  } catch (e:any) {
    res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
