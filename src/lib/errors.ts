/** Raised when an input file or configuration is malformed or invalid. */
export class ConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigurationError';
  }
}

/** Raised when an otherwise valid operation cannot read or update the filesystem. */
export class OperationalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OperationalError';
  }
}
