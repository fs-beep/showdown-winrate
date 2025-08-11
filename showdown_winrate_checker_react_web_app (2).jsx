import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Play, Server, UploadCloud, Download, ShieldAlert, Calendar } from "lucide-react";
import { Interface } from "ethers";

/**
 * Showdown Winrate Checker — Date Range + Presets
 * Players choose a start & end DATE (no time). The app resolves those to
 * correct block numbers via binary search, then fetches & decodes
 * GameResultEvent logs from MegaETH and computes win rate.
 *
 * Auto-chunks to 100k blocks and includes retry + throttle to ride out
 * public-RPC rate limits. Now with quick date presets and a focused
 * "Matches for <player>" table above the full decoded list.
 */

// --- Constants you can tweak ---
const DEFAULT_RPC = "https://carrot.megaeth.com/rpc"; // MegaETH testnet RPC
const DEFAULT_CONTRACT = "0xae2afe4d192127e6617cfa638a94384b53facec1";
const MAX_BLOCK_SPAN = 100_000; // provider limit per eth_getLogs

// Event: GameResultEvent(uint256,string,string,string,string,string,string,string,string)
const TOPIC0 = "0xccc938abc01344413efee36b5d484cedd3bf4ce93b496e8021ba021fed9e2725";

const iface = new Interface([
  "event GameResultEvent(uint256 gameNumber, string gameId, string startedAt, string winningPlayer, string winningClasses, string losingPlayer, string losingClasses, string gameLength, string endReason)",
]);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function toHex(n: number) { return "0x" + n.toString(16); }

// Helpers for DATE-ONLY inputs (YYYY-MM-DD, local time)
function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function toStartOfDayEpoch(dateStr?: string): number | undefined {
  if (!dateStr) return undefined;
  const d = new Date(`${dateStr}T00:00`); // local midnight
  if (isNaN(d.getTime())) return undefined;
  return Math.floor(d.getTime()/1000);
}
function toEndOfDayEpoch(dateStr?: string): number | undefined {
  if (!dateStr) return undefined;
  const d = new Date(`${dateStr}T23:59:59`); // local end of day
  if (isNaN(d.getTime())) return undefined;
  return Math.floor(d.getTime()/1000);
}

async function rpcCallWithRetry(url: string, body: any, attempts = 5, baseDelay = 350) {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) throw new Error(`RPC HTTP ${res.status}`);
      }
      const json = await res.json();
      if (Array.isArray(json)) {
        const itemErr = json.find((x) => x && x.error);
        if (itemErr) throw new Error(itemErr.error?.message || "RPC batch error");
      } else if (json && json.error) {
        throw new Error(json.error?.message || "RPC error");
      }
      return json;
    } catch (e:any) {
      lastErr = e;
      const delay = Math.round(baseDelay * Math.pow(1.6, i) + Math.random()*120);
      await sleep(delay);
    }
  }
  throw lastErr || new Error("RPC failed after retries");
}

async function getBlockByTag(url: string, tag: string): Promise<{ num: number; ts: number }>{
  const j = await rpcCallWithRetry(url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [tag, false] });
  const blk = j?.result;
  if (!blk) throw new Error(`Block not found for ${tag}`);
  return { num: parseInt(blk.number, 16), ts: parseInt(blk.timestamp, 16) };
}
async function getBlockByNumber(url: string, n: number) { return getBlockByTag(url, toHex(n)); }
async function getEarliest(url: string) { return getBlockByTag(url, "earliest"); }
async function getLatest(url: string) { return getBlockByTag(url, "latest"); }

// Binary searches by timestamp
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
  let start = fromBlock;
  while (start <= toBlock) {
    const end = Math.min(start + MAX_BLOCK_SPAN - 1, toBlock);
    ranges.push({ from: start, to: end });
    start = end + 1;
  }
  return ranges;
}

async function fetchLogsBatched(params: {
  rpc: string;
  address: string;
  topic0: string;
  fromBlock: number;
  toBlock: number;
  batchSize: number;
  delayMs: number;
  onProgress?: (done: number, total: number) => void;
}) {
  const { rpc, address, topic0, onProgress, batchSize, delayMs } = params;
  const ranges = buildRanges(params.fromBlock, params.toBlock);

  let allLogs: any[] = [];
  for (let i = 0; i < ranges.length; i += batchSize) {
    const chunk = ranges.slice(i, i + batchSize);
    const batch = chunk.map((r, idx) => ({
      jsonrpc: "2.0",
      id: i + idx + 100,
      method: "eth_getLogs",
      params: [ { fromBlock: toHex(r.from), toBlock: toHex(r.to), address, topics: [topic0] } ],
    }));
    const j = await rpcCallWithRetry(rpc, batch);
    for (const resp of j) allLogs = allLogs.concat(resp.result || []);
    onProgress?.(Math.min(i + batchSize, ranges.length), ranges.length);
    if (i + batchSize < ranges.length && delayMs > 0) await sleep(delayMs);
  }

  const uniq = new Map<string, any>();
  for (const log of allLogs) {
    const key = `${log.transactionHash}-${parseInt(log.logIndex, 16)}`;
    uniq.set(key, log);
  }
  return Array.from(uniq.values());
}

function decodeGameResult(log: any) {
  try {
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    const [gameNumber, gameId, startedAt, winningPlayer, winningClasses, losingPlayer, losingClasses, gameLength, endReason] = parsed.args as any[];
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
  } catch (e) {
    console.error("decode error", e);
    return null;
  }
}

export default function App() {
  const [rpc, setRpc] = useState<string>(DEFAULT_RPC);
  const [address, setAddress] = useState<string>(DEFAULT_CONTRACT);

  // DATE inputs (YYYY-MM-DD)
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const [player, setPlayer] = useState<string>("megaflop");
  const [batchSize, setBatchSize] = useState<number>(2);
  const [delayMs, setDelayMs] = useState<number>(400);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{done:number,total:number}>({done:0,total:0});
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);

  const stats = useMemo(() => {
    const p = player.trim().toLowerCase();
    const wins = rows.filter(r => r.winningPlayer?.trim?.().toLowerCase() === p).length;
    const losses = rows.filter(r => r.losingPlayer?.trim?.().toLowerCase() === p).length;
    const total = wins + losses;
    const winrate = total ? (wins / total) : 0;
    return { wins, losses, total, winrate };
  }, [rows, player]);

  const filtered = useMemo(() => {
    const p = player.trim().toLowerCase();
    return rows.filter(r => r.winningPlayer?.trim?.().toLowerCase() === p || r.losingPlayer?.trim?.().toLowerCase() === p)
               .map(r => ({
                 ...r,
                 result: r.winningPlayer?.trim?.().toLowerCase() === p ? 'W' : 'L',
                 opponent: r.winningPlayer?.trim?.().toLowerCase() === p ? r.losingPlayer : r.winningPlayer,
               }));
  }, [rows, player]);

  // Presets
  const applyPreset = (kind: 'today'|'last7'|'last30'|'thisMonth'|'prevMonth'|'allTime') => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (kind === 'today') {
      setStartDate(fmtDate(today));
      setEndDate(fmtDate(today));
    } else if (kind === 'last7') {
      const start = new Date(today); start.setDate(start.getDate()-6); // include today
      setStartDate(fmtDate(start)); setEndDate(fmtDate(today));
    } else if (kind === 'last30') {
      const start = new Date(today); start.setDate(start.getDate()-29);
      setStartDate(fmtDate(start)); setEndDate(fmtDate(today));
    } else if (kind === 'thisMonth') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(fmtDate(start)); setEndDate(fmtDate(today));
    } else if (kind === 'prevMonth') {
      const startPrev = new Date(today.getFullYear(), today.getMonth()-1, 1);
      const endPrev = new Date(today.getFullYear(), today.getMonth(), 0); // last day prev month
      setStartDate(fmtDate(startPrev)); setEndDate(fmtDate(endPrev));
    } else if (kind === 'allTime') {
      setStartDate(""); setEndDate("");
    }
  };

  const handleRun = async () => {
    setError(null);
    setRows([]);
    setLoading(true);
    setProgress({done:0,total:0});

    try {
      // Resolve dates -> block numbers
      const startTs = toStartOfDayEpoch(startDate);
      const endTs = toEndOfDayEpoch(endDate);

      const earliest = await getEarliest(rpc);
      const latest = await getLatest(rpc);

      const fromBlock = startTs ? await findBlockAtOrAfter(rpc, startTs) : earliest.num;
      const toBlock = endTs ? await findBlockAtOrBefore(rpc, endTs) : latest.num;

      if (toBlock < fromBlock) {
        setRows([]);
        setProgress({done:1,total:1});
        setLoading(false);
        return;
      }

      const logs = await fetchLogsBatched({
        rpc,
        address,
        topic0: TOPIC0,
        fromBlock,
        toBlock,
        batchSize: Math.max(1, Math.min(8, Number(batchSize) || 1)),
        delayMs: Math.max(0, Number(delayMs) || 0),
        onProgress: (done, total) => setProgress({done,total}),
      });
      const decoded = logs.map(decodeGameResult).filter(Boolean) as any[];
      decoded.sort((a,b) => a.blockNumber - b.blockNumber);
      setRows(decoded);
    } catch (e:any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const downloadJSON = (filename: string, data: any) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <motion.h1 initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-semibold tracking-tight">Showdown Winrate Checker</motion.h1>
        <p className="mt-2 text-gray-600">Pick a <b>start</b> and <b>end</b> date (local). I’ll resolve them to the right block numbers and fetch on-chain <code>GameResultEvent</code> logs. Huge ranges are auto-chunked.</p>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700"><Server className="h-4 w-4"/> Chain Settings</div>
            <label className="mt-3 block text-xs text-gray-500">RPC URL</label>
            <input className="mt-1 w-full rounded-xl border p-2 text-sm" value={rpc} onChange={e=>setRpc(e.target.value)} />
            <label className="mt-3 block text-xs text-gray-500">Contract Address</label>
            <input className="mt-1 w-full rounded-xl border p-2 text-sm" value={address} onChange={e=>setAddress(e.target.value)} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500">Start date</label>
                <div className="relative">
                  <Calendar className="absolute left-2 top-2.5 h-4 w-4 text-gray-400"/>
                  <input type="date" className="mt-1 w-full rounded-xl border p-2 pl-7 text-sm" value={startDate} onChange={e=>setStartDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500">End date (empty = latest)</label>
                <div className="relative">
                  <Calendar className="absolute left-2 top-2.5 h-4 w-4 text-gray-400"/>
                  <input type="date" className="mt-1 w-full rounded-xl border p-2 pl-7 text-sm" value={endDate} onChange={e=>setEndDate(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="text-gray-500 mr-1">Presets:</span>
              <button className="rounded-full border px-3 py-1" onClick={()=>applyPreset('today')}>Today</button>
              <button className="rounded-full border px-3 py-1" onClick={()=>applyPreset('last7')}>Last 7 days</button>
              <button className="rounded-full border px-3 py-1" onClick={()=>applyPreset('last30')}>Last 30 days</button>
              <button className="rounded-full border px-3 py-1" onClick={()=>applyPreset('thisMonth')}>This month</button>
              <button className="rounded-full border px-3 py-1" onClick={()=>applyPreset('prevMonth')}>Previous month</button>
              <button className="rounded-full border px-3 py-1" onClick={()=>applyPreset('allTime')}>All time</button>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700"><UploadCloud className="h-4 w-4"/> Query</div>
            <label className="mt-3 block text-xs text-gray-500">Player Name</label>
            <input className="mt-1 w-full rounded-xl border p-2 text-sm" value={player} onChange={e=>setPlayer(e.target.value)} placeholder="megaflop" />

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500">Batch size (1–8)</label>
                <input className="mt-1 w-full rounded-xl border p-2 text-sm" type="number" min={1} max={8} value={batchSize} onChange={e=>setBatchSize(parseInt(e.target.value))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500">Delay per batch (ms)</label>
                <input className="mt-1 w-full rounded-xl border p-2 text-sm" type="number" min={0} step={50} value={delayMs} onChange={e=>setDelayMs(parseInt(e.target.value))} />
              </div>
            </div>

            <button onClick={handleRun} disabled={loading} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-black px-4 py-2 text-white shadow disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Play className="h-4 w-4"/>}
              {loading ? `Fetching... ${progress.total ? Math.round((progress.done/progress.total)*100) : 0}%` : "Compute Winrate"}
            </button>
            {error && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 mt-0.5"/>
                <div>
                  <div className="font-medium">Heads up</div>
                  <div>{error}</div>
                  <div className="mt-1 text-xs text-gray-700">If rate-limited, lower <b>Batch size</b> to 1 and raise <b>Delay</b> to 600–1000 ms. Public RPCs throttle shared IPs.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats: moved above player matches */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Wins</div>
            <div className="mt-1 text-3xl font-semibold">{stats.wins}</div>
          </div>
          <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Losses</div>
            <div className="mt-1 text-3xl font-semibold">{stats.losses}</div>
          </div>
          <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Win Rate</div>
            <div className="mt-1 text-3xl font-semibold">{(stats.winrate*100).toFixed(2)}%</div>
          </div>
        </div>

        {/* Player-specific matches first */}
        <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-700">Matches for <span className="font-semibold">{player || '—'}</span> ({filtered.length})</div>
            {filtered.length > 0 && (
              <button onClick={() => downloadJSON("showdown_matches_for_" + (player||'player') + ".json", filtered)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm">
                <Download className="h-4 w-4"/> Download JSON
              </button>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-2">Block</th>
                  <th className="p-2">Game #</th>
                  <th className="p-2">Result</th>
                  <th className="p-2">Opponent</th>
                  <th className="p-2">Started</th>
                  <th className="p-2">Reason</th>
                  <th className="p-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.txHash + i} className="border-b">
                    <td className="p-2 tabular-nums">{r.blockNumber}</td>
                    <td className="p-2 tabular-nums">{r.gameNumber}</td>
                    <td className="p-2 font-medium">{r.result}</td>
                    <td className="p-2">{r.opponent}</td>
                    <td className="p-2">{r.startedAt}</td>
                    <td className="p-2">{r.endReason}</td>
                    <td className="p-2"><a className="text-blue-600 underline" href={`https://web3.okx.com/explorer/megaeth-testnet/tx/${r.txHash}`} target="_blank" rel="noreferrer">tx</a></td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-gray-500" colSpan={7}>No matches for this player (in the chosen range) yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Full decoded list below */}
        <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-700">All Decoded Matches ({rows.length})</div>
            {rows.length > 0 && (
              <button onClick={() => downloadJSON("showdown_winrate_results.json", rows)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm">
                <Download className="h-4 w-4"/> Download JSON
              </button>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-2">Block</th>
                  <th className="p-2">Game #</th>
                  <th className="p-2">Game ID</th>
                  <th className="p-2">Started</th>
                  <th className="p-2">Winner</th>
                  <th className="p-2">Loser</th>
                  <th className="p-2">Reason</th>
                  <th className="p-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.txHash + i} className="border-b">
                    <td className="p-2 tabular-nums">{r.blockNumber}</td>
                    <td className="p-2 tabular-nums">{r.gameNumber}</td>
                    <td className="p-2">{r.gameId}</td>
                    <td className="p-2">{r.startedAt}</td>
                    <td className="p-2 font-medium">{r.winningPlayer}</td>
                    <td className="p-2">{r.losingPlayer}</td>
                    <td className="p-2">{r.endReason}</td>
                    <td className="p-2"><a className="text-blue-600 underline" href={`https://web3.okx.com/explorer/megaeth-testnet/tx/${r.txHash}`} target="_blank" rel="noreferrer">tx</a></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-gray-500" colSpan={8}>
                      {loading ? "Fetching logs..." : "No rows yet. Pick a date range and click Compute."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-500">
          Tip: If you still hit rate limits here, deploy the Next.js version I shared (with a serverless proxy) and you won’t see CORS/limit pain.
        </div>
      </div>
    </div>
  );
}
