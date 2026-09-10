## 2025-02-14 - Prototype Pollution via Untrusted Object Keys
**Vulnerability:** The application used standard JavaScript objects (`{}`) to aggregate statistics using untrusted string keys from Spotify data (track names and artist names). If a track or artist was maliciously named `__proto__` or `constructor`, it could overwrite built-in object properties or prototype methods.
**Learning:** Even internal data processing tools are susceptible to prototype pollution if external data is used directly as object keys without sanitization or safe object creation.
**Prevention:** Use `Object.create(null)` or `Map` when creating objects intended to be used purely as key-value stores or dictionaries with untrusted keys.

## 2025-02-14 - Information Disclosure via Unhandled Exceptions
**Vulnerability:** The application was missing top-level error boundaries and `try...catch` blocks around file I/O operations (like reading user-provided raw Spotify exports). If a file was missing, malformed, or invalid JSON, it would crash the Node.js process and leak internal server file paths and execution context via stack traces to standard error.
**Learning:** Utilities that parse files or complex external structures should gracefully handle parsing/I/O errors and validate expected shapes (e.g., checking `Array.isArray()`) rather than assuming data structure.
**Prevention:** Wrap top-level execution calls and file I/O (like `JSON.parse` of raw exports) in `try...catch` blocks to gracefully handle errors, validate structures, and prevent sensitive stack trace leaks.
