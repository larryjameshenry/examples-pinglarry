# Ping Larry: episode examples

The code from the [Ping Larry](https://www.youtube.com/@PingLarry) YouTube channel: forensic post-mortems of cloud incidents (Azure first), each ending in three guardrails you can copy into your own pipelines and infrastructure.

Every episode folder has:

- **`broken/`**: the setup the incident grew out of, small enough to deploy to a sandbox and watch the failure happen.
- **`fixed/`**: the same thing with the episode's guardrails applied.
- **`README.md`**: the incident in brief, what's wrong in `broken/`, what each guardrail in `fixed/` changes, and how to try it.

| Episode | Pillar | The bug | The fix | Stack |
|---|---|---|---|---|
| [ep01: The Hotfix That Became Permanent](ep01-hotfix-became-permanent/) | IaC & drift | A 2 AM portal firewall rule survives 181 green deploys, because `pulumi preview` and `pulumi up` don't refresh by default | Daily `preview --refresh --expect-no-changes`, PIM break glass with pipeline-only state writes, revert by default with an expiring-hotfix policy pack | Pulumi TypeScript, GitHub Actions |
| [ep02: How One Forgotten Pipeline Secret Deleted Production](ep02-forgotten-pipeline-secret/) | Identity & security | A deploy service principal with a two-year client secret, Contributor on the whole subscription, and no storage audit logs | OIDC federated credentials (no secret), a resource-group-scoped role and a delete lock, blob audit logs kept past 90 days, a history-wide secret scan | Pulumi TypeScript, GitHub Actions |
| [ep03: The Security Stage That Never Ran](ep03-security-stage-never-ran/) | Pipelines & supply chain | A compile-time `${{ if }}` on a variable-group variable deletes the security scan stage from every run | Runtime `condition:` with explicit `dependsOn`, a Required template check on an `extends` template, a pre-merge check of the expanded YAML | Azure DevOps YAML |
| [ep04: The $47,000 Test Cluster](ep04-47k-test-cluster/) | Cost & scale | A GPU node pool with a fixed count runs idle for 23 days in a subscription outside the management group tree | A default management group for new subscriptions, invoice-section and subscription budgets with anomaly alerts, a GPU pool that scales to zero | Pulumi TypeScript |

## Using the examples

Each Pulumi project is self-contained, with its own `package.json` and lockfile. You'll need Node.js 22+, the [Pulumi CLI](https://www.pulumi.com/docs/iac/download-install/), the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), and a **sandbox** subscription.

```bash
cd ep01-hotfix-became-permanent/broken
npm ci
az login
pulumi login --local          # or your own backend
pulumi stack init dev
pulumi up
```

The files under `workflows/` are GitHub Actions workflows; copy them into your repository's `.github/workflows/` to run them. The Azure DevOps pipelines in ep03 go into a pipeline definition in your Azure DevOps project.

## Before you deploy anything

- **Use a sandbox subscription.** Some examples change tenant-level settings (ep04's default management group) or create role assignments. Read the code first.
- **Costs.** The examples default to cheap SKUs. The incidents didn't: ep04's real node pool cost $98.31 an hour. Don't swap the defaults for the real SKUs to "see it for real".
- **Clean up** with `pulumi destroy` when you're done. Where an example adds a delete lock (ep02), remove the lock first.
- **The scenarios are composites.** Company names, people, dates and counts are invented. Every platform behavior, limit and price shown in the videos is real and sourced in the video description. IP addresses are from the documentation ranges (RFC 5737), and any credential-looking value is fake.

## License

[MIT](LICENSE). Copy the guardrails into your own code; that's what they're for.
