/** Resolves a public file against the deployment base (`/` or e.g. `/TenTen/`), never the origin root. */
export function appUrl(path: string, base: string = new URL(import.meta.env.BASE_URL, location.href).href): string {
  return new URL(path.replace(/^\/+/, ''), base).href;
}
