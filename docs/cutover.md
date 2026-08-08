# Cutting over to fourfold.co.uk

**Nothing in this rebuild changes production.** `fourfold.co.uk` still serves the
old static site from the `fffc` repository, and this document is the deliberate
manual step to change that when you are ready.

Do this at a quiet moment — ideally between rounds, not mid-weekend.

## Before you start

Confirm on `new.fourfold.co.uk`:

- [ ] The current season's table looks right.
- [ ] All five historical seasons appear under **Seasons**, with the totals in
      [data-provenance.md](data-provenance.md).
- [ ] The latest round shows six fixtures with correct kick-off times.
- [ ] `/admin` signs in with the password you stored in SSM.
- [ ] Entering a test return updates the table, and deleting it puts the total
      back. (Do this on staging, then delete it.)
- [ ] **Sync Super 6** reports a recent successful sync with no error.
- [ ] The scheduled sync has run on its own at least once — check the sync Lambda's
      CloudWatch logs for a `[scheduled-sync] ok=true` line.
- [ ] A round with no winners reads "No returns this round."

## Cut-over

1. **Back up the production data one more time.**
   ```bash
   aws dynamodb scan --table-name <prod-table> > fourfold-backup-$(date +%F).json
   ```
   The historical CSVs are in git, so this is really about returns entered since
   go-live.

2. **Keep the old site recoverable.** Do not delete the `fffc` repository or its
   hosting. Tag it first so there is an obvious rollback point:
   ```bash
   cd /path/to/fffc && git tag pre-fourfold-cutover && git push --tags
   ```

3. **Add the production domain in Amplify.** Amplify → Domain management → add
   `fourfold.co.uk` and `www.fourfold.co.uk`, pointing at the production branch.
   Amplify issues the certificate and gives you the DNS records.

4. **Update DNS** at the registrar to Amplify's records. Lower the TTL to ~300s a
   day beforehand so a rollback propagates quickly.

5. **Add the production origins to CORS.** `fourfold.co.uk` and
   `www.fourfold.co.uk` are already in `ALLOWED_ORIGINS` in
   `amplify/backend.ts` — confirm the deployed Lambda has them in its
   `FOURFOLD_ALLOWED_ORIGINS` environment variable, and redeploy the backend if
   not.

6. **Set `VITE_API_BASE_URL`** on the production branch to the production Function
   URL, then redeploy the frontend. A frontend pointed at the staging API is the
   single easiest mistake to make here.

7. **Add the SPA rewrite** on the production branch (`/<*>` → `/index.html`, 200)
   or `/admin` will 404 on refresh.

8. **Verify against production**: the table loads, `/admin` signs in, Sync Super 6
   succeeds, and the historical seasons are all present.

## Rollback

Point DNS back at the old host. The static site is unchanged and needs no
redeploy. Nothing in the new stack is destroyed by rolling back, and no data is
lost — the DynamoDB table is untouched by a DNS change.

## Afterwards

- Update the READMEs of `fffc` and `fourfold-react` to say which one is live.
- Consider archiving `fffc` on GitHub (read-only, still recoverable).
- The old CloudFront distribution serving `kent.csv` (`EFO1YLQE2R2A9`, domain
  `d39p7vg8kswmae.cloudfront.net`) is no longer used by anything. **Leave it alone
  for at least a season** — it is currently the only copy of some data outside
  this repository. Once you are confident, it and its S3 bucket can go.
- If the missing 2025/26 rounds ever turn up, append them to
  `data/history/2025-26.csv` and re-run `migrate:history -- --write`.
