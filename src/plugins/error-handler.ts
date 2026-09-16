import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  type ZodFastifySchemaValidationError,
} from 'fastify-type-provider-zod';
import { ErrorCode, isAppError, VersionConflictError, type ErrorFields } from '../common/errors.js';

/**
 * The single place HTTP error bodies are built (Part B §4). Every failure — thrown
 * AppError, Zod validation failure, Fastify 4xx, or an unexpected crash — leaves here
 * in the same shape, so the Android client can parse one structure everywhere.
 */

interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: ErrorFields;
    requestId: string;
  };
  /** Only present for VERSION_CONFLICT (Part B §7.2). */
  current?: unknown;
}

function buildBody(
  code: string,
  message: string,
  requestId: string,
  fields?: ErrorFields,
): ErrorBody {
  const body: ErrorBody = { error: { code, message, requestId } };
  if (fields && Object.keys(fields).length > 0) {
    body.error.fields = fields;
  }
  return body;
}

/**
 * Turns Zod validation failures into { "path.to.field": "REASON" }. The reason is a
 * stable machine code, because Android maps behavior to codes and never to messages.
 *
 * The type provider reports each issue as an `instancePath` ("/body/title") plus a
 * `keyword` holding the Zod issue code.
 */
function zodIssuesToFields(issues: readonly ZodFastifySchemaValidationError[]): ErrorFields {
  const fields: ErrorFields = {};

  for (const issue of issues) {
    const path = issue.instancePath.replace(/^\//, '').split('/').filter(Boolean).join('.');
    fields[path || '(root)'] ??= issueCode(issue.keyword);
  }

  return fields;
}

function issueCode(code: string): string {
  switch (code) {
    case 'invalid_type':
      return 'TYPE_INVALID';
    case 'too_small':
    case 'too_big':
      return 'LENGTH_INVALID';
    case 'invalid_format':
    case 'invalid_string':
      return 'FORMAT_INVALID';
    case 'invalid_value':
    case 'invalid_enum_value':
      return 'VALUE_INVALID';
    case 'unrecognized_keys':
      return 'UNKNOWN_FIELD';
    default:
      return 'INVALID';
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    // Request body/query/params failed Zod validation.
    if (hasZodFastifySchemaValidationErrors(error)) {
      const fields = zodIssuesToFields(error.validation);

      request.log.info({ fields }, 'request validation failed');
      return reply
        .status(400)
        .send(buildBody(ErrorCode.VALIDATION_FAILED, 'Validation failed', requestId, fields));
    }

    // A handler returned something its response schema rejects: our bug, not the client's.
    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, method: request.method, url: request.url },
        'response did not match its schema',
      );
      return reply
        .status(500)
        .send(buildBody(ErrorCode.INTERNAL_ERROR, 'Internal server error', requestId));
    }

    if (isAppError(error)) {
      const body = buildBody(error.code, error.message, requestId, error.fields);

      if (error instanceof VersionConflictError) {
        body.current = error.current;
      }

      // 5xx from a typed error would be a bug; everything here is a 4xx the client caused.
      request.log.info({ code: error.code, status: error.statusCode }, 'request rejected');
      return reply.status(error.statusCode).send(body);
    }

    // Fastify's own errors (bad JSON, payload too large, rate limit, ...). The guards
    // above have narrowed `error` away from its declared type, so read it back defensively.
    const { statusCode, code, message } = asHttpError(error);

    if (statusCode < 500) {
      request.log.info({ err: error }, 'request rejected');
      return reply
        .status(statusCode)
        .send(buildBody(mapFastifyErrorCode(code, statusCode), message, requestId));
    }

    // NFR-8: log the stack, return nothing internal.
    request.log.error({ err: error, method: request.method, url: request.url }, 'unhandled error');
    return reply
      .status(500)
      .send(buildBody(ErrorCode.INTERNAL_ERROR, 'Internal server error', requestId));
  });

  // Unknown route: the same body shape as everything else.
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send(buildBody(ErrorCode.NOT_FOUND, 'Resource not found', request.id));
  });
}

/** Reads status/code/message off an unknown throwable without trusting its shape. */
function asHttpError(error: unknown): { statusCode: number; code?: string; message: string } {
  const candidate = (typeof error === 'object' && error !== null ? error : {}) as {
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };

  return {
    statusCode: typeof candidate.statusCode === 'number' ? candidate.statusCode : 500,
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : 'Internal server error',
  };
}

function mapFastifyErrorCode(fastifyCode: string | undefined, statusCode: number): string {
  if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE' || statusCode === 413) {
    return ErrorCode.FILE_TOO_LARGE;
  }
  if (statusCode === 429) return ErrorCode.RATE_LIMITED;
  if (statusCode === 401) return ErrorCode.TOKEN_INVALID;
  if (statusCode === 403) return ErrorCode.FORBIDDEN;
  if (statusCode === 404) return ErrorCode.NOT_FOUND;
  return ErrorCode.VALIDATION_FAILED;
}
