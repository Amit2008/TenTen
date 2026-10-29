/** Fresh deal seed from the browser CSPRNG. Seeding only: deals themselves use xorshift32_v1, never Math.random. */
export function cryptoSeed(fill: (array: Uint32Array<ArrayBuffer>) => unknown = (a) => crypto.getRandomValues(a)): number {
  const array = new Uint32Array(1);
  fill(array);
  return array[0]!;
}
