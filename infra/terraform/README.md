# Terraform Deployment Notes

This module provisions the GCP foundation for one environment of The Cognitive Swarm:

- Artifact Registry
- Cloud Run service
- Memorystore Redis
- Firestore bootstrap support
- Secret Manager secret for `GEMINI_API_KEY`
- runtime and deployer service accounts
- GitHub Actions Workload Identity Federation
- serverless VPC connector

## Usage

1. Pick an environment tfvars file.
2. Set `project_id`, `github_repository`, and an initial `image`.
3. Apply once to create infra and outputs.
4. Configure the GitHub environment variables from the outputs.
5. Let the deploy workflow build and promote later revisions.

If you do not want Terraform to store the Gemini API key in state, leave `gemini_api_key_value` empty and create a secret version outside Terraform before enabling `inject_gemini_secret = true`.
