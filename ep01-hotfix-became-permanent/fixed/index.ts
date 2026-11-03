// Ping Larry ep01, "The Hotfix That Became Permanent": the FIXED setup.
//
// Guardrail 1, look at Azure every day: workflows/drift.yml (scheduled `preview --refresh --expect-no-changes`).
// Guardrail 2, only the pipeline writes to the hub: PIM-eligible on-call access + pipeline-only state writes (below).
// Guardrail 3, revert by default: hotfix rules live in code with an expiry, enforced by policy/ (CrossGuard),
//   and deploys run with --refresh so untriaged drift is reverted, not built on.
//
// Addresses are from the documentation ranges (RFC 5737). This deploys a firewall policy, not a firewall.

import * as pulumi from "@pulumi/pulumi";
import * as azure_native from "@pulumi/azure-native";

const config = new pulumi.Config();
const location = config.require("location");
const firewallPublicIp = config.require("firewallPublicIp");
const onCallGroupObjectId = config.get("onCallGroupObjectId");
const pipelinePrincipalId = config.get("pipelinePrincipalId");
const stateContainerId = config.get("stateContainerId");

const client = azure_native.authorization.getClientConfigOutput();
const roleId = (guid: string) =>
    pulumi.interpolate`/subscriptions/${client.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${guid}`;
const NETWORK_CONTRIBUTOR = "4d97b98b-1d4f-4787-a291-c67834d212e7";
const STORAGE_BLOB_DATA_CONTRIBUTOR = "ba92f5b4-2d11-453d-a403-e96b0029c9fe";

const rg = new azure_native.resources.ResourceGroup("rg-hub", { location });

const policy = new azure_native.network.FirewallPolicy("fwp-hub", {
    resourceGroupName: rg.name,
    location,
    sku: { tier: azure_native.network.FirewallPolicySkuTier.Standard },
});

// The vendor's two real addresses, confirmed with the vendor, linked to the incident that changed them.
// A temporary rule would be named hotfix-* and carry "expires=YYYY-MM-DD": the policy pack fails it once it's past.
const vendorDnat = new azure_native.network.FirewallPolicyRuleCollectionGroup("rcg-vendor-dnat", {
    resourceGroupName: rg.name,
    firewallPolicyName: policy.name,
    ruleCollectionGroupName: "rcg-vendor-dnat",
    priority: 100,
    ruleCollections: [{
        ruleCollectionType: "FirewallPolicyNatRuleCollection",
        name: "vendor-dnat",
        priority: 100,
        action: { type: azure_native.network.FirewallPolicyNatRuleCollectionActionType.DNAT },
        rules: [{
            ruleType: "NatRule",
            name: "lab-vendor-sql",
            description: "INC-20417 · vendor data center move · PR #88",
            sourceAddresses: ["198.51.100.20", "198.51.100.21"],
            destinationAddresses: [firewallPublicIp],
            destinationPorts: ["1433"],
            ipProtocols: [azure_native.network.FirewallPolicyRuleNetworkProtocol.TCP],
            translatedAddress: "10.20.4.10", // sql-labresults in spoke-lab
            translatedPort: "1433",
        }],
    }],
});

// Guardrail 2a: on-call engineers are ELIGIBLE for Network Contributor on the hub, not standing. They activate it
// during an incident through PIM, with a justification, for a limited time; every activation is logged.
if (onCallGroupObjectId) {
    new azure_native.authorization.PimRoleEligibilitySchedule("oncall-hub-network", {
        principalId: onCallGroupObjectId,
        roleDefinitionId: roleId(NETWORK_CONTRIBUTOR),
        scope: rg.id,
        justification: "Break glass for firewall incidents",
        scheduleInfo: {
            startDateTime: new Date().toISOString().slice(0, 10) + "T00:00:00Z",
            expiration: { type: "AfterDuration", duration: "P365D" },
        },
    }, { ignoreChanges: ["scheduleInfo.startDateTime"] });
}

// Guardrail 2b: only the pipeline's identity can write the stack state, so a laptop can't `pulumi up` production.
// (Disable shared key access on the state storage account, so RBAC is the only way in.)
if (pipelinePrincipalId && stateContainerId) {
    new azure_native.authorization.RoleAssignment("pipeline-state-writer", {
        principalId: pipelinePrincipalId,
        principalType: azure_native.authorization.PrincipalType.ServicePrincipal,
        roleDefinitionId: roleId(STORAGE_BLOB_DATA_CONTRIBUTOR),
        scope: stateContainerId,
    });
}

export const resourceGroupName = rg.name;
export const firewallPolicyName = policy.name;
export const ruleCollectionGroupName = vendorDnat.name;
