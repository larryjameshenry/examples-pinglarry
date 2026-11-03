# ep03: The Security Stage That Never Ran

📺 Video: [VIDEO: link when published]
📘 Articles: [Debugging Silent Pipeline Failures](https://larryjameshenry.com/posts/debugging-silent-pipeline-failures/) · [The Ultimate Guide to Azure DevOps YAML Expressions](https://larryjameshenry.com/posts/ultimate-guide-yaml-expressions/)
**Pillar:** Pipelines & supply chain · **Stack:** Azure DevOps YAML pipelines

## The incident (composite)

An insurance carrier's auditors asked for the vulnerability scan logs from 25 production releases. Azure DevOps showed 512 deployments since March, every one green: no failed stage, not even a gray "Skipped" icon. There were no scan logs. Six months earlier, one commit had gated the scan stage with a **compile-time** `${{ if }}` on a variable from a Library variable group. Variable groups aren't loaded at compile time, so the expression saw an empty string, evaluated to false, and Azure Pipelines removed the stage from the pipeline before any agent started. Two weeks later a shared template spread the same mistake to 14 services by passing `$(isProduction)` as a template parameter. At compile time that's the literal text `$(isProduction)`, never `true`.

## Three syntaxes, three clocks

| Syntax | Evaluated | Sees variable groups? |
|---|---|---|
| `${{ variables.x }}` template expression | compile time, when the run is expanded | **no**: empty string |
| `$[ variables.x ]` runtime expression, `condition:` | when the stage or job is planned | yes |
| `$(x)` macro | on the agent, just before each task | yes, but at compile time it's still the literal text `$(x)` |

## What's broken (`broken/`)

| File | Problem |
|---|---|
| [`azure-pipelines.yml`](broken/azure-pipelines.yml) | `- ${{ if eq(variables.isProduction, 'true') }}:` around the `SecurityScan` stage, with `isProduction` from the variable group `vg-release-config`. The stage is never in the plan. `DeployProd` has no `dependsOn`, so it happily follows `Build`. The debug step printing `isProduction is true` proves nothing about compile time. |
| [`azure-pipelines.shared-template.yml`](broken/azure-pipelines.shared-template.yml) + [`templates/release-stages.yml`](broken/templates/release-stages.yml) | The shared-template version: `runSecurityScan: $(isProduction)` hands a runtime macro to a compile-time parameter, and `${{ if eq(parameters.runSecurityScan, 'true') }}` is false for every service. |

## The fix (`fixed/`)

**1. Gate at runtime, and name your dependencies.** In [`templates/secure-release.yml`](fixed/templates/secure-release.yml), `SecurityScan` is always in the plan, with `condition: and(succeeded(), eq(variables['isProduction'], 'true'))`, evaluated after the variable group is loaded. Outside production it shows as **Skipped**, visibly. `DeployProd` has `dependsOn: [Build, SecurityScan]` and `condition: and(succeeded('Build'), succeeded('SecurityScan'))`: a skipped or failed scan blocks the deploy, and if anyone removes the scan stage again, the pipeline **fails to compile** instead of deploying without it.

**2. Make the template mandatory.** The service pipeline ([`azure-pipelines.yml`](fixed/azure-pipelines.yml)) defines no stages of its own: it `extends` the release template. Then, in Azure DevOps:

1. **Pipelines > Environments > aks-claims-prod > Approvals and checks > + > Required template.**
2. Repository: the repo that holds `secure-release.yml` (ideally its own protected repo, such as `Platform/security-templates`). Ref: `refs/heads/main`. Path: the template.
3. Add the same check to the production ACR service connection (**Project settings > Service connections**).

Any run that doesn't extend that template, at that ref, is blocked before its first task touches production.

**3. Verify the expanded YAML before you ship.** [`scripts/assert-stage-in-final-yaml.sh`](fixed/scripts/assert-stage-in-final-yaml.sh) calls the Pipelines **Preview** REST API (`POST .../_apis/pipelines/{id}/preview` with `previewRun: true`). It gets back `finalYaml`, the pipeline exactly as a run would expand it, without running anything, and fails if `SecurityScan` isn't in it. [`pr-check.yml`](fixed/pr-check.yml) runs it on every pull request; add it as a **build validation** policy on `main`. By hand, the pipeline editor's **⋮ > Download full YAML** shows the same expanded file.

Both versions install a pinned Trivy release and verify its checksum ([`templates/install-trivy.yml`](fixed/templates/install-trivy.yml)), instead of piping an install script from `main` into `sh`.

### Prerequisites

- A Library variable group `vg-release-config` with `isProduction = true`.
- A Docker registry service connection `acr-meridian-prod` to your ACR (or change the `containerRegistry` parameter).
- An environment `aks-claims-prod`.
- For `pr-check.yml`: set `releasePipelineId` to your release pipeline's ID. The build service identity needs permission to view and queue that pipeline.
