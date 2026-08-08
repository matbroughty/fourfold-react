import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSyncConfig, resetConfigCache } from './config'

/**
 * These tests exist because of a real deployment failure: the sync Lambda is
 * given no IAM access to the admin secrets, but the config loader used to fetch
 * them unconditionally, so the deployed function died with AccessDenied on every
 * scheduled run.
 */
describe('loadSyncConfig', () => {
  const original = { ...process.env }

  beforeEach(() => {
    resetConfigCache()
    delete process.env.FOURFOLD_TABLE_NAME
    delete process.env.SUPER6_BASE_URL
  })

  afterEach(() => {
    process.env = { ...original }
    resetConfigCache()
  })

  it('reads the table name from the environment', () => {
    process.env.FOURFOLD_TABLE_NAME = 'fourfold-test'
    expect(loadSyncConfig()).toEqual({
      tableName: 'fourfold-test',
      super6BaseUrl: undefined,
    })
  })

  it('allows the Super 6 base URL to be overridden', () => {
    process.env.FOURFOLD_TABLE_NAME = 'fourfold-test'
    process.env.SUPER6_BASE_URL = 'https://example.test/v2'
    expect(loadSyncConfig().super6BaseUrl).toBe('https://example.test/v2')
  })

  it('fails loudly when the table is not configured', () => {
    expect(() => loadSyncConfig()).toThrow('FOURFOLD_TABLE_NAME is not set')
  })

  it('needs no secrets at all, so the sync role needs no SSM access', () => {
    process.env.FOURFOLD_TABLE_NAME = 'fourfold-test'
    // Deliberately set nothing else: no password hash, no token secret, and no
    // SSM parameter names. If this ever starts requiring them, the scheduled
    // sync will break in production again.
    const config = loadSyncConfig()

    expect(Object.keys(config).sort()).toEqual(['super6BaseUrl', 'tableName'])
    expect(JSON.stringify(config)).not.toMatch(/secret|password|hash/i)
  })
})
