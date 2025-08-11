import Head from 'next/head';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Download, Loader2, Play, Server, ShieldAlert, UploadCloud } from 'lucide-react';

type Row = {
  blockNumber: number;
  txHash: string;
  gameNumber: number;
  gameId: string;
  startedAt: string;
  winningPlayer: string;
  winningClasses: string;
  losingPlayer: string;
  losingClasses: string;
  gameLength: string;
  endReason: string;
};

type ApiResponse = { ok: boolean; error?: string; rows?: Row[]; };

function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function toStartOfDayEpoch(dateStr?: string): number | undefined {
  if (!dateStr) return undefined;
  const d = new Date(`${dateStr}T00:00`);
  if (isNaN(d.getTime())) return undefined;
  return Math.floor(d.getTime()/1000);
}
function toEndOfDayEpoch(dateStr?: string): number | undefined {
  if (!dateStr) return undefined;
  const d = new Date(`${dateStr}T23:59:59`);
  if (isNaN(d.getTime())) return undefined;
  return Math.floor(d.getTime()/1000);
}

export default function Home() {
  const [rpc, setRpc] = useState<string>(process.env.NEXT_PUBLIC_RPC_URL || 'https://carrot.megaeth.com/rpc');
  const [address, setAddress] = useState<string>(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '0xae2afe4d192127e6617cfa638a94384b53facec1');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [player, setPlayer] = useState<string>('megaflop');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const p = player.trim().toLowerCase();
    const wins = rows.filter(r => r.winningPlayer?.trim?.().toLowerCase() === p).length;
    const losses = rows.filter(r => r.losingPlayer?.trim?.().toLowerCase() === p).length;
    const total = wins + losses;
    const winrate = total ? wins / total : 0;
    return { wins, losses, total, winrate };
  }, [rows, player]);

  const filtered = useMemo(() => {
    const p = player.trim().toLowerCase();
    return rows
      .filter(r => r.winningPlayer?.trim?.().toLowerCase() === p || r.losingPlayer?.trim?.().toLowerCase() === p)
      .map(r => ({
        ...r,
        result: r.winningPlayer?.trim?.().toLowerCase() === p ? 'W' : 'L',
        opponent: r.winningPlayer?.trim?.().toLowerCase() === p ? r.losingPlayer : r.winningPlayer,
      }));
  }, [rows, player]);

  const applyPreset = (kind: 'today'|'last7'|'last30'|'thisMonth'|'prevMonth'|'allTime') => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (kind === 'today') {
      setStartDate(fmtDate(today)); setEndDate(fmtDate(today));
    } else if (kind === 'last7') {
      const start = new Date(today); start.setDate(start.getDate()-6);
      setStartDate(fmtDate(start)); setEndDate(fmtDate(today));
    } else if (kind === 'last30') {
      const start = new Date(today); start.setDate(start.getDate()-29);
      setStartDate(fmtDate(start)); setEndDate(fmtDate(today));
    } else if (kind === 'thisMonth') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(fmtDate(start)); setEndDate(fmtDate(today));
    } else if (kind === 'prevMonth') {
      const startPrev = new Date(today.getFullYear(), today.getMonth()-1, 1);
      const endPrev = new Date(today.getFullYear(), today.getMonth(), 0);
      setStartDate(fmtDate(startPrev)); setEndDate(fmtDate(endPrev));
    } else if (kind === 'allTime') {
      setStartDate(''); setEndDate('');
    }
  };

  const run = async () => {
    setLoading(true); setError(null); setRows([]);
    try {
      const body = {
        rpc, address,
        startTs: toStartOfDayEpoch(startDate),
        endTs:   toEndOfDayEpoch(endDate)
      };
      const res = await fetch('/api/eth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j: ApiResponse = await res.json();
      if (!j.ok) throw new Error(j.error || 'Unknown error');
      setRows(j.rows || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const dl = (name: string, data: any) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Head><title>Showdown Winrate Checker</title></Head>
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
            <button onClick={run} disabled={loading} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-black px-4 py-2 text-white shadow disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Play className="h-4 w-4"/>}
              {loading ? "Fetching..." : "Compute Winrate"}
            </button>
            {error && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 mt-0.5"/>
                <div>
                  <div className="font-medium">Heads up</div>
                  <div>{error}</div>
                  <div className="mt-1 text-xs text-gray-700">If rate-limited, try smaller date ranges or wait a bit.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
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

        {/* Player-specific matches */}
        <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-700">Matches for <span className="font-semibold">{player || '—'}</span> ({filtered.length})</div>
            {filtered.length > 0 && (
              <button onClick={() => dl("showdown_matches_for_" + (player||'player') + ".json", filtered)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm">
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

        {/* Full decoded list */}
        <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-700">All Decoded Matches ({rows.length})</div>
            {rows.length > 0 && (
              <button onClick={() => dl("showdown_winrate_results.json", rows)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm">
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
          Tip: If you still hit rate limits here, deploy on Vercel (serverless runs the chunked calls with retries). 
        </div>
      </div>
    </div>
  );
}
