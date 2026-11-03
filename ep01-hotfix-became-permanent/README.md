# ep01: The Hotfix That Became Permanent

📺 Video: [VIDEO: link when published]
📘 Articles: [Day-2 Operations: Maintaining and Evolving Your Azure Landing Zone](https://larryjameshenry.com/posts/azure-landing-zone-ops/) · [CI/CD Pipeline for Your Landing Zone](https://larryjameshenry.com/posts/azure-landing-zone-cicd/)
**Pillar:** IaC & drift · **Stack:** Pulumi TypeScript (`azure-native`), GitHub Actions

## The incident (composite)

At 2:10 AM on a Saturday, a lab vendor moved data centers and the firewall started dropping its traffic. The on-call engineer added a DNAT rule in the Azure portal: the vendor's whole new `/24` → the firewall's public IP on port 1433 → the lab results database. The rule was named `tmp-vendor-hotfix`. Nobody opened a pull request.

The pipeline then deployed production 181 times over 254 days. Every run was green, and every run reported no changes to the firewall, because `pulumi preview` and `pulumi up` compare your code with Pulumi's state (its record of the last deployment), not with Azure. Code and state both said "two vendor addresses"; Azure had a `/24`. When audit finally asked who made the change, the Activity Log (90 days), Resource Graph change history (14 days) and the Log Analytics copy (90 days by default) had all expired.

## What's broken (`broken/`)

| File | Problem |
|---|---|
| [`index.ts`](broken/index.ts) | Fine on its own: the vendor DNAT rule in code, two addresses. |
| [`workflows/pr-preview.yml`](broken/workflows/pr-preview.yml), [`workflows/deploy.yml`](broken/workflows/deploy.yml) | `pulumi preview` / `pulumi up` **without `refresh`**: they never read the live firewall policy, so a portal change to it never shows up. |
| [`simulate-portal-hotfix.sh`](broken/simulate-portal-hotfix.sh) | Reproduces the out-of-band hotfix with `az network firewall policy rule-collection-group collection rule add`. |

### See it happen

```bash
cd broken
npm ci && pulumi stack init dev && pulumi up
./simulate-portal-hotfix.sh
pulumi preview             # "no changes": code and state agree, nobody looked at Azure
pulumi preview --refresh   # the drift: the rule that's really running
```

## The fix (`fixed/`)

**1. Look at Azure every day.** [`workflows/drift.yml`](fixed/workflows/drift.yml) runs `pulumi preview` with `refresh: true` and `expect-no-changes: true` every morning. Any drift fails the run and opens a GitHub issue while the Activity Log still knows who made the change. It runs in its own `drift-check` environment with a **read-only** identity (Reader, plus Storage Blob Data Reader on the state), so it needs no approval and can't change anything. PR previews ([`workflows/pr-preview.yml`](fixed/workflows/pr-preview.yml)) refresh too, so reviewers see drift next to the change.

**2. Only the pipeline writes to the hub.** In [`index.ts`](fixed/index.ts), on-call engineers are **eligible** for Network Contributor on the hub through PIM (`PimRoleEligibilitySchedule`), not standing: they activate it during an incident, with a reason, for a limited time, and it's logged. Only the pipeline's identity gets Storage Blob Data Contributor on the state container, so a laptop can't run `pulumi up` against production. Disable shared key access on the state storage account so RBAC is the only way in.

**3. Revert by default.** A portal hotfix gets two business days to become a pull request that links its incident. In that PR the rule is named `hotfix-*` and its description carries `expires=YYYY-MM-DD`. The CrossGuard policy pack in [`policy/`](fixed/policy/index.ts) fails every preview that carries an expired hotfix rule. The deploy ([`workflows/deploy.yml`](fixed/workflows/deploy.yml)) runs with `refresh: true`, so anything changed outside the pipeline and not accepted through a PR is reverted to the code. Never auto-import drift on a schedule: it keeps the plan clean and erases the evidence.

The fixed vendor rule is in code with the vendor's two real addresses and a description that links the incident.

### Try it

```bash
cd fixed
npm ci && (cd policy && npm ci)
pulumi stack init dev
pulumi config set onCallGroupObjectId <entra-group-object-id>      # optional: PIM eligibility
pulumi config set pipelinePrincipalId <pipeline-sp-object-id>      # optional: state RBAC
pulumi config set stateContainerId <state-blob-container-resource-id>
pulumi preview --refresh --policy-pack ./policy
pulumi up
```

### GitHub setup for the workflows

- Repository variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `PULUMI_BACKEND_URL` (for example `azblob://pulumi-state`), `AZURE_STORAGE_ACCOUNT`. Secret: `PULUMI_CONFIG_PASSPHRASE` (or use a Key Vault secrets provider).
- Environments: `production` (required reviewers, prevent self-review, `main` only) with a deploy identity, and `drift-check` with a read-only identity. Give each identity a federated credential whose subject names its environment: `repo:<owner>/<repo>:environment:<name>`.

## Clean up

`pulumi destroy` in each folder you deployed.
