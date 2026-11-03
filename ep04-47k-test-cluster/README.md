# ep04: The $47,000 Test Cluster

📺 Video: [VIDEO: link when published]
📘 Articles: [The Complete Guide to Building an Enterprise Landing Zone](https://larryjameshenry.com/posts/azure-landing-zone-guide/) · [Cost Governance in the Landing Zone](https://larryjameshenry.com/posts/azure-landing-zone-costs/)
**Pillar:** Cost & scale · **Stack:** Pulumi TypeScript (`azure-native`)

## The incident (composite)

A nonprofit's Azure invoice had one line item for $47,287. A developer with a leftover "Azure subscription creator" billing role had created a subscription on a Saturday night to fine-tune a model. New subscriptions land in the **tenant root management group**, above every policy and budget the platform team had built. He added an AKS node pool of three `Standard_ND96amsr_A100_v4` nodes (24 A100 GPUs, $98.31 an hour). The test took 40 minutes and cost $65.54. Then `kubectl delete` removed the pods, but not the nodes: a fixed-count pool keeps its nodes no matter what's scheduled. They ran idle for 23 days. Pay-as-you-go has no spending limit, budgets only alert, and the subscription had none. Anomaly alerts only email people who have an alert rule. Even the built-in "Allowed virtual machine size SKUs" policy only checks `Microsoft.Compute/virtualMachines`, and AKS node pools are scale sets.

## What's broken (`broken/`)

| File | Problem |
|---|---|
| [`index.ts`](broken/index.ts) | A GPU user pool with a **fixed `count: 3`** and no autoscaler. Delete every pod and the three nodes keep running and billing. |
| *(missing)* | No default management group, so new subscriptions land in the root. No budget that can see them. |

> **Cost warning:** `gpuVmSize` defaults to `Standard_D2s_v5` so this example is cheap. Don't set it to an ND-series SKU.

## The fix (`fixed/`)

Two projects, because the guardrails live at different scopes:

**[`platform/`](fixed/platform/index.ts): tenant and billing guardrails**

1. **No subscription outside the tree.** `management.HierarchySetting` on the root group (its ID is the tenant ID) sets the **default management group** to `mg-sandbox`, so new subscriptions land under the sandbox's policies and budget. It also sets `requireAuthorizationForGroupCreation`. Separately: remove "Azure subscription creator" billing-role assignments when the project that needed them ends.
2. **Budgets that see everything.** On a Microsoft Customer Agreement, management-group budgets aren't supported, so the budget goes on the **invoice section**: every subscription created under it is included, vended or not. Set `invoiceSectionId` to enable it. Each subscription also gets its own budget (forecast and actual thresholds, paging an action group) and a daily **cost anomaly alert rule** (`ScheduledActionByScope`, kind `InsightAlert`). Alerts don't stop anything: cost data lands 8–24 hours late and budgets evaluate about daily. They shorten the meter.

**[`workload/`](fixed/workload/index.ts): GPU node pools that end**

3. The GPU pool has `enableAutoScaling: true`, **`minCount: 0`** and a `maxCount`. When the last GPU pod is gone, the cluster autoscaler removes the idle nodes after its scale-down delay (10 minutes by default). A `sku=gpu:NoSchedule` taint keeps other pods off so they can't hold a GPU node up. `count` is ignored after creation because the autoscaler owns it. If you restrict VM sizes with policy, **test the policy against a node pool**, not just a VM.

### Try it

```bash
cd fixed/workload
npm ci && pulumi stack init dev && pulumi up

cd ../platform
npm ci && pulumi stack init dev
pulumi config set alertEmail you@example.org
pulumi config set invoiceSectionId /providers/Microsoft.Billing/billingAccounts/<id>/billingProfiles/<id>/invoiceSections/<id>  # optional
pulumi up      # changes the TENANT's default management group: use a sandbox tenant, or read it twice
```

The platform project needs write access on the root management group for the hierarchy setting, and billing access for the invoice-section budget.

## Clean up

`pulumi destroy` in each folder. Destroying the hierarchy setting puts the tenant back on its previous default.
