# Spotify Wrapped Auditor

Disclaimer: AI generated text

A high-precision tool to replicate and audit your Spotify Wrapped statistics from raw JSON export data.

## Features

- **Gold Standard 2025 Logic**: Purpose-built to match Spotify's complex play-counting filters, including IP-aware glitch handling, boundary logouts, and consecutive play redundancy.
- **Multi-Year Support**: Generate Wrapped-style reports for any specific year.
- **All-Time Stats**: Aggregate your entire listening history.
- **Sophisticated Filtering**:
  - 30-second minimum play threshold.
  - Multi-track lookahead for glitch/split-play detection.
  - Context-aware deduplication for multi-file overlaps.
  - IP-based logic differentiation (IPv4 vs. IPv6).

## Usage

### Prerequisites
- Node.js installed.
- Your Spotify Extended Streaming History data (placed in a `data/` directory).

### Installation
```bash
npm install
```

### Environment Configuration
Optionally configure your home IPv4 address to enable home-network-specific filtering rules (boundary logouts and consecutive play redundancy):

```bash
export HOME_IP="192.168.1.100"
```

### Running the Audit
Build the project and run via npm scripts or direct CLI invocation:

```bash
# Build TypeScript files
npm run build

# Run default 2025 Wrapped audit
npm run audit:2025

# Run all-time audit
npm run audit:all-time

# Run CLI with custom options
node dist/index.js --year=2025 --top=100
```

**CLI Options:**
- `--year=2025`: Filter for a specific year.
- `--all-time`: Run across the entire dataset.
- `--top=100`: Customize how many songs to show in the report.

### Running Tests
Execute the test suite using Node.js native test runner:

```bash
npm test
```

## How It Works
Spotify Wrapped doesn't count every play. This tool implements the "Tiered Filter System" discovered through iterative testing against official Wrapped data:
1. **Deduplication**: Merges overlapping metadata from multiple export files.
2. **Glitch Filter**: Drops short, fragmented plays that occur during network switches.
3. **Session Filtering**: Intelligent handling of logouts and manual skips.
4. **IP Guard**: Applies stricter scrutiny to home network (IPv4) plays to handle background/loop noise.

## File Structure
- `index.ts`: The main entry point and CLI orchestrator.
- `src/dataLoader.ts`: JSON ingestion and deduplication.
- `src/filters.ts`: The core filtering logic (Wrapped vs. Standard).
- `src/reporter.ts`: Output formatting for songs and artists.
- `interface/`: TypeScript interface and type definitions for streaming events.

---
*Disclaimer: This project is intended for personal data auditing and is not affiliated with Spotify.*
