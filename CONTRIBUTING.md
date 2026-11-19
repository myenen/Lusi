# Contributing

Use Node.js 24 LTS and stable Rust. On machines with nvm, run `nvm install` and `nvm use` from the project directory. Add the Rust tools with `rustup component add rustfmt clippy`. See the [README](README.md) for platform setup.

Run the checks before submitting changes.

```sh
npm ci
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Commit the corresponding lockfile when dependencies change. Use synthetic messages and isolated fixtures in tests. Keep account credentials and personal mail out of the repository. See [AGENTS.md](AGENTS.md) for the product roadmap and project conventions.
