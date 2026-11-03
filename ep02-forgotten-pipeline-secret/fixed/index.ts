// Ping Larry ep02, "How One Forgotten Pipeline Secret Deleted Production": the FIXED setup.
//
// Guardrail 1, have no secret to leak: the workflow signs in with OpenID Connect through a federated credential that
//   only a run in this repo's `production` environment can use. Nothing to paste, commit or forget (workflows/deploy.yml).
// Guardrail 2, shrink the blast radius: Contributor on the one resource group it deploys, a CanNotDelete lock,
//   and no shared keys on storage.
// Guardrail 3, keep the evidence: blob read/write/delete logs and the subscription Activity Log in Log Analytics,
//   kept past the Activity Log's 90 days.
//
// Note: the CanNotDelete lock also stops `pulumi destroy`. Remove the lock first when you clean up a test stack.

import * as pulumi from "@pulumi/pulumi";
import * as azuread from "@pulumi/azuread";
import * as azure_native from "@pulumi/azure-native";

const config = new pulumi.Config();
const location = config.require("location");
const githubRepo = config.require("githubRepo");
const retentionInDays = config.requireNumber("logRetentionDays");
const client = azure_native.authorization.getClientConfigOutput();
const CONTRIBUTOR = "b24988ac-6180-42a0-ab88-20f7382dd24c";

// 1. No secret: the identity trusts GitHub's OIDC tokens for one repo + environment.
const app = new azuread.Application("sp-portal-deploy", { displayName: "sp-portal-deploy" });
const sp = new azuread.ServicePrincipal("sp-portal-deploy", { clientId: app.clientId });
new azuread.ApplicationFederatedIdentityCredential("github-production", {
    applicationId: app.id,
    displayName: "github-production",
    issuer: "https://token.actions.githubusercontent.com",
    subject: `repo:${githubRepo}:environment:production`,
    audiences: ["api://AzureADTokenExchange"],
});

// 2. The blast radius: one resource group, which nobody can delete in one step.
const rg = new azure_native.resources.ResourceGroup("rg-portal-prod", { location });
new azure_native.authorization.RoleAssignment("deploy-contributor", {
    principalId: sp.objectId,
    principalType: azure_native.authorization.PrincipalType.ServicePrincipal,
    roleDefinitionId: pulumi.interpolate`/subscriptions/${client.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${CONTRIBUTOR}`,
    scope: rg.id,
});
new azure_native.authorization.ManagementLockAtResourceGroupLevel("no-delete", {
    resourceGroupName: rg.name,
    lockName: "no-delete",
    level: azure_native.authorization.LockLevel.CanNotDelete,
    notes: "Production changes through the pipeline only.",
});

const account = new azure_native.storage.StorageAccount("stclinicaldocs", {
    resourceGroupName: rg.name,
    location,
    kind: azure_native.storage.Kind.StorageV2,
    sku: { name: azure_native.storage.SkuName.Standard_LRS },
    minimumTlsVersion: azure_native.storage.MinimumTlsVersion.TLS1_2,
    allowBlobPublicAccess: false,
    allowSharedKeyAccess: false, // listKeys gets you nothing: access is Entra ID + RBAC only
});
new azure_native.storage.BlobContainer("intake", {
    resourceGroupName: rg.name,
    accountName: account.name,
    containerName: "intake",
});

// 3. The evidence.
const workspace = new azure_native.operationalinsights.Workspace("log-portal-audit", {
    resourceGroupName: rg.name,
    location,
    sku: { name: azure_native.operationalinsights.WorkspaceSkuNameEnum.PerGB2018 },
    retentionInDays,
});

new azure_native.monitor.DiagnosticSetting("blob-audit", {
    name: "blob-audit",
    resourceUri: pulumi.interpolate`${account.id}/blobServices/default`,
    workspaceId: workspace.id,
    logs: ["StorageRead", "StorageWrite", "StorageDelete"].map((category) => ({ category, enabled: true })),
});

new azure_native.monitor.SubscriptionDiagnosticSetting("activity-log", {
    name: "activity-log-to-workspace",
    workspaceId: workspace.id,
    logs: ["Administrative", "Security", "Policy", "Alert"].map((category) => ({ category, enabled: true })),
});

export const clientId = app.clientId;   // a public identifier, not a secret: goes in a GitHub variable
export const tenantId = client.tenantId;
export const subscriptionId = client.subscriptionId;
export const workspaceName = workspace.name;
