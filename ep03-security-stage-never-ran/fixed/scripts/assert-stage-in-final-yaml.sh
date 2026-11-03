#!/usr/bin/env bash
# Ping Larry ep03, guardrail 3: verify the expanded YAML BEFORE you ship.
#
# Asks Azure DevOps to expand a pipeline exactly as a run would (templates and ${{ }} expressions resolved), without
# running it, using the Pipelines "Preview" REST API (previewRun: true -> finalYaml). Fails if a required stage is
# missing. Run it in a pull request validation pipeline (pr-check.yml) against the PR's branch.
#
# Usage: assert-stage-in-final-yaml.sh <pipelineId> <refName> [stageName]
#   env: SYSTEM_COLLECTIONURI, SYSTEM_TEAMPROJECT (set by Azure Pipelines), SYSTEM_ACCESSTOKEN (map $(System.AccessToken))
# Needs curl and jq. The build service identity needs permission to view (and queue) the pipeline being previewed.
set -euo pipefail

PIPELINE_ID="${1:?pipeline id}"
REF_NAME="${2:?ref name, e.g. refs/heads/feature/x}"
STAGE="${3:-SecurityScan}"
ORG_URL="${SYSTEM_COLLECTIONURI%/}"
PROJECT="${SYSTEM_TEAMPROJECT:?}"

BODY=$(jq -n --arg ref "$REF_NAME" '{previewRun: true, resources: {repositories: {self: {refName: $ref}}}}')

FINAL_YAML=$(curl -sS --fail-with-body \
  -H "Authorization: Bearer ${SYSTEM_ACCESSTOKEN:?}" \
  -H "Content-Type: application/json" \
  -X POST "$ORG_URL/$(jq -rn --arg p "$PROJECT" '$p|@uri')/_apis/pipelines/$PIPELINE_ID/preview?api-version=7.1" \
  -d "$BODY" | jq -r '.finalYaml')

if grep -Eq "^[[:space:]]*-[[:space:]]*stage:[[:space:]]*${STAGE}[[:space:]]*$" <<<"$FINAL_YAML"; then
  echo "OK: stage '$STAGE' is in the expanded pipeline for $REF_NAME."
else
  echo "##vso[task.logissue type=error]Stage '$STAGE' is MISSING from the expanded pipeline for $REF_NAME."
  echo "A compile-time \${{ if }} (or a template parameter) removed it. Expanded stages:"
  grep -E "^[[:space:]]*-[[:space:]]*stage:" <<<"$FINAL_YAML" || true
  exit 1
fi
