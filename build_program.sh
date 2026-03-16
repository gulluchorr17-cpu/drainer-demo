#!/usr/bin/env bash
set -e
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/home/ap/.local/share/solana/install/active_release/bin:/home/ap/.cargo/bin:/home/ap/.avm/bin:$PATH"

avm use 0.31.1
echo "solana: $(solana --version)"
echo "anchor: $(anchor --version)"
echo "platform: $(cargo-build-sbf --version)"

SRC=/mnt/c/Users/Silas/Desktop/drainer/demo
BUILD_DIR=/home/ap/drainer_demo_build

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cp -r "$SRC/programs" "$BUILD_DIR/"
cp "$SRC/Anchor.toml" "$BUILD_DIR/"
cp "$SRC/Cargo.toml" "$BUILD_DIR/"
cp "$SRC/tsconfig.json" "$BUILD_DIR/"

cd "$BUILD_DIR"

if [ -d "$SRC/target/deploy" ]; then
    mkdir -p target/deploy
    cp -f "$SRC/target/deploy/"*-keypair.json target/deploy/ 2>/dev/null || true
fi

echo "=== Gen lockfile ==="
rustup run 1.85.0 cargo generate-lockfile

echo "=== Pin blake3 + cc ==="
rustup run 1.85.0 cargo update blake3 --precise 1.5.5
rustup run 1.85.0 cargo update cc --precise 1.1.31

echo "=== Lockfile v3 ==="
sed -i 's/^version = 4/version = 3/' Cargo.lock

echo "=== Build ==="
cargo-build-sbf --manifest-path programs/drainer_demo/Cargo.toml --sbf-out-dir target/deploy 2>&1

echo "=== Keypair ==="
if [ ! -f target/deploy/drainer_demo-keypair.json ]; then
    solana-keygen new --no-bip39-passphrase -o target/deploy/drainer_demo-keypair.json --force
fi
PROGRAM_ID=$(solana-keygen pubkey target/deploy/drainer_demo-keypair.json)

echo "=== Update ID + Rebuild ==="
sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$PROGRAM_ID\")/" programs/drainer_demo/src/lib.rs
cargo-build-sbf --manifest-path programs/drainer_demo/Cargo.toml --sbf-out-dir target/deploy 2>&1

echo "=== Copy ==="
mkdir -p "$SRC/target/deploy"
cp -f target/deploy/*.so "$SRC/target/deploy/"
cp -f target/deploy/*-keypair.json "$SRC/target/deploy/"
cp -f programs/drainer_demo/src/lib.rs "$SRC/programs/drainer_demo/src/lib.rs"

echo "=== DONE ==="
echo "Program ID: $PROGRAM_ID"
