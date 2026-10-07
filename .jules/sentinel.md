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

## 2025-09-20 - Terminal Log Injection Prevention
**Vulnerability:** External data (Spotify track/artist names) was being logged directly to stdout via `console.log` in `src/reporter.ts` without sanitization. If malformed data contained ANSI escape codes or control characters, it could lead to Log/Terminal injection, manipulating terminal output or potentially hiding log entries.
**Learning:** Never trust string inputs derived from external sources like JSON files when outputting directly to the terminal, as they can contain harmful control codes.
**Prevention:** Sanitize untrusted string outputs by stripping ANSI escape sequences and non-printable control characters before passing them to console logging functions.

## 2026-09-21 - Terminal Log Injection via Filenames and Unbounded Numbers
**Vulnerability:** Filenames from the `data/` directory were logged directly using `console.warn` without sanitization. An attacker crafting malicious filenames with ANSI codes could cause Terminal Log Injection. Also, the `ms_played` numeric field parsed from JSON lacked bounds and `isFinite` checks, potentially introducing `NaN` propagation or `Infinity` bugs (Denial of Service) if corrupted data was provided.
**Learning:** Terminal log injection can happen not just through primary inputs, but also through secondary ones like dynamically read filenames. Furthermore, simple `typeof x === 'number'` checks are insufficient for JavaScript JSON parsing because `NaN` and `Infinity` pass this check.
**Prevention:** Sanitize dynamically read filesystem filenames prior to outputting them to logs to strip control codes. Enforce strict numerical boundaries and use `Number.isFinite()` on data parsed from external JSON.

## 2026-09-27 - Unbounded Output and DoS via CLI Arguments
**Vulnerability:** The CLI arguments `--year` and `--top` were validated using `isNaN()`, which fails to correctly catch values like `Infinity`, `-Infinity`, or extremely large numbers. Passing `--top=Infinity` could lead to unbounded outputs or terminal hanging, causing a DoS condition.
**Learning:** `isNaN()` is insufficiently strict for numeric bounds checking when inputs dictate program execution loops, rendering output size, or are passed into internal APIs like `Date()`. `Number.isFinite()` and explicit boundaries are required.
**Prevention:** Always validate numeric CLI arguments using `Number.isFinite()` and enforce sane, explicit min/max boundaries (e.g., `TOP_N <= 10000`) before proceeding.

## 2025-09-22 - Memory Exhaustion via Unbounded String Lengths in JSON Parsing
**Vulnerability:** External string inputs (like `ts`, `master_metadata_track_name`) from user-provided JSON files were type-checked (`typeof x === 'string'`) but not bounded by length. An attacker or corrupted export could supply a JSON file containing gigabytes of string data for a single field, leading to severe CPU overhead (e.g. during `Date.parse(e.ts)`) or memory exhaustion (Denial of Service).
**Learning:** Basic type checking (e.g., `typeof === 'string'`) is insufficient when dealing with external, untrusted payloads that could be maliciously large.
**Prevention:** Always validate and enforce strict maximum length constraints (e.g., `str.length <= 50`) on string fields parsed from external sources before processing them.


## 2025-02-15 - Type Confusion via Incomplete String Validation
**Vulnerability:** External JSON fields (like `master_metadata_track_name`, `reason_end`, `ip_addr`) were validated using truthiness (`!item.field`) before being implicitly assumed to be strings. An attacker could supply an object or array (e.g., `{"master_metadata_track_name": []}`) which passes truthiness checks but causes application crashes or prototype pollution when string methods (like `.replace()` or `.includes()`) are later called on them, or when they are concatenated.
**Learning:** Truthiness checks do not validate types in JavaScript. When interacting with unvalidated third-party data, assuming a field is a string just because it is truthy exposes the application to type confusion vulnerabilities.
**Prevention:** Always use explicit type checking (`field == null || typeof field === 'string'`) when verifying that parsed external JSON fields are strings to prevent type confusion and ensure data fidelity.

## Assertiveness, Decisive PR Execution & Comparative Recommendations
- **Proactive & Decisive PR Submission**: Do NOT repeatedly pause to ask permission to open a pull request (e.g., avoid "Would you like me to open a PR for this?", "Can I submit the PR?", "Should I go ahead and create the PR?"). When an optimization, fix, or feature satisfies requirements, passes local test runners/linters, and preserves architectural invariants, proceed decisively to create and submit the Pull Request with a clear, structured summary and rationale.
- **Explicit Recommendations on Options**: When presenting multiple implementation strategies or architecture options (e.g., Option A vs. Option B), NEVER leave the choice open-ended or passive. Always make an explicit, reasoned recommendation (prefixed with `(Recommended)`) based on **overall technical effectiveness**:
  1. *Algorithmic & Complexity Gains*: Time and space complexity impact (O(N*M) -> O(N+M), reduction of nested scans).
  2. *Resource Overhead*: Heap allocations, memory pressure, and GC pause reduction.
  3. *Domain & Architecture Invariants*: Strict backward compatibility, contract stability, and prevention of regression risks.
  4. *Security & Reliability*: Input validation, cryptographic safety, and concurrency safety.
- **Lead with Recommended Path**: State clearly why the recommended solution delivers the highest net value and immediately execute or propose it as the primary course of action rather than asking open-ended questions.

## Scope Verification, Minimal Churn & CI Protection Directives
- **Scope Verification Before Variable Binding**: When adding interactive states or accessibility attributes (e.g. `disabled={loading}`, `aria-busy={loading}`, `isSubmitting`), NEVER assume a variable identifier exists. Always inspect component props, local state hooks (`useState`), or declaration scope first. If not defined, declare the state hook or reuse an existing scope variable. Never introduce TS2304 / TS2552 ("Cannot find name") compile errors.
- **Surgical Edits Only (No Whole-File Formatting)**: Never run whole-file code formatters (Prettier, Black, Pint, rustfmt) across unmodified lines. Changes must be strictly range-scoped and limited to the minimal AST block needed. Avoid noisy quote/whitespace churn that masks real logic changes and causes merge conflicts. Verify with `git diff -w` that non-functional churn is zero.
- **Zero Scratch File Commits**: Never stage or commit ad-hoc verification, patch, or debug scripts (`test.cjs`, `fix_*.cjs`, `fix_*.php`, `patch_*.py`, `patch_*.sh`, `scratch_*`). Execute checks via the project's native test commands (`npm test`, `pytest`, `phpunit`, etc.) and delete temporary scripts before creating git commits.
- **Never Weaken CI Workflows**: Do not modify `.github/workflows/**` to bypass failures (e.g. adding `|| true`, setting `continue-on-error: true`, or commenting out assertions). Always resolve the defect in the source code or test fixture.
- **Explicit Parameter & Variable Types**: In TypeScript files, avoid implicit `any` by always providing explicit types on functions, parameters, and arrow callbacks (e.g. `(id: string) => ...`). Verify zero type errors with `tsc --noEmit` before committing.

## 2026-09-29 - Non-Destructive Security Patching & CI Protection
**Learning:** Security patches must never weaken CI workflow files (`.github/workflows/**`) by appending `|| true` or `continue-on-error: true` to suppress test/build failures. Furthermore, when adding defensive type assertions or input validators in TypeScript, omitting explicit types can introduce `TS7006: Parameter implicitly has an 'any' type`.
**Action:** Never modify CI workflow definitions to bypass test failures; resolve the underlying issue in source code or test fixtures. Always provide explicit types on newly introduced parameters and helper functions. Ensure zero scratch scripts (`fix_*.php`, `test_*.js`) are committed.

## 2026-10-04 - Memory Exhaustion via Unexpected Nested Structures in JSON Parsing
**Vulnerability:** The data loader strictly checked top-level string properties for extreme lengths (`length > 5000`) to prevent Out-Of-Memory (OOM) crashes, but it failed to validate the structure type itself. An attacker could bypass the string length check by supplying deeply nested objects (e.g., `{"a": {"b": ... }}`) or arrays containing massive strings, leading to memory exhaustion or extreme CPU overhead during garbage collection and JSON serialization later on.
**Learning:** Checking primitive lengths (like strings) is insufficient if the data structure itself allows nested complexity. For simple, flat datasets (like Spotify exports), any non-primitive nested structure (object or array) is inherently unexpected and dangerous.
**Prevention:** Always validate both the type and the content. For flat payloads, explicitly reject unexpected nested objects or arrays (`typeof val === 'object' && val !== null`) during the initial parsing phase to prevent deep parsing OOMs and type confusion vulnerabilities.

## 2026-10-18 - Memory Exhaustion via Unbounded File Size Reads
**Vulnerability:** `fs.readFileSync` was used to read untrusted JSON files from the `data/` directory directly into memory without checking their file size first. An attacker or a corrupted export process could provide a massive file (e.g., several gigabytes), causing the application to crash due to Out-Of-Memory (OOM) errors, leading to a Denial of Service (DoS).
**Learning:** Reading user-supplied files entirely into memory is dangerous if there is no upper bound on the file size.
**Prevention:** Always check `fs.statSync(file).size` against a sensible maximum (e.g., 256MB) before attempting to read the file into memory using `fs.readFileSync`.
