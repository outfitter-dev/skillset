/**
 * A deliberate rejection of supplied data. Callers still own its provenance:
 * workspace source, CLI arguments, and generated data have different contracts.
 * Never use this type to classify an arbitrary caught exception.
 */
export class InputValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InputValidationError";
  }
}
