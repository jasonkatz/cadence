# Agents

## Testing

### No shared mocks

Do not use `mock.module()` or any equivalent that replaces a module globally at the process level. Global module mocks leak across test files and cause non-deterministic failures depending on execution order.

Instead, use dependency injection:

- **DAOs** export a `createXxxDao(query)` factory. Tests call the factory with a mock query function.
- **Services** export a `createXxxService(deps)` factory. Tests call the factory with plain mock objects.
- **Route handlers / engine functions** accept a `deps` parameter. Tests pass mock deps directly.

Every test file must be fully isolated — it should produce the same result whether run alone or alongside any other test file in any order.

### Test structure

- Use `bun:test` (`describe`, `it`, `expect`, `mock`).
- Create a `makeDeps()` helper that returns fresh mocks for each test.
- Reset state in `beforeEach` by creating a new instance from the factory.
- Do not use `await import()` for the module under test — import it statically.
