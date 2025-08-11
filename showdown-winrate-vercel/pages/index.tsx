import Head from 'next/head';
import { useMemo, useState } from 'react';

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
    <div className="container">
      <Head><title>Showdown Winrate Checker</title></Head>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 6 }}>Showdown Winrate Checker</h1>
      <p className="small">Pick a date range → server resolves to block numbers → fetch logs in ≤100k-block chunks.</p>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="small">Chain Settings</div>
          <label className="label">RPC URL</label>
          <input className="input" value={rpc} onChange={e=>setRpc(e.target.value)} />
          <label className="label">Contract Address</label>
          <input className="input" value={address} onChange={e=>setAddress(e.target.value)} />
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <label className="label">Start date</label>
              <input className="input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label">End date (empty = latest)</label>
              <input className="input" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="small" style={{ marginTop: 8 }}>Presets:</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(6, auto)', gap: 8, marginTop: 6 }}>
            <button className="button" onClick={()=>applyPreset('today')}>Today</button>
            <button className="button" onClick={()=>applyPreset('last7')}>Last 7d</button>
            <button className="button" onClick={()=>applyPreset('last30')}>Last 30d</button>
            <button className="button" onClick={()=>applyPreset('thisMonth')}>This month</button>
            <button className="button" onClick={()=>applyPreset('prevMonth')}>Prev month</button>
            <button className="button" onClick={()=>applyPreset('allTime')}>All time</button>
          </div>
        </div>

        <div className="card">
          <div className="small">Query</div>
          <label className="label">Player Name</label>
          <input className="input" value={player} onChange={e=>setPlayer(e.target.value)} placeholder="megaflop" />
          <button className="button" onClick={run} disabled={loading} style={{ marginTop: 12 }}>
            {loading ? 'Computing...' : 'Compute Winrate'}
          </button>
          {error && <div style={{ marginTop: 10, color: '#b91c1c' }}>{error}</div>}
        </div>
      </div>

      {/* Stats */}
      <div className="stats" style={{ marginTop: 16 }}>
        <div className="stat"><div className="small">Wins</div><div style={{ fontSize: 28, fontWeight: 600 }}>{stats.wins}</div></div>
        <div className="stat"><div className="small">Losses</div><div style={{ fontSize: 28, fontWeight: 600 }}>{stats.losses}</div></div>
        <div className="stat"><div className="small">Win Rate</div><div style={{ fontSize: 28, fontWeight: 600 }}>{(stats.winrate * 100).toFixed(2)}%</div></div>
      </div>

      {/* Player matches first */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Matches for <b>{player || '—'}</b> ({filtered.length})</span>
          {filtered.length > 0 && <a className="link" href={"data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(filtered,null,2))} download={"showdown_matches_for_"+(player||'player')+".json"}>Download JSON</a>}
        </div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Block</th><th>Game #</th><th>Result</th><th>Opponent</th><th>Started</th><th>Reason</th><th>Tx</th></tr></thead>
            <tbody>
              {filtered.map((r,i)=>(
                <tr key={r.txHash+i}>
                  <td>{r.blockNumber}</td><td>{r.gameNumber}</td><td><b>{r.result}</b></td>
                  <td>{r.opponent}</td><td>{r.startedAt}</td><td>{r.endReason}</td>
                  <td><a className="link" target="_blank" rel="noreferrer" href={`https://web3.okx.com/explorer/megaeth-testnet/tx/${r.txHash}`}>tx</a></td>
                </tr>
              ))}
              {filtered.length===0 && <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>No matches for this player (in the chosen range) yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full decoded list */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>All Decoded Matches ({rows.length})</span>
          {rows.length > 0 && <a className="link" href={"data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(rows,null,2))} download="showdown_winrate_results.json">Download JSON</a>}
        </div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Block</th><th>Game #</th><th>Game ID</th><th>Started</th><th>Winner</th><th>Loser</th><th>Reason</th><th>Tx</th></tr></thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={r.txHash+i}>
                  <td>{r.blockNumber}</td><td>{r.gameNumber}</td><td>{r.gameId}</td><td>{r.startedAt}</td>
                  <td><b>{r.winningPlayer}</b></td><td>{r.losingPlayer}</td><td>{r.endReason}</td>
                  <td><a className="link" target="_blank" rel="noreferrer" href={`https://web3.okx.com/explorer/megaeth-testnet/tx/${r.txHash}`}>tx</a></td>
                </tr>
              ))}
              {rows.length===0 && <tr><td colSpan={8} style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>{loading ? 'Fetching logs…' : 'No rows yet. Pick a date range and click Compute.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="small" style={{ marginTop: 16 }}>
        Tip: if you hit rate limits, reduce your date range or try again later. (Server batches under the hood.)
      </div>
    </div>
  );
}
