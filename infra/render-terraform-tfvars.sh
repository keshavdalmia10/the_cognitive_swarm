#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./infra/render-terraform-tfvars.sh <staging|prod> <output-path>

Required environment variables:
  GOOGLE_CLOUD_PROJECT

Optional environment variables:
  REGION
  GITHUB_REPO
  TF_ARTIFACT_REGISTRY_REPOSITORY_ID
  TF_IMAGE
  TF_INJECT_GEMINI_SECRET
  TF_CREATE_FIRESTORE_DATABASE
  TF_SERVICE_NAME
  TF_MIN_INSTANCES
  TF_MAX_INSTANCES
  TF_REDIS_TIER
  TF_REDIS_MEMORY_GB
  TF_BOOTSTRAP_TERRAFORM_CI
EOF
}

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

if [[ -z "${GOOGLE_CLOUD_PROJECT:-}" ]]; then
  echo "Error: GOOGLE_CLOUD_PROJECT is required." >&2
  exit 1
fi

terraform_env="$1"
output_path="$2"

case "$terraform_env" in
  staging)
    default_service_name="cognitive-swarm-staging"
    default_min_instances="1"
    default_max_instances="10"
    default_redis_tier="BASIC"
    default_redis_memory_gb="1"
    default_create_firestore_database="true"
    default_bootstrap_terraform_ci="true"
    ;;
  prod)
    default_service_name="cognitive-swarm-prod"
    default_min_instances="2"
    default_max_instances="20"
    default_redis_tier="STANDARD_HA"
    default_redis_memory_gb="5"
    default_create_firestore_database="false"
    default_bootstrap_terraform_ci="false"
    ;;
  *)
    echo "Error: unsupported environment '$terraform_env'." >&2
    exit 1
    ;;
esac

region="${REGION:-us-central1}"
github_repo="${GITHUB_REPO:-$(git config --get remote.origin.url | sed -n 's#.*/\(.*\)/\(.*\)\.git#\1/\2#p' || true)}"
artifact_registry_repository_id="${TF_ARTIFACT_REGISTRY_REPOSITORY_ID:-cognitive-swarm}"
service_name="${TF_SERVICE_NAME:-$default_service_name}"
image="${TF_IMAGE:-${region}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/${artifact_registry_repository_id}/the-cognitive-swarm:bootstrap}"
inject_gemini_secret="${TF_INJECT_GEMINI_SECRET:-true}"
create_firestore_database="${TF_CREATE_FIRESTORE_DATABASE:-$default_create_firestore_database}"
min_instances="${TF_MIN_INSTANCES:-$default_min_instances}"
max_instances="${TF_MAX_INSTANCES:-$default_max_instances}"
redis_tier="${TF_REDIS_TIER:-$default_redis_tier}"
redis_memory_gb="${TF_REDIS_MEMORY_GB:-$default_redis_memory_gb}"
bootstrap_terraform_ci="${TF_BOOTSTRAP_TERRAFORM_CI:-$default_bootstrap_terraform_ci}"

mkdir -p "$(dirname "$output_path")"

cat > "$output_path" <<EOF
project_id                      = "${GOOGLE_CLOUD_PROJECT}"
environment                     = "${terraform_env}"
region                          = "${region}"
github_repository               = "${github_repo}"
service_name                    = "${service_name}"
artifact_registry_repository_id = "${artifact_registry_repository_id}"
image                           = "${image}"
inject_gemini_secret            = ${inject_gemini_secret}
create_firestore_database       = ${create_firestore_database}
min_instances                   = ${min_instances}
max_instances                   = ${max_instances}
redis_tier                      = "${redis_tier}"
redis_memory_gb                 = ${redis_memory_gb}
bootstrap_terraform_ci          = ${bootstrap_terraform_ci}
EOF
