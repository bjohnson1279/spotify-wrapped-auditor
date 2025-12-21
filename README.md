# Spotify Wrapped Auditor

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

### Running the Audit
Compile the TypeScript and run the audit:

```bash
npx tsc && node dist/index.js [options]
```

**Options:**
- `--year=2025`: Filter for a specific year.
- `--all-time`: Run across the entire dataset.
- `--top=100`: Customize how many songs to show in the report.

### Example Commands
```bash
# Official 2025 Audit
node dist/index.js --year=2025

# Career Summary
node dist/index.js --all-time --top=50
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

---
*Disclaimer: This project is intended for personal data auditing and is not affiliated with Spotify.*
