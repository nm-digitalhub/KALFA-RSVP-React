export type IntegrationErrorClassification = 'permanent' | 'transient';

export class IntegrationRuntimeError extends Error {
  constructor(
    public readonly classification: IntegrationErrorClassification,
    public readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'IntegrationRuntimeError';
  }
}

/** Structural reader so a bundled copy of the class still preserves the contract. */
export function readIntegrationRuntimeError(error: unknown):
  | {
      classification: IntegrationErrorClassification;
      code: string;
      message: string;
    }
  | undefined {
  if (!(error instanceof Error)) return undefined;

  const { classification, code } = error as {
    classification?: unknown;
    code?: unknown;
  };
  if (classification !== 'permanent' && classification !== 'transient') return undefined;
  if (typeof code !== 'string' || code.length === 0) return undefined;

  return { classification, code, message: error.message };
}
