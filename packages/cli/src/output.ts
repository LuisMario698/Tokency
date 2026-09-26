// Salida del CLI para el usuario, en español.

export const say = {
  title(text: string): void {
    console.log(`\n${text}`);
  },
  ok(text: string): void {
    console.log(`  ✓ ${text}`);
  },
  warn(text: string): void {
    console.log(`  ! ${text}`);
  },
  fail(text: string): void {
    console.log(`  ✗ ${text}`);
  },
  info(text: string): void {
    console.log(`    ${text}`);
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
