# Pattern Matching Rules

**3+ branches on the same value → `match` from `ts-pattern`.** No `switch`. No long `if-else`.
Simple boolean / ternary / single null guard → plain `if`.

Prefer `.exhaustive()` when all cases known. `.otherwise()` for genuine catch-all.
Use `P.select()` for extraction, `P.when()` for guards, `.returnType<T>()` when TS can't infer.

❌ `switch (x) { case "a": ... case "b": ... }` — use `match(x).with("a", ...).with("b", ...).exhaustive()`.
❌ `if (x === "a") ... else if (x === "b") ... else if (x === "c") ...` — use `match`.
