/**
 * EDUCATIONAL DEMO - DEVNET ONLY
 *
 * This script:
 *   1. Reads the program keypair from target/deploy
 *   2. Creates the config PDA + vault PDA with drain_active = false
 *   3. Patches frontend/app.js with the real program ID
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
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

    console.log(`Program ID: ${programId.toBase58()}`);

    let walletKeypairPath: string;

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const candidates = [
        path.resolve(__dirname, '..', 'attacker-keypair.json'),
        path.join(homeDir, '.config', 'solana', 'id.json'),
    ];

    walletKeypairPath = candidates.find(p => fs.existsSync(p)) || '';
    if (!walletKeypairPath) {
        console.log('No wallet keypair found. Generating a new attacker keypair...');
        const newKeypair = Keypair.generate();
        walletKeypairPath = path.resolve(__dirname, '..', 'attacker-keypair.json');
        fs.writeFileSync(walletKeypairPath, JSON.stringify(Array.from(newKeypair.secretKey)));
        console.log(`Generated attacker keypair: ${newKeypair.publicKey.toBase58()}`);
        console.log(`Saved to: ${walletKeypairPath}`);
        console.log(`\nFund this wallet with devnet SOL before deploying:`);
        console.log(`  solana airdrop 2 ${newKeypair.publicKey.toBase58()} --url devnet`);
    }

    const walletKeypairData = JSON.parse(fs.readFileSync(walletKeypairPath, 'utf8'));
    const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(walletKeypairData));

    console.log(`Authority wallet: ${walletKeypair.publicKey.toBase58()}`);

    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const balance = await connection.getBalance(walletKeypair.publicKey);
    console.log(`Wallet balance: ${(balance / 1e9).toFixed(4)} SOL`);

    if (balance < 0.01 * 1e9) {
        console.error('\nInsufficient balance. Send devnet SOL to this address:');
        console.error(`  ${walletKeypair.publicKey.toBase58()}`);
        process.exit(1);
    }

    const wallet = new Wallet(walletKeypair);
    const provider = new AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
    });
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

    console.log(`Config PDA: ${configPda.toBase58()}`);
    console.log(`Vault PDA:  ${vaultPda.toBase58()}`);

    const configAccount = await connection.getAccountInfo(configPda);
    if (configAccount) {
        console.log('\nConfig PDA already initialized. Skipping initialization.');
    } else {
        console.log('\nInitializing config + vault PDAs (drain_active = false)...');

        const tx = await program.methods
            .initialize()
            .accounts({
                config: configPda,
                vault: vaultPda,
                authority: walletKeypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([walletKeypair])
            .rpc();

        console.log(`Initialize tx: ${tx}`);
        console.log(`Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    }

    const appJsPath = path.resolve(__dirname, '..', 'frontend', 'app.js');
    let appJs = fs.readFileSync(appJsPath, 'utf8');
    appJs = appJs.replace(
        /const PROGRAM_ID = '[^']*'/,
        `const PROGRAM_ID = '${programId.toBase58()}'`
    );
    fs.writeFileSync(appJsPath, appJs);

    console.log('\n--- Setup Complete ---');
    console.log(`Program ID: ${programId.toBase58()}`);
    console.log(`Authority:  ${walletKeypair.publicKey.toBase58()}`);
    console.log(`Config PDA: ${configPda.toBase58()}`);
    console.log(`Vault PDA:  ${vaultPda.toBase58()}`);
    console.log(`Drain:      false`);
    console.log(`\nFrontend patched with program ID.`);
    console.log(`\nNext steps:`);
    console.log(`  1. npm run flip-server`);
    console.log(`  2. npm run serve`);
    console.log(`  3. Open http://localhost:3000 and connect Phantom (devnet)`);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
