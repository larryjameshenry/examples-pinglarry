#!/usr/bin/env bash
# Ping Larry ep01: the 2 AM hotfix, done the way the on-call engineer did it: straight to Azure, outside Pulumi.
# (The portal and this command make the same change.) Run it after `pulumi up` in this folder, then compare:
#   pulumi preview             -> no changes  (code and state agree; nobody looked at Azure)
#   pulumi preview --refresh   -> 1 to update (the rule that's really running)
#
# Needs the Azure CLI (the azure-firewall extension installs itself on first use) and the Pulumi CLI.
set -euo pipefail

RG=$(pulumi stack output resourceGroupName)
POLICY=$(pulumi stack output firewallPolicyName)
RCG=$(pulumi stack output ruleCollectionGroupName)
FIREWALL_IP=$(pulumi config get firewallPublicIp 2>/dev/null || echo 192.0.2.10)

az network firewall policy rule-collection-group collection rule add \
  --resource-group "$RG" \
  --policy-name "$POLICY" \
  --rcg-name "$RCG" \
  --collection-name vendor-dnat \
  --name tmp-vendor-hotfix \
  --rule-type NatRule \
  --source-addresses 198.51.100.0/24 \
  --destination-addresses "$FIREWALL_IP" \
  --destination-ports 1433 \
  --ip-protocols TCP \
  --translated-address 10.20.4.10 \
  --translated-port 1433 \
  --output none

echo "Added tmp-vendor-hotfix: 198.51.100.0/24 -> $FIREWALL_IP:1433 -> 10.20.4.10:1433 (no pull request)."
echo "Now run: pulumi preview   and then: pulumi preview --refresh"
