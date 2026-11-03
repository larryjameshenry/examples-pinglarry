// Ping Larry ep04, guardrails 1 and 2: no subscription outside the tree, and budgets that see everything.
//
// Guardrail 1: by default a new subscription lands in the TENANT ROOT management group, above every policy
// assignment and budget you put on lower groups. The hierarchy setting sends new subscriptions to a sandbox group
// (with its own policies and budget) instead. Needs management group write access at the root.
// Also: remove "Azure subscription creator" billing-role assignments when the project that needed them ends.
//
// Guardrail 2: budgets only alert, and on a Microsoft Customer Agreement, management-group budgets aren't supported.
// So: a budget on the INVOICE SECTION (every subscription created under it is included, vended or not), plus a budget
// and an anomaly alert on each subscription. A forecast alert gives a few days' warning; it doesn't stop anything.
// (Cost data lands 8-24 hours late and budgets evaluate about once a day: alerts shorten the meter, they don't stop it.)

import * as pulumi from "@pulumi/pulumi";
import * as azure_native from "@pulumi/azure-native";

const config = new pulumi.Config();
const location = config.require("location");
const defaultManagementGroup = config.require("defaultManagementGroup");
const invoiceSectionId = config.get("invoiceSectionId");
const amount = config.requireNumber("budgetAmount");
const startDate = config.require("budgetStartDate");
const alertEmail = config.require("alertEmail");

const client = azure_native.authorization.getClientConfigOutput();

// Guardrail 1: new subscriptions land in the sandbox, not the root (the root group's ID is the tenant ID).
new azure_native.management.HierarchySetting("hierarchy", {
    groupId: client.tenantId,
    defaultManagementGroup: `/providers/Microsoft.Management/managementGroups/${defaultManagementGroup}`,
    requireAuthorizationForGroupCreation: true,
});

// Guardrail 2a: a budget on the invoice section sees every subscription billed to it.
// At billing scopes, notifications go to contact emails (action groups work only at subscription / resource group).
if (invoiceSectionId) {
    new azure_native.consumption.Budget("invoice-section", {
        scope: invoiceSectionId,
        budgetName: "invoice-section-monthly",
        amount,
        category: azure_native.consumption.CategoryType.Cost,
        timeGrain: azure_native.consumption.TimeGrainType.Monthly,
        timePeriod: { startDate },
        notifications: {
            forecast100: {
                enabled: true,
                operator: azure_native.consumption.OperatorType.GreaterThan,
                threshold: 100,
                thresholdType: azure_native.consumption.ThresholdType.Forecasted,
                contactEmails: [alertEmail],
            },
        },
    });
}

// Guardrail 2b: on each subscription, a budget that pages an action group, and a daily anomaly alert.
const rg = new azure_native.resources.ResourceGroup("rg-cost-alerts", { location });
const actionGroup = new azure_native.monitor.ActionGroup("ag-cost", {
    resourceGroupName: rg.name,
    location: "global",
    groupShortName: "cost",
    enabled: true,
    emailReceivers: [{ name: "platform", emailAddress: alertEmail, useCommonAlertSchema: true }],
});

new azure_native.consumption.Budget("subscription", {
    scope: pulumi.interpolate`/subscriptions/${client.subscriptionId}`,
    budgetName: "subscription-monthly",
    amount,
    category: azure_native.consumption.CategoryType.Cost,
    timeGrain: azure_native.consumption.TimeGrainType.Monthly,
    timePeriod: { startDate },
    notifications: {
        forecast100: {
            enabled: true,
            operator: azure_native.consumption.OperatorType.GreaterThan,
            threshold: 100,
            thresholdType: azure_native.consumption.ThresholdType.Forecasted,
            contactEmails: [alertEmail],
            contactGroups: [actionGroup.id],
        },
        actual80: {
            enabled: true,
            operator: azure_native.consumption.OperatorType.GreaterThan,
            threshold: 80,
            thresholdType: azure_native.consumption.ThresholdType.Actual,
            contactEmails: [alertEmail],
            contactGroups: [actionGroup.id],
        },
    },
});

// Anomaly detection only emails people who have an alert rule: this is the rule.
new azure_native.costmanagement.ScheduledActionByScope("anomaly-alert", {
    scope: pulumi.interpolate`/subscriptions/${client.subscriptionId}`,
    name: "daily-anomaly-alert",
    kind: azure_native.costmanagement.ScheduledActionKind.InsightAlert,
    displayName: "Daily cost anomaly alert",
    status: azure_native.costmanagement.ScheduledActionStatus.Enabled,
    viewId: pulumi.interpolate`/subscriptions/${client.subscriptionId}/providers/Microsoft.CostManagement/views/ms:DailyAnomalyByResourceGroup`,
    schedule: {
        frequency: azure_native.costmanagement.ScheduleFrequency.Daily,
        startDate,
        endDate: "2027-11-01T00:00:00Z",
    },
    notification: {
        to: [alertEmail],
        subject: "Cost anomaly detected",
    },
});
