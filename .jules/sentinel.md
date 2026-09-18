## 2025-02-15 - Prototype Pollution in Artist Stats
**Vulnerability:** A malicious Spotify data export containing an artist named `__proto__` can pollute the global object prototype because `artistStats` is initialized as `{}` instead of `Object.create(null)`.
**Learning:** Using untrusted user data (like parsed JSON files from a third-party export) directly as keys in plain objects can lead to prototype pollution, which might break the application or lead to unexpected behavior in other parts of the code.
**Prevention:** Use `Object.create(null)` for dictionaries/maps built from user input, or use the `Map` object instead of a plain object.

## 2025-01-20 - Prototype Pollution in Dictionary Aggregation
**Vulnerability:** The aggregator used `{}` (Object literal) to construct a dictionary using user-controlled data (JSON from Spotify exports). A user could craft a track artist name as `__proto__`, which modifies `Object.prototype`, causing a prototype pollution vulnerability.
**Learning:** Initializing dictionaries with `{}` when using unsanitized user input as keys exposes the application to Prototype Pollution.
**Prevention:** Use `Object.create(null)` for simple dictionary maps when relying on arbitrary string keys (or use `Map` structures), which avoids inheriting the native `Object.prototype`.

## 2025-01-20 - Hardcoded PII / IP Addresses
**Vulnerability:** `src/filters.ts` hardcoded a user's IP address (`76.149.238.152`) directly in the source code as a boolean flag `isIPv4`. This constitutes a PII leak and is hardcoded data.
**Learning:** Hardcoding sensitive configuration constants like Home IPs into source code risks exposing user identities, especially when open-sourcing or sharing the project.
**Prevention:** Externalize sensitive information to environment variables (e.g., `process.env.HOME_IP`).

## 2026-09-11 - Unhandled JSON parsing and Lack of Validation Fixed
**Vulnerability:** The `src/dataLoader.ts` directly parsed JSON read from a file using `JSON.parse` and assumed the returned type was an Array for concatenation. If the parsed string was invalid JSON, it would throw an unhandled exception, leaking stack traces. If it was valid JSON but an Object instead of an Array, the `length` property check and loop could cause unexpected behavior.
**Learning:** Never assume the output of `JSON.parse` is of a specific format. Direct unhandled JSON parsing without validation or error handling can lead to stack trace leakage and application crashes.
**Prevention:** Wrap file reading and JSON parsing in `try...catch` blocks. Validate that the parsed output structure matches what the program expects, e.g., checking `Array.isArray(parsed)`.

## 2025-01-20 - Unhandled JSON parsing and Lack of Validation
**Vulnerability:** The dataLoader.ts directly parsed JSON read from a file using `JSON.parse` and assumed the returned type was an Array for concatenation. If the parsed string is invalid JSON it would throw an unhandled exception, leaking stack traces. If it is valid JSON but an Object instead of an Array, `concat` could cause unpredictable behavior or throw later in the application.
**Learning:** Never assume the output of `JSON.parse` is of a specific format. Direct unhandled JSON parsing without validation or error handling can lead to stack trace leakage and application crash.
**Prevention:** Wrap file reading and JSON parsing in `try...catch` blocks. Validate that the parsed output structure matches what the program expects, e.g., checking `Array.isArray(parsed)`.

## Prevention Directives for Automated Refactoring
- **Never Overwrite Complete Files**: Always use range-scoped replacement chunks for edits to `schema.prisma`, `index.ts`, `public/index.php`, `db/schema.rb`, or DDL SQL scripts.
- **Do Not Remove Core Declarations**: Do not delete existing route registrations or database DDL tables.
- **Environment Isolation Compatibility**: When replacing fallback secrets, preserve test environment execution via `!getenv('APP_ENV')` or `getenv('APP_ENV') === 'testing'`.
- **No Scratch Files**: Never stage or commit `test_*.ts`, `test_*.js`, `test.cjs`, `fix_*.php`, or `test.js` files to git.
- **No Unresolved Conflict Markers**: Never stage or commit files containing Git merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`, `|||||||`). Always resolve conflicts cleanly before committing.

## Completeness & Verification Directives
- **Explicit Parameter & Contract Validation**: When creating or modifying API endpoints (Express, Fastify, Rails, Laravel), always implement explicit parameter and request body validation schemas (e.g. `z.string().uuid()`) to prevent unhandled 404/500 fallthroughs.
- **Database Indexing for Queries**: When addressing query bottlenecks or adding query lookup filters, always implement native database index migrations rather than loading collections into memory and performing array filtering (`.filter()`, `.select`).
- **Co-Occurring Dependency Auditing**: When bumping any dependency version, verify that other transitive dependencies do not carry high/critical security advisories (e.g. run `bundler-audit`, `npm audit`). Never introduce a version bump that breaks underlying framework APIs.
- **Self-Verification Before Commit**: Always run syntax checks (`bash -n` for shell scripts, `tsc --noEmit` for TypeScript, linter checks) and targeted test runners locally before opening or updating a PR.

## Hallucinatory Task & Empty PR Directives
- **Zero-Diff Task Termination**: If the requested optimization, refactor, or fix is ALREADY natively present in the target branch, DO NOT create an empty pull request or commit an acknowledgment PR. Exit the task cleanly without opening a PR.
- **Stale Suggestion Guard**: Always verify the current code on `main`/`master` before planning changes. If no actionable diff is required, cancel task execution immediately.

## 2025-09-13 - Top-Level Unhandled Exception Stack Trace Leak
**Vulnerability:** The top-level `runAudit()` function in `index.ts` was not wrapped in a `try...catch` block. If file I/O operations failed (e.g., the `data/` directory did not exist), Node.js would crash and print a full stack trace to stdout, potentially leaking internal paths and application structure.
**Learning:** Even if inner functions (like JSON parsing) are wrapped in `try...catch`, top-level orchestration code can still throw exceptions (like `fs.readdirSync` failing on a missing directory).
**Prevention:** Always wrap top-level application entry points in `try...catch` blocks to gracefully handle unexpected errors, log them securely without stack traces, and exit with an appropriate status code (e.g., `process.exit(1)`).

## 2026-09-16 - Path Leakage in File System Error Messages
**Vulnerability:** Unhandled filesystem errors (like `ENOENT` from `fs.readdirSync`) bubbled up to the top-level catch block and were logged in their entirety. The `error.message` property of Node.js `fs` errors includes the internal filesystem path (e.g., `scandir '/app/data'`), leading to information disclosure.
**Learning:** Relying solely on top-level `try...catch` blocks for error handling is insufficient if the original system error messages are printed directly to the console or user output. System errors often contain sensitive environmental data.
**Prevention:** Wrap specific, risky I/O operations (like `fs.readdirSync`) in targeted `try...catch` blocks. Log the original system error for internal debugging, but throw a new, sanitized `Error` with a safe, generic message to prevent path leakage to end-users or external logs.

## 2026-09-17 - Unhandled Exception (RangeError) via Out-of-Bounds CLI Arguments
**Vulnerability:** The `--year` CLI argument was parsed to an integer and checked with `isNaN()`, but bounds were not validated (e.g., `-1000` or `1e44` were allowed). When these extreme values were passed into the `Date` constructor later in the script (e.g., `new Date(`${year}-01-01T00:00:00Z`)`), it threw a `RangeError: Invalid time value`. This unhandled exception caused the application to crash ungracefully, creating a minor Denial of Service (DoS) risk from malformed inputs.
**Learning:** Checking for `NaN` is not sufficient for numeric inputs that are later used in constrained contexts like Date boundaries. Extreme numbers (positive or negative) can bypass `isNaN` checks and still crash core Node.js APIs.
**Prevention:** Explicitly validate numeric inputs against sensible boundaries (e.g., `year >= 1970 && year <= 2100`) before proceeding with execution, rather than relying solely on `isNaN`.
