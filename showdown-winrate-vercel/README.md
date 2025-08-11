# Showdown Winrate Checker (Next.js + Vercel)

Pick a start/end **date**. The server resolves dates → block numbers by timestamp and fetches `GameResultEvent` logs in 100k chunks, then decodes and returns matches.

## Deploy on Vercel
1. Push this folder to a GitHub repo.
2. Go to https://vercel.com/new → import the repo.
3. (Optional) Env vars:
   - `RPC_URL` = `https://carrot.megaeth.com/rpc`
   - `CONTRACT_ADDRESS` = `0xae2afe4d192127e6617cfa638a94384b53facec1`
4. Deploy and share the public URL.

## Local Dev
```bash
npm i
npm run dev
# open http://localhost:3000
```
