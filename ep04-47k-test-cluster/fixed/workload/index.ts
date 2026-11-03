// Ping Larry ep04, guardrail 3: GPU node pools that end.
//
// The GPU pool autoscales with a minimum of ZERO. When the last GPU pod is gone, the cluster autoscaler removes the
// idle nodes (after its scale-down delay, 10 minutes by default), and the pool costs nothing until the next job.
// A taint keeps everything except GPU workloads off it, so a stray pod can't hold a GPU node up.
//
// Also: if you restrict VM sizes with Azure Policy, test it against a node pool. The built-in "Allowed virtual
// machine size SKUs" policy evaluates Microsoft.Compute/virtualMachines only, and AKS node pools are scale sets.

import * as pulumi from "@pulumi/pulumi";
import * as azure_native from "@pulumi/azure-native";

const config = new pulumi.Config();
const location = config.require("location");
const gpuVmSize = config.require("gpuVmSize");
const gpuMaxCount = config.requireNumber("gpuMaxCount");

const rg = new azure_native.resources.ResourceGroup("rg-gpu", { location });

const cluster = new azure_native.containerservice.ManagedCluster("aks-gpu", {
    resourceGroupName: rg.name,
    location,
    dnsPrefix: "aks-gpu",
    identity: { type: azure_native.containerservice.ResourceIdentityType.SystemAssigned },
    agentPoolProfiles: [{
        name: "system",
        mode: azure_native.containerservice.AgentPoolMode.System,
        vmSize: "Standard_D2s_v5",
        count: 1,
        osType: azure_native.containerservice.OSType.Linux,
    }],
    autoScalerProfile: {
        scaleDownUnneededTime: "10m",   // how long a node sits idle before it's removed (the default)
    },
});

new azure_native.containerservice.AgentPool("gpu", {
    resourceGroupName: rg.name,
    resourceName: cluster.name,
    agentPoolName: "gpu",
    mode: azure_native.containerservice.AgentPoolMode.User,
    vmSize: gpuVmSize,
    osType: azure_native.containerservice.OSType.Linux,
    enableAutoScaling: true,
    minCount: 0,          // an idle pool scales down to nothing
    maxCount: gpuMaxCount,
    count: 0,             // start empty; the autoscaler adds nodes when a GPU pod is pending
    nodeTaints: ["sku=gpu:NoSchedule"],
    nodeLabels: { workload: "gpu" },
}, { ignoreChanges: ["count"] }); // the autoscaler owns the count

export const clusterName = cluster.name;
export const resourceGroupName = rg.name;
