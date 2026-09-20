import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

import schema from './server-events.schema.json';
import type { ServerEvent } from './generated';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateServerEvent = ajv.compile(schema);

export class ProtocolError extends Error {
  readonly paths: string[];

  constructor(message: string, errors: ErrorObject[] = []) {
    const paths = errors.map((error) => error.instancePath || error.schemaPath);
    super(paths.length ? `${message}: ${paths.join(', ')}` : message);
    this.name = 'ProtocolError';
    this.paths = paths;
  }
}

export function parseServerEvent(raw: unknown): ServerEvent {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new ProtocolError('Invalid server event JSON');
    }
  }
  if (!validateServerEvent(value)) {
    throw new ProtocolError(
      'Invalid server event',
      validateServerEvent.errors ?? [],
    );
  }
  return value as ServerEvent;
}
