# @thomasefbland/ts-plugin-std-result-hover

TypeScript language-service plugin that collapses `Result`/`Async_Result` types from `@thomasefbland/std` into their clean generic form instead of the raw expanded union.

## Before / After

**Before** (raw TypeScript hover):

```
function safe_parse<T = unknown>(s: string): {
    readonly is_ok: true;
    readonly value: T;
    readonly error: undefined;
} | {
    readonly is_ok: false;
    readonly value: never;
    readonly error: Safe_Syntax_Error;
} | {
    readonly is_ok: false;
    readonly value: never;
    readonly error: Unknown_Error;
}
```

**After** (with this plugin):

```
function safe_parse<T = unknown>(s: string): Result<T, Safe_Syntax_Error | Unknown_Error>
```

For async functions returning `Promise<Result<...>>`, the display is rewritten to use `Async_Result<...>`.

## What This Rewrites

- **Hover** (shift+K) — function signatures and variable types
- **Completion docs** — the detail popup when selecting a completion item
- **Signature help** — the parameter hint shown inside function call parens
- **Inlay hints** — the inferred return type annotations shown inline

## How It Works

Matching is purely structural — it detects the `{ is_ok, value, error }` shape using the TypeScript type checker. It doesn't specifically import or check for `@thomasefbland/std`'s `Result` type, so it will also fire on any other type with that same shape.

## Limitations

- Only affects display — never touches `tsc`, type-checking, or builds.
- Overloaded functions: picks the first signature matching the Result shape rather than merging all overloads.
- Purely cosmetic display change for QoL.

## License

MIT
