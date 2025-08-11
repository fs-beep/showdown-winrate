# Showdown Winrate Checker (Next.js + Vercel, Node 18)

- UI matches the latest version (framer-motion + lucide-react).
- Serverless API resolves dates → block numbers and fetches `GameResultEvent` logs in 100k-block chunks.
- Node 18 enforced via `package.json` `engines`, `.nvmrc`, and `vercel.json` (functions runtime).

## Local Dev
```bash
npm i
npm run dev
# open http://localhost:3000
```

## Deploy on Vercel
1) Push these **files** (not the .zip) to a GitHub repo **at repo root**.   Repo root should contain: `package.json`, `pages/`, `styles/`, `vercel.json`, etc.
2) Vercel → New Project → Import GitHub repo.   Framework: **Next.js** (autodetected).
3) (Optional) Environment Variables:   - `RPC_URL = https://carrot.megaeth.com/rpc`   - `CONTRACT_ADDRESS = 0xae2afe4d192127e6617cfa638a94384b53facec1`
4) Deploy. If you previously placed the app in a subfolder, set **Project → Settings → General → Root Directory** to that folder or move files to repo root.

If you still see build errors, check the Build Logs for the first red error and share it.
