// Ping Larry ep04, "The $47,000 Test Cluster": the BROKEN cluster.
//
// A developer's test: an AKS cluster with a GPU user pool of three nodes, a FIXED count, no autoscaler.
// The job finished in 40 minutes; `kubectl delete` removed the pods. The node pool doesn't care about pods:
// with a fixed count it keeps three nodes running, and billing, for 23 days, until someone deletes the pool.
//
// What made it worse isn't in this code, because it's what was missing (see fixed/platform):
//   - the subscription was created with a billing role and landed in the tenant root management group,
//     above every policy and budget the platform team had;
//   - no budget could see it.
//
// WARNING: the default VM size is cheap on purpose. Don't set gpuVmSize to an ND-series SKU to "see it for real".

import * as pulumi from "@pulumi/pulumi";
import * as azure_native from "@pulumi/azure-native";

const config = new pulumi.Config();
const location = config.require("location");
const gpuVmSize = config.require("gpuVmSize");
const gpuNodeCount = config.requireNumber("gpuNodeCount");

const rg = new azure_native.resources.ResourceGroup("rg-test-gpu", { location });

const cluster = new azure_native.containerservice.ManagedCluster("aks-test", {
    resourceGroupName: rg.name,
    location,
    dnsPrefix: "aks-test",
    identity: { type: azure_native.containerservice.ResourceIdentityType.SystemAssigned },
    agentPoolProfiles: [{
        name: "system",
        mode: azure_native.containerservice.AgentPoolMode.System,
        vmSize: "Standard_D2s_v5",
        count: 1,
        osType: azure_native.containerservice.OSType.Linux,
    }],
});

// The bug: a fixed count. Three nodes, whether anything is scheduled on them or not.
new azure_native.containerservice.AgentPool("gpu", {
    resourceGroupName: rg.name,
    resourceName: cluster.name,
    agentPoolName: "gpu",
    mode: azure_native.containerservice.AgentPoolMode.User,
    vmSize: gpuVmSize,
    count: gpuNodeCount,
    osType: azure_native.containerservice.OSType.Linux,
});

export const clusterName = cluster.name;
export const resourceGroupName = rg.name;
