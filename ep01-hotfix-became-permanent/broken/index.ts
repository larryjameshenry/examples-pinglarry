// Ping Larry ep01, "The Hotfix That Became Permanent": the BROKEN setup.
//
// The firewall rules are in code, and that part is fine. What's broken is everything around it:
//   - the pipeline runs `pulumi preview` and `pulumi up` without --refresh (workflows/), so it compares this
//     code with Pulumi's state and never looks at what's actually running in Azure;
//   - humans can still change the policy in the portal (simulate-portal-hotfix.sh does what the on-call engineer did);
//   - nothing records, expires or reverts that change.
// Deploy this, run the hotfix script, then run `pulumi preview`: "no changes". Run `pulumi preview --refresh`: drift.
//
// Addresses are from the documentation ranges (RFC 5737). This deploys a firewall policy, not a firewall.

import * as pulumi from "@pulumi/pulumi";
import * as azure_native from "@pulumi/azure-native";

const config = new pulumi.Config();
const location = config.require("location");
const firewallPublicIp = config.require("firewallPublicIp");

const rg = new azure_native.resources.ResourceGroup("rg-hub", { location });

const policy = new azure_native.network.FirewallPolicy("fwp-hub", {
    resourceGroupName: rg.name,
    location,
    sku: { tier: azure_native.network.FirewallPolicySkuTier.Standard },
});

// The lab vendor reaches the lab results database through the firewall's public IP: exactly two addresses.
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
            sourceAddresses: ["203.0.113.10", "203.0.113.11"],
            destinationAddresses: [firewallPublicIp],
            destinationPorts: ["1433"],
            ipProtocols: [azure_native.network.FirewallPolicyRuleNetworkProtocol.TCP],
            translatedAddress: "10.20.4.10", // sql-labresults in spoke-lab
            translatedPort: "1433",
        }],
    }],
});

export const resourceGroupName = rg.name;
export const firewallPolicyName = policy.name;
export const ruleCollectionGroupName = vendorDnat.name;
