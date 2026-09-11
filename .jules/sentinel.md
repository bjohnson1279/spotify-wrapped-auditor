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
