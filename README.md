# Hank for TypeScript

A TypeScript implementation of the Hank language.

This repository provides a reusable, environment-agnostic library (`hank`) for embedding the Hank interpreter into Node.js, Deno, Bun, or Browser applications.

## Installation

```bash
npm install https://github.com/Igazine/hank-ts.git
```

## Features

- **Environment Agnostic**: The core library has zero dependencies on Node.js APIs.
- **AST Caching**: Eliminates parsing overhead for repeated execution.
- **Universal Parity**: Bit-perfect execution parity with Go, Rust, and Haxe implementations.
- **Standard Library**: Full support for the official Hank Standard Library.

## Example Runner

An example Node.js CLI runner is included in `examples/runner`. To run the conformance tests:

1. **Initialize Submodules**: The runner requires the universal conformance suite.
   ```bash
   git submodule update --init --recursive
   ```
2. **Build and Run**:
   ```bash
   npm install
   npm run build
   cd examples/runner
   npm install
   node src/main.js
   ```

## Project Links

- **Hank Core Repo**: [Igazine/hank](https://github.com/Igazine/hank)
- **Official Documentation**: [https://igazine.github.io/hank/](https://igazine.github.io/hank/)

## License

This project is licensed under the MIT License.
