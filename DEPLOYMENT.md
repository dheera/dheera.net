# Deployment

Updated 2026-11-15. The first preview deployment succeeded: 856 public files and two deployment records uploaded to `dheera-net`. All 47 HTTP checks passed through CloudFront, covering both languages, clean gallery URLs, assets, content types, one-minute cache headers and real 404 responses. Browser checks passed for homepage images, gallery navigation/lightbox, and switching languages. A repeat deployment dry run found zero changed files. CloudFront revalidated the homepage, a gallery, and CSS after 63 seconds (`RefreshHit`). DNS and CloudFront configuration were not changed. Bucket-only credentials cannot inspect the distribution's cache-policy configuration; mainland-China reachability remains untested.

## Configured preview target

The repository's `deploy.config.json` stores non-secret deployment settings:

| Setting | Value |
| --- | --- |
| Default target | `preview` |
| S3 bucket | `dheera-net` |
| AWS region | `us-west-2` |
| Site URL | `https://dk7lfbp0bsgga.cloudfront.net` |
| AWS profile | `dheera-site` |
| CloudFront invalidation | Disabled; bucket-only publishing uses cache expiry |

The version-1 format has `defaultTarget` and named entries under `targets`. `targets.preview` contains `bucket`, `region`, `profile`, `siteURL`, `cacheControl`, and `invalidateCloudFront`. `npm run deploy` reads this configuration and passes the target's `siteURL` to a fresh local build. `npm run publish` remains local and does not read deployment settings or upload files.

Credentials use AWS's standard shared files outside the checkout: `~/.aws/credentials` has `[dheera-site]`, and `~/.aws/config` has `[profile dheera-site]` with region `us-west-2`. The canonical credentials already matched `.iam_key`; after verifying that match and credential file permissions `0600`, the duplicate `.iam_key` was removed. `.gitignore` excludes `.iam_key` and any repository-local `.aws/` directory. Secret keys do not belong in `deploy.config.json` or the repository.

## Console walkthrough: preview with bucket-only upload credentials

The user configures infrastructure in AWS; the local publisher receives access only to the new website bucket. Cache expiry replaces API-driven invalidation in this mode. Namecheap and the live site remain unchanged for this preview.

1. **S3 → Create bucket:** choose General purpose, a unique name such as `dheera-net-preview-2026-<suffix>`, and US West (Oregon), `us-west-2`. Keep Object Ownership at Bucket owner enforced (ACLs disabled), Block all public access on, and encryption SSE-S3. Leave static website hosting disabled. Defaults for versioning and other features are sufficient for this preview.
2. **CloudFront → Create distribution:** choose a standard Single website or app distribution and pay-as-you-go pricing. Select the new bucket as an Amazon S3 origin, leave Origin path empty, and enable Origin Access Control (OAC), always signing requests. The recommended S3 origin setup can configure the distribution-specific read policy automatically. If a policy-copy prompt appears instead, copy it into this bucket's Permissions → Bucket policy. Keep Block Public Access on. Choose HTTP-to-HTTPS redirect, allowed methods GET/HEAD, automatic compression, and the default CloudFront certificate/domain. Leave custom domains empty and optional WAF/CAPTCHA/bot challenges off. Set the Default root object to `index.html` (without a leading slash), either during creation or under distribution Settings afterward.
3. **CloudFront → Policies → Cache → Create cache policy:** name it `dheera-preview-60s`; Minimum TTL 0, Default TTL 60, Maximum TTL 120. Cache-key headers/cookies/query strings: None; gzip and Brotli support: enabled. Attach it under the distribution's Behaviors → Default (*) → Edit → Cache policy. Confirm Compress objects automatically is Yes. The upload script will set the browser/CDN headers documented below.
4. **CloudFront → Functions → Create function:** name `dheera-clean-urls`, JavaScript runtime 2.0. Paste `deployment/cloudfront-clean-urls.js`, save and publish the function to LIVE. Associate it with this distribution's default behavior at **Viewer request**. This makes `/photos/deepscapes`, `/photos/deepscapes/`, and Chinese routes serve the matching `index.html`, keeping the URL clean. Unknown routes still request their own nonexistent object and return 404; there is no SPA homepage fallback.
5. **Distribution → Error pages → Create custom error response:** create entries for origin 403 and 404. For both, set Error caching minimum TTL to 1 second, Customize error response Yes, Response page path `/404.html`, and HTTP response code 404. This generated file will be uploaded with the site. Origin permissions can also produce 403, so check the OAC policy if every page fails.
6. **IAM → Policies → Create policy → JSON:** paste `deployment/bucket-publisher-policy.example.json`, replace both occurrences of `REPLACE_SITE_BUCKET` with the actual name, and create the policy. Attach it to a dedicated IAM uploader user. Create an access key for local CLI use under that user's Security credentials. Console access is not needed for this uploader. Configure the key locally with `aws configure --profile dheera-site`, region `us-west-2`, output `json`. The policy permits publishing and removing generated website objects only in this bucket, and has no CloudFront/IAM/ACM permissions. Do not use a root access key.
7. Wait for the distribution to finish deploying. Record the bucket name, region, CloudFront URL and local profile in `deploy.config.json`; the supplied preview values are already recorded. Credentials stay in the local AWS credential store. A 403/404 before the first upload is expected when the bucket is empty. Run the preview deployment below, then verify its routes and headers.

Official references: [S3/CloudFront console setup](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GettingStarted.SimpleDistribution.html), [cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-create-cache-policy.html), [function association](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/associate-function.html).

## Finish the site, then preview it

The portable output is a complete static site:

```text
/stuff/publish → npm run deploy -- --target preview → local build → private S3 bucket → CloudFront
```

The NAS holds canonical originals and editable English/Chinese sidecars. Upload only the generated site. Original JPEGs, private content, translation state, and credentials do not belong in the public output. An optional private original backup should be separate from the website bucket. WebP generation already happens locally; Imgix is unnecessary.

1. Finish the local site first. Keep the current live site, old S3 buckets, and apex DNS unchanged.
2. Verify the supplied preview bucket and distribution follow the console setup above: S3 REST origin, Block Public Access, and Origin Access Control (OAC), signing requests. Limit the bucket's read policy to that distribution. S3 website hosting stays disabled. [AWS OAC setup](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
3. Start at `https://dk7lfbp0bsgga.cloudfront.net`, which has its own default HTTPS certificate. Run `npm run deploy -- --target preview` from the repository root; it builds with that URL and rejects output containing design-preview controls. [CloudFront domain and certificate settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html)
4. After the default-domain preview works, add `preview.dheera.net` for realistic custom-domain testing. This adds a preview DNS record; it does not move the live homepage. Rebuild with that preview URL so canonical, social, and sitemap URLs agree.
5. Move `dheera.net` only after routing, content, and mainland-China reachability meet the requirements below. Configure a production target with `siteURL: "https://dheera.net"` for that release.

Keep normal visits free of CAPTCHA, JavaScript challenges, or human-verification interstitials. Do not add WAF challenge rules or interactive bot checks. Images, fonts, gallery scripts, and map data are already served locally with the site; the page does not require Google Fonts, Google Maps, or a third-party JavaScript CDN.

## Mainland-China reachability

CloudFront Global can deliver to mainland visitors from locations outside China, but availability is not guaranteed. AWS explicitly identifies the risk of blocking. CloudFront China is a separate service and requires an ICP recordal; it is not a switch on a Global distribution. [AWS: Content delivery in China](https://aws.amazon.com/developer/application-security-performance/articles/content-delivery-in-china/)

Before choosing the final host or changing the live domain, test both the initial CloudFront address and **the actual `preview.dheera.net` hostname** from mainland China: China Telecom, China Unicom, and China Mobile, across multiple locations and times. Check DNS, TLS, first-page loading, full-size images, fonts, and gallery JavaScript; a successful request from outside China is insufficient evidence. Record results and repeat after final DNS changes.

If those results are poor, the same `dist/` can be mirrored on a Hong Kong host or another suitable provider without changing the authoring workflow. Hong Kong hosting is also not a guarantee against blocking. Select the deployment based on observed reachability rather than assuming a CDN or region is universally accessible.

## Routing and languages

Use the prepared viewer-request CloudFront Function for directory indexes:

- Internally rewrite extensionless and trailing-slash page paths to their `index.html`, including `/` and `/zh-hant/`. Leave asset paths and query strings unchanged.
- The preview function accepts both slash forms. Generated links/canonicals use trailing slashes. An optional future redirect from `/photos/deepscapes` to `/photos/deepscapes/` can match the local preview server's 301 behavior.
- Serve the generated `404.html` with **HTTP 404**, never the homepage with HTTP 200. With a private S3 origin, missing keys may appear as 403; map origin 403/404 to the custom 404 response with a short error-cache lifetime. Verify genuine origin-permission failures separately.
- Port the applicable old-site redirects before the domain cutover, retaining existing photo and project links wherever possible.

S3's REST origin and CloudFront's root-object setting do not supply subdirectory indexes automatically. The function source is provided locally; the bucket-only uploader does not publish/associate it or configure error responses. Verify those settings in CloudFront using the console steps above. [Function rewrite example](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_functions_url_rewrite_single_page_apps_section.html), [custom error responses](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html)

English and Traditional Chinese are already complete static pages at `/…/` and `/zh-hant/…/`. The browser enhancement remembers an explicit language choice and uses browser language preferences on a fresh homepage visit. Both languages work without JavaScript; deep links retain their language.

Optional later improvement: negotiate HTTP `Accept-Language` **only on `/`** with a temporary redirect. A saved explicit-choice cookie must take precedence, followed by ordered/weighted supported language preferences. The current locally saved choice would need to be mirrored to that cookie. Never redirect a language-specific deep link. Keep personalized redirects out of shared caches; do not vary every asset or HTML cache entry by language. This edge negotiation is not required for the preview and is not implemented.

## Cache and publish behavior

The requested initial policy is a one-minute freshness lifetime, capped at two minutes, for **all public files**, including photos. Use a custom CloudFront cache policy with **Minimum TTL 0, Default TTL 60, Maximum TTL 120 seconds**, applied to every site cache behavior. Select a standard pay-as-you-go distribution for this configurable policy; the flat-rate Free/Pro plans do not offer custom cache policies. This changes the earlier tentative Free-plan recommendation.

Set this S3 object metadata on every uploaded file:

```http
Cache-Control: public, max-age=60, s-maxage=60, must-revalidate, stale-if-error=0
```

The browser uses `max-age`; CloudFront uses `s-maxage` and the policy's limits. Omit `stale-while-revalidate`, and explicitly prevent stale-on-error responses. Set error-response caching to 0 or a few seconds. A TTL limits freshness before revalidation, not the physical lifetime of a stored cache entry; an unchanged object can legitimately be revalidated. Already-open pages are not live-updated by cache expiry.

The uploader sets content types, including WebP, HTML, CSS and JavaScript, and applies these headers to every uploaded object. Use `--force` to reapply all bytes and metadata if remote files or headers have been changed outside the uploader. If changing from a longer policy, invalidate old objects once in the console after changing policy/metadata. Routine bucket-only uploads rely on the configured short TTL and need no invalidation API permission. The uploader makes no CloudFront API calls. Long immutable media caching is deliberately not enabled under the current two-minute requirement, although content-hashed filenames would make it a safe future optimization. [CloudFront TTL settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html), [expiration and stale behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)

Run these commands from the repository root, with the AWS CLI installed and the named profile configured:

```sh
npm run deploy -- --target preview --dry-run
npm run deploy -- --target preview
# Reapply every public file and its metadata when needed:
npm run deploy -- --target preview --force
```

Every command builds saved NAS content with the target's canonical URL; none generates translations or calls an LLM. `--dry-run` still builds locally and reads the previous S3 deployment record, but performs no uploads, deletions, or deployment-receipt writes. Omitting `--target` uses `defaultTarget`.

The implemented uploader (`deploy.mjs` and `lib/deploy.mjs`):

1. Resolves `dist/` to one fixed `.published/releases/<id>/` directory after a successful build. It validates required pages, public file paths, the canonical URL and absence of design-preview controls. The local build's `manifest.json` is excluded from uploads.
2. Compares each public file's SHA-256 hash and content type with S3's `_deploy/current.json`. Matching files are skipped unless `--force` is supplied or the configured cache metadata differs. This relies on the deployment record; it does not inspect every remote object's bytes or headers for manual changes.
3. Uploads changed media first, other assets second, and HTML/discovery files last. Only after all uploads succeed does it delete obsolete **managed HTML** keys listed in the previous deployment record. There is no blanket bucket deletion or `sync --delete`.
4. Retains old media and assets indefinitely; garbage collection is not implemented. It writes `_deploy/releases/<release-id>.json` and `_deploy/current.json` only after uploads and page deletions succeed, then saves a local receipt at `.published/deployments/preview/current.json` (or the selected target's name). These public deployment records contain deployment identifiers and public object keys, hashes and content types, never NAS source paths or the local build manifest.
5. Uses the configured AWS profile/region and bucket-only operations. It does not change DNS, CloudFront settings or infrastructure, and does not request invalidations. Allow up to two minutes for existing cached responses under the configured policy.

The `.deploy-lock` prevents overlapping deployments from this checkout only. Use a single publisher; simultaneous deployments from different machines/checkouts are not coordinated. A multi-object S3 upload is not an atomic site switch. Shared CSS/JavaScript currently have unversioned paths, so keep them compatible with both old and new HTML during deployment. A failed upload can leave a partially updated site; retrying reconciles against the last completed deployment record. Archived records are useful for diagnosis, but an automatic rollback command is not implemented.

After uploading, verify English/Chinese routes, directory/slash handling, legacy redirects, real 404 responses, image/video loading, content types and cache headers through CloudFront. These delivery checks are separate from a successful S3 upload. The first preview passed 47 HTTP checks: all 24 HTML pages in both languages, five slashless gallery URLs, images from each gallery, CSS/JavaScript/fonts, root and explicit `index.html`, sitemap/robots, and HTTP 404 for a missing route, the removed Laos gallery and the excluded build `manifest.json`. Checked assets returned their expected content types and one-minute cache headers. Browser interaction checks and mainland-China testing are separate. `npm run publish` remains local; translation stays a separate explicit step.

## Custom domain and certificates, later

The domain registrar can stay where it is. The DNS provider only needs to support the necessary records; an apex alias/ANAME/flattening capability is needed to point `dheera.net` at CloudFront, or DNS hosting can be changed separately from registration.

For a custom hostname, CloudFront requires the viewer certificate in ACM's **`us-east-1`** region. A free ACM-managed public certificate with DNS validation is the simpler renewal path. An existing externally issued certificate can instead be imported with its matching private key and certificate chain in the required PEM format. Keep that material outside the repository and logs. Imported certificates require manual renewal/reimport. [CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html), [ACM import prerequisites](https://docs.aws.amazon.com/acm/latest/userguide/import-certificate-prerequisites.html)

The certificate must cover each hostname used. `*.dheera.net` covers `preview.dheera.net` and `www.dheera.net`, but **does not cover `dheera.net`**; include the apex explicitly in its names.

### Namecheap DNS

Keep registration at Namecheap. If the domain uses Namecheap BasicDNS, FreeDNS or PremiumDNS, it also supports the apex ALIAS record required here. In **Domain List → Manage → Advanced DNS**, the later records will be:

| Stage | Type | Host | Value |
| --- | --- | --- | --- |
| Certificate validation | CNAME | The ACM-issued validation host, with the final `.dheera.net` removed | Exact ACM-issued target |
| Custom preview | CNAME | `preview` | Assigned `d….cloudfront.net` hostname |
| Final cutover | ALIAS | `@` | Assigned production CloudFront hostname |
| Optional www | CNAME | `www` | Assigned production CloudFront hostname |

Values are hostnames, without `https://` or a path. Add the hostname to the CloudFront distribution and attach its matching certificate before pointing DNS at it. Keep certificate-validation records for automatic renewal. At final cutover, replace only conflicting website A/AAAA/redirect records for the same host; retain mail and unrelated records. If nameservers point elsewhere, make DNS edits at that provider. No DNS change is needed for the initial default CloudFront preview. [Namecheap ALIAS setup](https://www.namecheap.com/support/knowledgebase/article.aspx/10128/2237/how-to-create-an-alias-record/)

## Local AWS credentials and permissions

The uploader explicitly selects the `dheera-site` profile named in `deploy.config.json`; it does not silently fall back to the unrelated `default` profile. The standard credential/profile files are outside the checkout. Listing and uploading with this profile were verified during the first preview deployment. Credentials are never placed in the repository, content library, deploy-target JSON, or chat.

If using IAM Identity Center, configure a role-backed profile and sign in:

```sh
aws configure sso --profile dheera-site
aws sso login --profile dheera-site
aws sts get-caller-identity --profile dheera-site
```

Otherwise, a dedicated IAM user's access key can be entered locally with `aws configure --profile dheera-site`. Use a site-scoped policy; root-account access keys are unnecessary. An existing suitable profile can be reused. The agent only needs the profile name and the deployment target identifiers, not pasted secret keys. [AWS CLI SSO setup](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)

There are two permission sets:

- **One-time infrastructure setup:** create/configure the dedicated S3 bucket and bucket policy, CloudFront distribution, OAC, cache policy and URL-rewrite function; later request/import an ACM certificate. If infrastructure is created manually in the console, the daily uploader does not need those creation permissions.
- **Routine publishing:** list/read/write the dedicated bucket, delete managed obsolete pages, and handle multipart uploads. Bucket-only permission is sufficient with the short TTL. Optional additional CloudFront permissions enable creating/checking invalidations for this distribution. CloudFront does not require a separate kind of credential: the same AWS identity can have both service permissions.

Use `deployment/bucket-publisher-policy.example.json` for the requested bucket-only uploader; replace its two bucket placeholders. `deployment/publisher-policy.example.json` is an optional extended template with CloudFront invalidation access for a future workflow; the current uploader does not use it. That template also needs the AWS account and distribution ID. Neither grants infrastructure creation, IAM administration, certificate access, or access to the old photo bucket. Both assume S3-managed encryption (SSE-S3); customer-managed KMS encryption would require additional key permissions. The uploader enforces the manifest-based deletion rules above.

## Pricing and configuration limits

AWS's published flat-rate plans, checked 2026-11-15:

| Per distribution, monthly | Free | Pro |
| --- | ---: | ---: |
| Plan price | $0 | $15 |
| Request allowance | 1 million | 10 million |
| Data-transfer allowance | 100 GB | 50 TB |
| S3 Standard storage credit | 5 GB | 50 GB |

These are the flat-rate plans, not the separate pay-as-you-go free allowances. Storage credits do not make all S3 operations or other AWS services free. Recheck the current offer and account eligibility when setting up the distribution. [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/)

Free and Pro include OAC, CloudFront Functions, default caching, invalidations, and ACM-managed TLS. **Custom cache policies are listed only for Business/Premium.** The requested strict 120-second cap is therefore planned on pay-as-you-go CloudFront. Its published monthly account-wide free allowances are currently 1 TB transfer and 10 million HTTP/HTTPS requests; S3 storage/requests and edge-function usage are separately metered. Check the current allowances, regional pricing and other account usage during setup. [Flat-rate feature matrix](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html), [pay-as-you-go allowances](https://aws.amazon.com/cloudfront/faqs/)

CloudFront generally supports imported ACM certificates, but the flat-rate feature matrix does not explicitly establish imported-certificate eligibility by tier. Confirm this during setup if retaining an existing certificate matters; do not assume a paid tier is required or that every tier accepts it. The default CloudFront preview needs no imported certificate.
# Current production hosting

Production is the static Nginx deployment on the existing EC2 server. Use `npm run deploy:production`; see [EC2 deployment and rollback](deployment/EC2.md). The CloudFront instructions below apply to the separate preview and remain available as an alternative deployment target.
