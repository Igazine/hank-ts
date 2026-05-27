# HAL for TypeScript

A TypeScript implementation of the Hybrid Automation Language (HAL).

This repository provides a reusable, environment-agnostic library (`@igazine/hal`) for embedding the HAL interpreter into Node.js, Deno, Bun, or Browser applications.

## Installation

```bash
npm install https://github.com/Igazine/hal-ts.git
```

## Features

- **Environment Agnostic**: The core library has zero dependencies on Node.js APIs.
- **AST Caching**: Eliminates parsing overhead for repeated execution.
- **Universal Parity**: Bit-perfect execution parity with Go, Rust, and Haxe implementations.
- **Standard Library**: Full support for the official HAL Standard Library.

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

- **HAL Core Repo**: [Igazine/hal](https://github.com/Igazine/hal)
- **Official Documentation**: [https://igazine.github.io/hal/](https://igazine.github.io/hal/)

## License

This project is licensed under the MIT License.
