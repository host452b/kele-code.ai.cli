import type { Command } from '../../commands.js'
import { hasAcompanyApiKeyAuth } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasAcompanyApiKeyAuth()
      ? 'Switch Acompany accounts'
      : 'Sign in with your Acompany account',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
