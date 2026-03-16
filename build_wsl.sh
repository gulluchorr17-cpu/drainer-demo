#!/usr/bin/env bash
set -e
export PATH="/home/ap/.local/share/solana/install/active_release/bin:/home/ap/.cargo/bin:$PATH"

echo "=== Installing AVM ==="
cargo install --git https://github.com/coral-xyz/anchor avm --force

echo "=== Installing Anchor 0.31.1 ==="
avm install 0.31.1
avm use 0.31.1
echo "anchor version: $(anchor --version)"

echo "=== Configuring Solana for devnet ==="
solana config set --url devnet
solana-keygen new --no-bip39-passphrase --force -o /home/ap/.config/solana/id.json 2>/dev/null || true
echo "deploy key: $(solana address)"

echo "=== Building program ==="
cd /mnt/c/Users/Silas/Desktop/drainer/demo
anchor build

echo "=== Build complete ==="
ls -la target/deploy/
