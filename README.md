# @thomasefbland/ts-plugin-std-result-hover

TypeScript language-service plugin that collapses `Result`/`Async_Result` hover types from `@thomasefbland/std` into their clean generic form instead of the raw expanded union.

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

For async functions returning `Promise<Result<...>>`, the hover is rewritten to use `Async_Result<...>`.

## Requirements

- TypeScript >= 4.7
- Node 22+ / pnpm 11+
- A project using `@thomasefbland/std`'s `Result` type

## Install

```bash
pnpm add -g gh:ts-plugin-std-result-hover
```

Then add the vtsls global plugin config to your Neovim config:

```lua
vim.lsp.config('vtsls', {
  settings = {
    vtsls = {
      tsserver = {
        globalPlugins = {
          {
            name = "@thomasefbland/ts-plugin-std-result-hover",
            location = vim.fn.trim(vim.fn.system("pnpm root -g")),
            enableForWorkspaceTypeScriptVersions = true,
          },
        },
      },
    },
  },
})
```

Restart tsserver after installing: `:LspRestart`.

## How It Works

Matching is purely structural — it detects the `{ is_ok, value, error }` shape. It doesn't specifically import or check for `@thomasefbland/std`'s `Result` type, so it will also fire on any other type with that same shape. Since this is intentionally scoped to personal use with `@thomasefbland/std`, that's acceptable, but worth knowing.

## Limitations

- Only affects hover (`getQuickInfoAtPosition`) — not signature help or completion docs.
- Overloaded functions: picks the first signature matching the Result shape rather than merging all overloads.
- Purely cosmetic — never affects `tsc`, type-checking, or build output.

## Verification

Open a project using `@thomasefbland/std`, hover over a function that returns `Result<T, E1 | E2>` shaped like `safe_parse`, and confirm the hover text shows the collapsed form (e.g. `Result<T, E1 | E2>`) rather than the raw union.

## License

MIT
