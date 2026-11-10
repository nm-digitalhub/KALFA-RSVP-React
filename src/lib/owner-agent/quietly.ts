// For the steps whose failure must not change what already happened (a
// message sent, a session remembered): the error is dropped, the flow goes on.
export async function quietly<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}
