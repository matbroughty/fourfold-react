/**
 * Runtime configuration.
 *
 * Secrets live in SSM Parameter Store as SecureStrings and are fetched once per
 * Lambda container, then cached. Nothing secret is ever read from an environment
 * variable in production — env vars only carry the parameter *names*, the table
 * name and the allowed origins, all of which are safe to see in the console.
 *
 * For local development the secrets may be supplied directly via
 * FOURFOLD_ADMIN_PASSWORD_HASH and FOURFOLD_TOKEN_SECRET, which skips SSM.
 */
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm'

export interface AppConfig {
  tableName: string
  adminPasswordHash: string
  tokenSecret: string
  /** Exact origins allowed to call the API. Empty means same-origin only. */
  allowedOrigins: string[]
  super6BaseUrl: string | undefined
}

let cached: AppConfig | undefined
let ssm: SSMClient | undefined

/** Test seam: drop the cached config. */
export function resetConfigCache(): void {
  cached = undefined
}

function splitOrigins(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached

  const tableName = process.env.FOURFOLD_TABLE_NAME
  if (!tableName) throw new Error('FOURFOLD_TABLE_NAME is not set')

  let adminPasswordHash = process.env.FOURFOLD_ADMIN_PASSWORD_HASH
  let tokenSecret = process.env.FOURFOLD_TOKEN_SECRET

  const hashParam = process.env.FOURFOLD_ADMIN_PASSWORD_HASH_PARAM
  const secretParam = process.env.FOURFOLD_TOKEN_SECRET_PARAM

  // Fetch whichever secrets were not supplied directly.
  const wanted = [
    !adminPasswordHash && hashParam ? hashParam : undefined,
    !tokenSecret && secretParam ? secretParam : undefined,
  ].filter((n): n is string => Boolean(n))

  if (wanted.length > 0) {
    ssm ??= new SSMClient({})
    const response = await ssm.send(
      new GetParametersCommand({ Names: wanted, WithDecryption: true }),
    )

    for (const parameter of response.Parameters ?? []) {
      if (parameter.Name === hashParam) adminPasswordHash = parameter.Value
      if (parameter.Name === secretParam) tokenSecret = parameter.Value
    }

    if ((response.InvalidParameters ?? []).length > 0) {
      // Log the names (not values) so a misconfiguration is diagnosable.
      console.error(
        `[config] missing SSM parameters: ${(response.InvalidParameters ?? []).join(', ')}`,
      )
    }
  }

  cached = {
    tableName,
    adminPasswordHash: adminPasswordHash ?? '',
    tokenSecret: tokenSecret ?? '',
    allowedOrigins: splitOrigins(process.env.FOURFOLD_ALLOWED_ORIGINS),
    super6BaseUrl: process.env.SUPER6_BASE_URL,
  }
  return cached
}
