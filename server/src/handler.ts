/**
 * Lambda entry points.
 *
 * `api` serves the Lambda Function URL (no API Gateway — see docs/architecture
 * in the README). `scheduledSync` is the EventBridge Scheduler target and runs
 * exactly the same sync code as the admin button.
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda'
import { Super6Client } from '../../shared/super6/client'
import { corsHeaders, handleRequest, type ApiRequest } from './api'
import { loadConfig, loadSyncConfig } from './config'
import { DynamoRepository } from './repo/dynamo'
import type { FourFoldRepository } from './repo/types'
import { syncSuper6 } from './sync'

let repo: FourFoldRepository | undefined

async function getRepo(tableName: string): Promise<FourFoldRepository> {
  repo ??= new DynamoRepository({ tableName })
  return repo
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return undefined
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body
  if (!raw.trim()) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    // Signalled as an object so the router's validation returns a clean 400.
    return { __malformed: true }
  }
}

export async function api(
  event: APIGatewayProxyEventV2,
  _context?: Context,
): Promise<APIGatewayProxyResultV2> {
  const config = await loadConfig()

  const origin = event.headers?.origin ?? event.headers?.Origin
  const cors = corsHeaders(origin, config)

  const method = event.requestContext?.http?.method ?? 'GET'

  // Preflight: answer before touching the database.
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' }
  }

  const request: ApiRequest = {
    method,
    path: event.rawPath ?? '/',
    query: (event.queryStringParameters ?? {}) as Record<string, string | undefined>,
    headers: (event.headers ?? {}) as Record<string, string | undefined>,
    body: parseBody(event),
    sourceIp: event.requestContext?.http?.sourceIp ?? 'unknown',
  }

  const response = await handleRequest(request, {
    repo: await getRepo(config.tableName),
    config,
    super6: new Super6Client(config.super6BaseUrl ? { baseUrl: config.super6BaseUrl } : {}),
  })

  return {
    statusCode: response.status,
    headers: {
      'content-type': 'application/json',
      // Public reads may be cached briefly; anything authorised must not be.
      'cache-control': request.path.includes('/admin') ? 'no-store' : 'public, max-age=30',
      ...cors,
      ...response.headers,
    },
    body: JSON.stringify(response.body),
  }
}

/**
 * Scheduled sync target.
 *
 * Always resolves. A thrown error would make EventBridge retry and, worse, would
 * show up as an alarm for something that is expected to fail occasionally when
 * Sky has a wobble. The outcome is recorded in the sync state either way.
 */
export async function scheduledSync(): Promise<{ ok: boolean; error: string | null }> {
  // loadSyncConfig, not loadConfig: this function has no IAM access to the admin
  // secrets by design, so it must not try to read them.
  const config = loadSyncConfig()
  const client = new Super6Client(
    config.super6BaseUrl ? { baseUrl: config.super6BaseUrl } : {},
  )

  const result = await syncSuper6({
    client,
    repo: await getRepo(config.tableName),
  })

  console.log(
    `[scheduled-sync] ok=${result.ok} created=${result.roundsCreated} ` +
      `updated=${result.roundsUpdated} skipped=${result.roundsSkipped}` +
      (result.warnings.length > 0 ? ` warnings=${result.warnings.length}` : ''),
  )

  return { ok: result.ok, error: result.error }
}
