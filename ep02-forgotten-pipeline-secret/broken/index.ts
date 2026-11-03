// Ping Larry ep02, "How One Forgotten Pipeline Secret Deleted Production": the BROKEN setup.
//
// Every piece here is common, and together they're the incident:
//   1. a deploy service principal that signs in with a CLIENT SECRET, valid for two years, stored as a GitHub secret
//      (workflows/deploy.yml) and, one bad day, pasted into a .env file and committed;
//   2. Contributor on the ENTIRE subscription "because the pipeline kept failing on permissions";
//   3. a storage account that still accepts shared keys, so a Contributor can list the keys and read every blob;
//   4. no diagnostic settings on blob storage: no record of what was read.
// When the pipeline was retired, the identity wasn't. Nobody owned it.

import * as pulumi from "@pulumi/pulumi";
import * as azuread from "@pulumi/azuread";
import * as azure_native from "@pulumi/azure-native";

const config = new pulumi.Config();
const location = config.require("location");
const client = azure_native.authorization.getClientConfigOutput();
const CONTRIBUTOR = "b24988ac-6180-42a0-ab88-20f7382dd24c";

// 1. A secret-based identity for the pipeline.
const app = new azuread.Application("sp-portal-deploy", { displayName: "sp-portal-deploy" });
const sp = new azuread.ServicePrincipal("sp-portal-deploy", { clientId: app.clientId });
const secret = new azuread.ApplicationPassword("sp-portal-deploy-secret", {
    applicationId: app.id,
    displayName: "github-actions",
    endDate: config.require("secretEndDate"), // two years: the longest the portal allows
});

// 2. Contributor on the whole subscription, not the resource group it deploys.
new azure_native.authorization.RoleAssignment("deploy-contributor", {
    principalId: sp.objectId,
    principalType: azure_native.authorization.PrincipalType.ServicePrincipal,
    roleDefinitionId: pulumi.interpolate`/subscriptions/${client.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${CONTRIBUTOR}`,
    scope: pulumi.interpolate`/subscriptions/${client.subscriptionId}`,
});

// 3 + 4. The patient documents: shared keys allowed (the default), and no diagnostic settings at all.
const rg = new azure_native.resources.ResourceGroup("rg-portal-prod", { location });
const account = new azure_native.storage.StorageAccount("stclinicaldocs", {
    resourceGroupName: rg.name,
    location,
    kind: azure_native.storage.Kind.StorageV2,
    sku: { name: azure_native.storage.SkuName.Standard_LRS },
    minimumTlsVersion: azure_native.storage.MinimumTlsVersion.TLS1_2,
    allowBlobPublicAccess: false,
    // allowSharedKeyAccess not set: shared keys work, so `listKeys` opens every blob
});
new azure_native.storage.BlobContainer("intake", {
    resourceGroupName: rg.name,
    accountName: account.name,
    containerName: "intake",
});

// The secret leaves Pulumi to be pasted into GitHub (and, later, into a .env file).
export const clientId = app.clientId;
export const clientSecret = pulumi.secret(secret.value);
export const storageAccountName = account.name;
