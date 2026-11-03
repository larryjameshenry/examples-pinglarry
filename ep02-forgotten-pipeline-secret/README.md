# ep02: How One Forgotten Pipeline Secret Deleted Production

📺 Video: [VIDEO: link when published]
📘 Article: [Identity and Access Architecture: Entra ID, RBAC, and PIM](https://larryjameshenry.com/posts/azure-identity-architecture/)
**Pillar:** Identity & security · **Stack:** Pulumi TypeScript (`azure-native`, `azuread`), GitHub Actions

## The incident (composite)

On a Tuesday afternoon a healthcare company's patient portal started deleting itself: 41 production resources in 14 minutes. The caller in the Activity Log was a service principal, `sp-portal-deploy`, made for a pipeline that had been retired months earlier. Its client secret was valid for two years and had once been pasted into a `.env` file and committed. The fix commit removed it from the file, but not from Git history. The identity had Contributor on the entire subscription. Two days before the deletions, it had listed the storage account keys, and with no diagnostic settings on blob storage, nobody could say what it read.

## What's broken (`broken/`)

| File | Problem |
|---|---|
| [`index.ts`](broken/index.ts) | A client secret (`ApplicationPassword`) valid for two years. Contributor at **subscription** scope. A storage account that still accepts **shared keys**. **No diagnostic settings** on blob storage. |
| [`workflows/deploy.yml`](broken/workflows/deploy.yml) | `azure/login` with `creds:`, a long-lived secret stored in GitHub that works from anywhere for anyone holding a copy. |

## The fix (`fixed/`)

**1. Have no secret to leak.** [`index.ts`](fixed/index.ts) gives the app a **federated identity credential** that trusts GitHub's OIDC tokens for one repo and the `production` environment only. [`workflows/deploy.yml`](fixed/workflows/deploy.yml) signs in with `client-id`, `tenant-id` and `subscription-id` (identifiers, not secrets) and `permissions: id-token: write`. There's nothing to paste, commit or forget.

**2. Shrink the blast radius.** Contributor on the **one resource group** the pipeline deploys, a `CanNotDelete` lock on it, and `allowSharedKeyAccess: false` on the storage account, so `listKeys` gets you nothing.

**3. Keep the evidence.** Blob `StorageRead` / `StorageWrite` / `StorageDelete` logs and the subscription Activity Log go to a Log Analytics workspace with 365-day retention, past the Activity Log's own 90 days.

**Plus:** [`workflows/secret-scan.yml`](fixed/workflows/secret-scan.yml) runs Gitleaks over the **whole** Git history (`fetch-depth: 0`). A secret removed by a later commit is still found. If one turns up, rotating it (better, deleting the credential) comes before any cleanup commit.

### Try it

```bash
cd fixed
npm ci
pulumi stack init dev
pulumi config set githubRepo <owner>/<repo>
pulumi up
```

Put the stack outputs `clientId`, `tenantId` and `subscriptionId` into the repository **variables** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID`.

## Clean up

The `CanNotDelete` lock also stops `pulumi destroy`. Remove it first:

```bash
az lock delete --name no-delete --resource-group <rg-portal-prod name from `pulumi stack output`>
pulumi destroy
```

In `broken/`, `pulumi destroy` also deletes the client secret. If you copied it anywhere, it stops working when the secret is deleted.
