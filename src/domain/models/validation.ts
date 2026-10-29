// Minimal runtime validation for untrusted JSON. Static types do not validate fetched data (GDD 8.1).

export class ContentError extends Error {
  override name = 'ContentError';
  constructor(
    readonly file: string,
    readonly path: string,
    detail: string,
  ) {
    super(path ? `${file}: ${path} ${detail}` : `${file} ${detail}`);
  }
}

export type Json = Record<string, unknown>;

export class Validator {
  constructor(readonly file: string) {}

  fail(path: string, detail: string): never {
    throw new ContentError(this.file, path, detail);
  }

  /** A plain object with exactly the required keys plus any listed optional ones; unknown keys are rejected. */
  object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Json {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) this.fail(path, 'must be an object');
    const record = value as Json;
    for (const key of required) if (!(key in record)) this.fail(join(path, key), 'is required');
    for (const key of Object.keys(record))
      if (!required.includes(key) && !optional.includes(key)) this.fail(join(path, key), 'is not a supported key');
    return record;
  }

  /** A plain object used as a map with arbitrary keys. */
  record(value: unknown, path: string): Json {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) this.fail(path, 'must be an object');
    return value as Json;
  }

  array(value: unknown, path: string, minLength = 0): readonly unknown[] {
    if (!Array.isArray(value)) this.fail(path, 'must be an array');
    if (value.length < minLength) this.fail(path, `must have at least ${minLength} item(s)`);
    return value;
  }

  /** Safe integer within [min, max]; rejects fractions, NaN, Infinity and unsafe magnitudes. */
  int(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) this.fail(path, 'must be a safe integer');
    if (value < min || value > max) this.fail(path, `must be between ${min} and ${max}`);
    return value;
  }

  number(value: unknown, path: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(path, 'must be a finite number');
    if (value < min || value > max) this.fail(path, `must be between ${min} and ${max}`);
    return value;
  }

  string(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.length === 0) this.fail(path, 'must be a non-empty string');
    return value;
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') this.fail(path, 'must be true or false');
    return value;
  }

  /** Supported enum value. Unsupported features fail rather than pretend to work. */
  literal<const T extends string | number | boolean>(value: unknown, path: string, allowed: readonly T[]): T {
    if (!allowed.includes(value as T)) this.fail(path, `must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`);
    return value as T;
  }

  /** Relative same-origin path: no scheme, no leading slash, no `..` segments. */
  relativePath(value: unknown, path: string): string {
    const text = this.string(value, path);
    if (/^[a-z][a-z0-9+.-]*:|^\/|\\|(^|\/)\.\.(\/|$)/i.test(text)) this.fail(path, 'must be a relative path inside the content release');
    return text;
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** Recursively freeze a parsed config so a run cannot mutate its rules. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
