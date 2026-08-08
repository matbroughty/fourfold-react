/**
 * FourFold backend, defined as CDK inside Amplify Gen 2.
 *
 * Why this shape:
 *  - Amplify Gen 2 lets you drop arbitrary CDK into the backend, so the whole
 *    application (frontend hosting + API + database + schedule) deploys from one
 *    repository with one pipeline. No separate CDK or SAM app to remember.
 *  - An API Gateway HTTP API fronts the Lambda. This was originally a public
 *    Lambda Function URL, which is cheaper and one service fewer — but this AWS
 *    account refuses anonymous Function URL invocations: with authType NONE and
 *    a resource policy allowing `Principal: "*"` on the exact function ARN, and
 *    no Organization SCP in play, every request still returned
 *    AccessDeniedException. An HTTP API is the standard public entry point and
 *    costs $1 per million requests, so a few thousand requests a month is
 *    fractions of a penny. If the account restriction is ever lifted, swapping
 *    back is a ten-line change.
 *  - There is no Cognito and no `defineAuth`. One administrator with one
 *    password does not need a user pool; see server/src/auth.ts.
 *  - DynamoDB on-demand rather than S3: the site reads individual seasons,
 *    rounds and returns, and writes single returns. That is a key/value access
 *    pattern, and on-demand billing for this traffic rounds to zero.
 *
 * Everything here stays inside the AWS free tier at this usage: a few hundred
 * KB of data, a few hundred Lambda invocations a month, and no always-on
 * compute, NAT gateway or load balancer.
 */
import { defineBackend } from '@aws-amplify/backend'
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import { fileURLToPath } from 'node:url'

/**
 * SSM parameter names holding the two secrets. These must be created once, by
 * hand, as SecureStrings — CloudFormation cannot create an encrypted parameter,
 * and putting them in the repo would defeat the point. See the README.
 */
const ADMIN_PASSWORD_HASH_PARAM = '/fourfold/admin-password-hash'
const TOKEN_SECRET_PARAM = '/fourfold/token-secret'

/**
 * Origins allowed to call the API cross-site.
 *
 * The SPA is served from a different host to the Function URL, so the browser
 * does send an Origin header and CORS matters. Only these exact origins are
 * reflected; there is no wildcard.
 */
const ALLOWED_ORIGINS = [
  'https://fourfold.co.uk',
  'https://www.fourfold.co.uk',
  'https://new.fourfold.co.uk',
  'http://localhost:5173',
].join(',')

/** How often to poll Super 6. */
const SYNC_INTERVAL = Duration.hours(3)

const backend = defineBackend({})
const stack = backend.createStack('fourfold')

/* ------------------------------------------------------------------ *
 * Database
 * ------------------------------------------------------------------ */

/**
 * Single table. See server/src/repo/dynamo.ts for the key design.
 *
 * RETAIN on delete, and point-in-time recovery on: this table is the permanent
 * record of the competition, and losing it to a stack mistake is the one
 * genuinely unrecoverable failure here.
 */
const table = new dynamodb.Table(stack, 'FourFoldTable', {
  partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  removalPolicy: RemovalPolicy.RETAIN,
})

/* ------------------------------------------------------------------ *
 * Lambda
 * ------------------------------------------------------------------ */

const entry = fileURLToPath(new URL('../server/src/handler.ts', import.meta.url))

const commonFunctionProps = {
  entry,
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  memorySize: 512,
  environment: {
    FOURFOLD_TABLE_NAME: table.tableName,
    FOURFOLD_ADMIN_PASSWORD_HASH_PARAM: ADMIN_PASSWORD_HASH_PARAM,
    FOURFOLD_TOKEN_SECRET_PARAM: TOKEN_SECRET_PARAM,
    FOURFOLD_ALLOWED_ORIGINS: ALLOWED_ORIGINS,
  },
  bundling: {
    minify: true,
    sourceMap: false,
    // Bundle the AWS SDK rather than relying on the runtime's copy, so a future
    // runtime change cannot alter behaviour underneath us.
    externalModules: [],
  },
}

/**
 * Logs are the only observability here. A month is plenty to debug a failed sync,
 * and costs almost nothing to keep.
 */
const logGroupProps = {
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: RemovalPolicy.DESTROY,
}

/** Serves the public site and the admin API. */
const apiFunction = new NodejsFunction(stack, 'FourFoldApi', {
  ...commonFunctionProps,
  handler: 'api',
  timeout: Duration.seconds(20),
  logGroup: new logs.LogGroup(stack, 'FourFoldApiLogs', logGroupProps),
})

/** Scheduled Super 6 import. Separate function so a slow sync cannot block reads. */
const syncFunction = new NodejsFunction(stack, 'FourFoldSync', {
  ...commonFunctionProps,
  handler: 'scheduledSync',
  // Fetching up to ~50 rounds with retries needs more headroom than a page read.
  timeout: Duration.minutes(2),
  logGroup: new logs.LogGroup(stack, 'FourFoldSyncLogs', logGroupProps),
})

table.grantReadWriteData(apiFunction)
table.grantReadWriteData(syncFunction)

/**
 * Read access to the two secrets.
 *
 * The sync function never authenticates anyone, so it gets no access to the
 * password hash or the token secret at all.
 */
apiFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['ssm:GetParameter', 'ssm:GetParameters'],
    resources: [
      Stack.of(stack).formatArn({
        service: 'ssm',
        resource: 'parameter',
        resourceName: ADMIN_PASSWORD_HASH_PARAM.replace(/^\//, ''),
      }),
      Stack.of(stack).formatArn({
        service: 'ssm',
        resource: 'parameter',
        resourceName: TOKEN_SECRET_PARAM.replace(/^\//, ''),
      }),
    ],
  }),
)

/**
 * Public HTTPS endpoint.
 *
 * No authorizer: authorisation is ours to do, and every mutating route checks an
 * admin token (see server/src/api.ts). The public read routes are genuinely
 * public — it is a football results site.
 *
 * A `defaultIntegration` with no explicit routes proxies every path and method
 * to the Lambda, which does its own routing. CORS is deliberately NOT configured
 * here: the Lambda answers OPTIONS itself and reflects only exact allowed
 * origins, and setting it in both places would emit duplicate headers.
 *
 * The default `$default` stage means paths arrive unprefixed, so `rawPath` is
 * `/api/health` rather than `/prod/api/health`.
 */
const httpApi = new apigwv2.HttpApi(stack, 'FourFoldHttpApi', {
  description: 'FourFold public and admin API',
  defaultIntegration: new HttpLambdaIntegration('FourFoldApiIntegration', apiFunction),
})

/* ------------------------------------------------------------------ *
 * Schedule
 * ------------------------------------------------------------------ */

/**
 * Poll Super 6 every three hours.
 *
 * Rounds are weekly and results settle within a few hours of the last fixture,
 * so this is comfortably often enough to pick up new rounds and final scores —
 * about 240 invocations a month. A live score can therefore be up to three
 * hours stale; the admin "Sync Super 6" button covers the impatient case. There
 * is deliberately no adaptive schedule: it would be more moving parts to
 * maintain than the staleness is worth.
 */
new events.Rule(stack, 'FourFoldSyncSchedule', {
  schedule: events.Schedule.rate(SYNC_INTERVAL),
  description: 'Import Sky Super 6 rounds and results into FourFold',
  targets: [new targets.LambdaFunction(syncFunction, { retryAttempts: 2 })],
})

/* ------------------------------------------------------------------ *
 * Outputs
 * ------------------------------------------------------------------ */

new CfnOutput(stack, 'ApiBaseUrl', {
  value: httpApi.apiEndpoint,
  description: 'Base URL of the FourFold API',
})

new CfnOutput(stack, 'TableName', {
  value: table.tableName,
  description: 'Pass as FOURFOLD_TABLE_NAME when running the history migration',
})

// Published into amplify_outputs.json during the backend build, which is how the
// frontend learns the API URL without anyone setting an environment variable.
backend.addOutput({
  custom: {
    apiBaseUrl: httpApi.apiEndpoint,
    tableName: table.tableName,
  },
})
