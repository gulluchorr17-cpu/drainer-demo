#!/bin/bash
set -e
source "$HOME/.cargo/env"

echo "=== Installing Solana CLI ==="
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== Solana version ==="
solana --version

echo "=== Installing Anchor via cargo ==="
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.31.1
avm use 0.31.1

echo "=== Anchor version ==="
anchor --version

echo "=== Setting Solana to devnet ==="
solana config set --url devnet

echo "=== Done ==="
