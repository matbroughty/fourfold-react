/**
 * Generate the admin secrets.
 *
 *   npx tsx scripts/hash-password.ts 'the password you want'
 *
 * Prints the scrypt hash and a fresh token secret, plus the two AWS CLI commands
 * that store them. Nothing is written to disk, and the password itself is never
 * stored anywhere — only its hash.
 *
 * The parameters must be SecureStrings, which is why they are created by hand:
 * CloudFormation cannot create an encrypted SSM parameter.
 */
import { randomBytes } from 'node:crypto'
import { hashPassword } from '../server/src/auth'

const ADMIN_PASSWORD_HASH_PARAM = '/fourfold/admin-password-hash'
const TOKEN_SECRET_PARAM = '/fourfold/token-secret'

async function main(): Promise<void> {
  const password = process.argv[2]

  if (!password) {
    console.error(
      'Usage: npx tsx scripts/hash-password.ts \'your-admin-password\'\n\n' +
        'Tip: put a space before the command so it stays out of your shell history.',
    )
    process.exit(1)
  }

  const hash = await hashPassword(password)
  const tokenSecret = randomBytes(32).toString('hex')

  console.log('\nAdmin password hash:')
  console.log(hash)
  console.log('\nToken secret (signs admin sessions; rotating it logs you out):')
  console.log(tokenSecret)

  console.log('\nStore both in SSM Parameter Store:\n')
  console.log(
    `aws ssm put-parameter --name '${ADMIN_PASSWORD_HASH_PARAM}' \\\n` +
      `  --type SecureString --overwrite \\\n` +
      `  --value '${hash}'\n`,
  )
  console.log(
    `aws ssm put-parameter --name '${TOKEN_SECRET_PARAM}' \\\n` +
      `  --type SecureString --overwrite \\\n` +
      `  --value '${tokenSecret}'\n`,
  )
  console.log('Use the same --region as the Amplify backend.\n')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
