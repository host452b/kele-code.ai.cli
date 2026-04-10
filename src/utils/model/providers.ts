import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.STUDY_ABC_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.STUDY_ABC_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.STUDY_ABC_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ACOMPANY_BASE_URL is a first-party Acompany API URL.
 * Returns true if not set (default API) or points to api.acompany.com
 * (or api-staging.acompany.com for ant users).
 */
export function isFirstPartyAcompanyBaseUrl(): boolean {
  const baseUrl = process.env.ACOMPANY_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.acompany.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.acompany.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
