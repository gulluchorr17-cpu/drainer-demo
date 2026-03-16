#!/usr/bin/env bash
set -e
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/home/ap/.local/share/solana/install/active_release/bin:/home/ap/.cargo/bin:/home/ap/.avm/bin:$PATH"
agave-install init 2.3.0
export PATH="/home/ap/.local/share/solana/install/active_release/bin:$PATH"
echo "Solana: $(solana --version)"
echo "Platform: $(cargo-build-sbf --version)"
