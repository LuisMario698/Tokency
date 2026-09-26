/** `kill(pid, 0)` no envía nada: solo comprueba que el proceso existe. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: existe, pero es de otro usuario.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
