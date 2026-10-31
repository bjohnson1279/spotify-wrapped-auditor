# Spotify Wrapped Auditor

A high-precision auditing tool designed to replicate and verify Spotify Wrapped statistics directly from your raw Spotify Extended Streaming History export data.

## Features

- **Gold Standard 2025 Logic**: Replicates Spotify's play-counting filters, including multi-track glitch detection, boundary logout handling, and contextual consecutive-play redundancy.
- **Multi-Year Support**: Generate Wrapped-style reports for 2025 or any custom calendar year.
- **All-Time Listening Statistics**: Aggregate lifetime listening history across your entire export archive.
- **Sophisticated Tiered Filtering**:
  - 30-second minimum play threshold.
  - Multi-track lookahead for glitch and split-play detection.
  - Multi-file overlap and clone deduplication across separate export chunks.
  - Contextual IP-aware logic differentiation (IPv4 home network vs. IPv6/mobile).
- **Hardened Ingestion**: Enforces strict payload validation, per-file and cumulative size boundaries, prototype pollution guards, and terminal injection protection.

## Getting Started

### Prerequisites

- **Node.js**: Version 18.0.0 or higher (supports native test runner and ES modules).
- **npm**: Version 8.0.0 or higher.
- **Spotify Extended Streaming History**:
  1. Request your **Extended streaming history** from the [Spotify Privacy Settings](https://www.spotify.com/account/privacy/) page (this may take a few days for Spotify to package).
  2. The export includes JSON files typically named `streaming_history_audio_YYYY_*.json`.

### Installation

1. Clone this repository and navigate to the root directory:
   ```bash
   git clone <repo-url>
   cd spotify-wrapped-auditor
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Preparing Your Data

Create a `data/` directory in the repository root and place your extracted Spotify streaming history JSON files inside:

```bash
mkdir -p data
cp /path/to/extracted/SpotifyData/streaming_history_audio_*.json data/
```

> **Note**: The data loader expects JSON files placed directly inside `data/`. Non-JSON files, non-array payloads, and files exceeding safety thresholds (50MB per file or 250MB cumulative) are safely skipped with a warning.

### Environment Configuration

Configure your home IPv4 address to enable home-network-specific filtering heuristics (such as boundary logout filtering and consecutive redundant play suppression):

```bash
export HOME_IP="192.168.1.100"
```

If `HOME_IP` is unset, the tool will log a warning and proceed with IPv6 / non-home filtering rules.

## Usage

### Build

Compile TypeScript source files into `dist/`:

```bash
npm run build
```

### Running Audits

You can use predefined `npm` scripts or invoke the compiled CLI directly:

```bash
# Run default 2025 Wrapped audit (filters data through 2025-11-30T23:59:59Z)
npm run audit:2025

# Run audit across all historical data
npm run audit:all-time

# Run default entry point (defaults to year 2025)
npm start
```

### CLI Command & Options

Run custom audit configurations via `node dist/index.js`:

```bash
node dist/index.js [options]
```

| Option | Type | Default | Valid Range | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--year=<YYYY>` | integer | `2025` | `1970` – `2100` | Target year to audit. Loads files matching `<YYYY>` and applies date boundaries. |
| `--all-time` | flag | `false` | N/A | Ingests all JSON files in `data/` and aggregates lifetime stats from 1970 to present. |
| `--top=<N>` | integer | `200` | `1` – `10000` | Number of top tracks to display in the formatted report output. |

#### Examples

```bash
# Custom year audit showing top 50 songs
node dist/index.js --year=2024 --top=50

# All-time audit showing top 100 songs
node dist/index.js --all-time --top=100
```

### Running Tests

Execute the full automated test suite using Node's native test runner (`node:test`):

```bash
npm test
```

### Performance Benchmarking

A standalone benchmarking script is provided to test pipeline execution speed across large synthetic or sampled datasets:

```bash
node benchmark_full.cjs
```

## How It Works

Spotify Wrapped does not count every recorded play. This tool implements the multi-tier audit pipeline:

1. **Ingestion & Safety Guards (`src/dataLoader.ts`)**:
   - Atomic file descriptor access (`fs.openSync` with `O_NONBLOCK`) to prevent TOCTOU race conditions and FIFO hangs.
   - Per-file size limit (50MB) and cumulative processing limit (250MB) to prevent Out-Of-Memory (OOM) crashes.
   - Payload structure validation (`Array.isArray`), prototype pollution rejection (`__proto__`, `constructor`, `prototype`), and string length boundaries.
2. **Global Deduplication (`src/dataLoader.ts`)**:
   - **Tier 1 (Exact Metadata Clone)**: Removes exact duplicate plays logged across overlapping export files.
   - **Tier 2 (Glitched Double Log)**: Reconciles events recorded with identical play time but conflicting `reason_end` values within 1 second.
   - **Tier 3 (Overlapping Plays)**: Deduplicates overlapping `trackdone` plays occurring during playback transition glitches.
3. **Filtering Engine (`src/filters.ts`)**:
   - **Minimum Play Duration**: Standard threshold of 30,000 ms (30 seconds) per track.
   - **Rule 1 (Universal Glitch / Split Play)**: Lookahead filter checking up to 5 subsequent tracks for interrupted playback resumed within network-dependent glitch windows (150s for IPv4, 120s for IPv6).
   - **Rule 2 (Boundary Logout)**: Filters out cutoff logout plays occurring on the final day of the Wrapped tracking window on home networks.
   - **Rule 3 (Redundant Short Plays & Late-Year Logouts)**: Contextual suppression of consecutive sub-60s plays and end-of-year skipped sessions.
4. **Aggregation & Reporting (`src/reporter.ts`)**:
   - High-throughput grouping using null-prototype dictionaries to prevent prototype pollution and minimize GC pressure.
   - Generates ranked song breakdowns (play count, listening time in minutes) and top 20 artist leaderboards (by listening time and play count).

## Project Structure

```
.
├── interface/             # TypeScript type definitions and event interfaces
│   ├── BaseStreamEvent.ts
│   ├── MusicEvent.ts
│   ├── PodcastEvent.ts
│   ├── SpotifyAudioEvent.ts   # Core streaming event schema
│   ├── SpotifyStreamEvent.ts
│   ├── StatsBucket.ts
│   └── WrappedStats.ts
├── src/
│   ├── dataLoader.ts      # File reading, validation, sorting, and deduplication
│   ├── filters.ts         # Wrapped 2025 and standard playback filtering rules
│   └── reporter.ts        # Report aggregation, sorting, and terminal output
├── tests/                 # Unit and integration test suites (node:test)
│   ├── dataLoader.test.ts
│   ├── filters.test.ts
│   ├── integration.test.ts
│   └── reporter.test.ts
├── index.ts               # CLI orchestrator and entry point
├── benchmark_full.cjs     # Standalone performance benchmark script
├── package.json
├── tsconfig.json
└── README.md
```

## Contributing & Development

- All production code is written in TypeScript and compiled with `npm run build`.
- Functional logic changes must include corresponding tests under `tests/`.
- Ensure `npm test` passes before submitting pull requests.

---
*Disclaimer: This project is an independent auditing tool intended for personal data verification and is not affiliated with, authorized, or endorsed by Spotify AB.*
