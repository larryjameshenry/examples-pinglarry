// Ping Larry ep01, guardrail 3 (revert by default): a hotfix rule lives in code with an expiry, or the preview fails.
//
// A portal hotfix gets two business days to become a pull request that links its incident. In that PR the rule is
// named hotfix-* and its description carries "expires=YYYY-MM-DD". After that date, every preview fails until the rule
// is made permanent through a normal reviewed change (renamed, no expiry) or removed.
//
// Run it:  pulumi preview --policy-pack ./policy   (or `policyPacks: ./policy` in pulumi/actions)

import * as azure_native from "@pulumi/azure-native";
import { PolicyPack, validateResourceOfType } from "@pulumi/policy";

const EXPIRES = /expires=(\d{4}-\d{2}-\d{2})/;

new PolicyPack("hotfix-expiry", {
    policies: [{
        name: "hotfix-rules-expire",
        description: "Firewall rules named hotfix-* need a future expires=YYYY-MM-DD in their description.",
        enforcementLevel: "mandatory",
        validateResource: validateResourceOfType(azure_native.network.FirewallPolicyRuleCollectionGroup, (rcg, args, reportViolation) => {
            for (const collection of rcg.ruleCollections ?? []) {
                const rules: { name?: string; description?: string }[] = (collection as any).rules ?? [];
                for (const rule of rules) {
                    if (!rule.name?.startsWith("hotfix-")) continue;
                    const expires = EXPIRES.exec(rule.description ?? "")?.[1];
                    if (!expires) {
                        reportViolation(`${rule.name}: a hotfix rule needs "expires=YYYY-MM-DD" in its description.`);
                    } else if (new Date(`${expires}T23:59:59Z`) < new Date()) {
                        reportViolation(`${rule.name}: expired on ${expires}. Make it permanent through a reviewed PR, or remove it.`);
                    }
                }
            }
        }),
    }],
});
