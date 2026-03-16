/**
 * EDUCATIONAL DEMO - DEVNET ONLY
 *
 * Full deploy + initialize pipeline:
 *   1. Deploys the program to devnet
 *   2. Initializes the config PDA
 *   3. Patches the frontend with correct addresses
 *
 * Prerequisites:
 *   - Build complete (target/deploy/drainer_demo.so exists)
 *   - Wallet funded with ~3 SOL devnet
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
    const soPath = path.resolve(__dirname, '..', 'target', 'deploy', 'drainer_demo.so');
    if (!fs.existsSync(soPath)) {
        console.error('Program binary not found. Run the build first.');
        process.exit(1);
    }

    const idlPath = path.resolve(__dirname, '..', 'target', 'idl', 'drainer_demo.json');
    if (!fs.existsSync(idlPath)) {
        console.error('IDL not found at', idlPath);
        process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

    const programKeypairPath = path.resolve(__dirname, '..', 'target', 'deploy', 'drainer_demo-keypair.json');
    const programKeypairData = JSON.parse(fs.readFileSync(programKeypairPath, 'utf8'));
    const programKeypair = Keypair.fromSecretKey(Uint8Array.from(programKeypairData));
    const programId = programKeypair.publicKey;

    let walletKeypairPath = path.resolve(__dirname, '..', 'attacker-keypair.json');
    if (!fs.existsSync(walletKeypairPath)) {
        console.log('No attacker keypair found. Generating one...');
        const kp = Keypair.generate();
        fs.writeFileSync(walletKeypairPath, JSON.stringify(Array.from(kp.secretKey)));
        console.log(`Generated: ${kp.publicKey.toBase58()}`);
    }

    const walletKeypairData = JSON.parse(fs.readFileSync(walletKeypairPath, 'utf8'));
    const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(walletKeypairData));
    const connection = new Connection(DEVNET_RPC, 'confirmed');

    console.log('=== Addresses ===');
    console.log(`Program ID:      ${programId.toBase58()}`);
    console.log(`Deploy wallet:   ${walletKeypair.publicKey.toBase58()}`);

    const balance = await connection.getBalance(walletKeypair.publicKey);
    console.log(`Wallet balance:  ${(balance / 1e9).toFixed(4)} SOL`);

    if (balance < 2 * 1e9) {
        console.log(`\nNeed ~3 SOL on devnet. Send to: ${walletKeypair.publicKey.toBase58()}`);
        console.log('Then re-run this script.');
        process.exit(0);
    }

    const programAccount = await connection.getAccountInfo(programId);
    if (!programAccount) {
        console.log('\n=== Deploying program ===');
        try {
            const cmd = `solana program deploy --program-id "${programKeypairPath}" "${soPath}" --url devnet --keypair "${walletKeypairPath}" --commitment confirmed`;
            console.log(`Running: ${cmd}`);
            execSync(cmd, { stdio: 'inherit', timeout: 120000 });
        } catch (err) {
            console.error('Deploy failed. Make sure `solana` CLI is in PATH.');
            console.error('You can also deploy manually:');
            console.error(`  solana program deploy --program-id target/deploy/drainer_demo-keypair.json target/deploy/drainer_demo.so --url devnet --keypair attacker-keypair.json`);
            process.exit(1);
        }
    } else {
        console.log('\nProgram already deployed.');
    }

    const wallet = new Wallet(walletKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    anchor.setProvider(provider);
    idl.address = programId.toBase58();
    const program = new Program(idl, provider);

    const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        programId
    );

    const configAccount = await connection.getAccountInfo(configPda);
    if (!configAccount) {
        console.log('\n=== Initializing config ===');
        const tx = await program.methods
            .initialize()
            .accounts({
                config: configPda,
                authority: walletKeypair.publicKey,
                attackerWallet: walletKeypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([walletKeypair])
            .rpc();
        console.log(`Init tx: ${tx}`);
    } else {
        console.log('\nConfig already initialized.');
    }

    const appJsPath = path.resolve(__dirname, '..', 'frontend', 'app.js');
    let appJs = fs.readFileSync(appJsPath, 'utf8');
    appJs = appJs.replace(
        /const PROGRAM_ID = '[^']*'/,
        `const PROGRAM_ID = '${programId.toBase58()}'`
    );
    appJs = appJs.replace(
        /const ATTACKER_WALLET = '[^']*'/,
        `const ATTACKER_WALLET = '${walletKeypair.publicKey.toBase58()}'`
    );
    fs.writeFileSync(appJsPath, appJs);

    console.log('\n=== READY ===');
    console.log(`Program:  ${programId.toBase58()}`);
    console.log(`Wallet:   ${walletKeypair.publicKey.toBase58()}`);
    console.log(`Config:   ${configPda.toBase58()}`);
    console.log(`Frontend: patched`);
    console.log(`\nRun:  npx http-server frontend -p 3000 -c-1 --cors`);
    console.log(`Then: http://localhost:3000`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
