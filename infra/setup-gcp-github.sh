#!/usr/bin/env bash
set -e

# Setup Script for The Cognitive Swarm Infrastructure
# This script configures GCP, executes Terraform, and sets up GitHub Secrets/Variables

if [ -z "$1" ]; then
    echo "Usage: ./infra/setup-gcp-github.sh <YOUR_GCP_PROJECT_ID>"
    exit 1
fi

export GOOGLE_CLOUD_PROJECT=$1
export REGION="us-central1"
export GITHUB_REPO="$(git config --get remote.origin.url | sed -n 's#.*/\(.*\)/\(.*\)\.git#\1/\2#p' || echo "keshavdalmia10/the_cognitive_swarm")"

echo "====================================================="
echo "  Setting up Infrastructure for $GOOGLE_CLOUD_PROJECT"
echo "====================================================="

# Check requirements
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI not found. Please install it or run this script in Google Cloud Shell."
    exit 1
fi

if ! command -v terraform &> /dev/null; then
    echo "Error: terraform CLI not found. Please install terraform."
    exit 1
fi

if ! command -v gh &> /dev/null; then
    echo "Warning: gh CLI not found. You will need to set GitHub variables manually."
    GH_CLI_AVAILABLE=false
else
    GH_CLI_AVAILABLE=true
fi

# Ensure user is logged in
gcloud config set project "$GOOGLE_CLOUD_PROJECT"
echo "Authenticating Google Cloud..."

# Enable APIs
echo "Enabling GCP APIs..."
gcloud services enable \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com \
  secretmanager.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  compute.googleapis.com \
  vpcaccess.googleapis.com \
  redis.googleapis.com \
  firestore.googleapis.com

# Create gemini-api-key secret
echo "Checking/Creating gemini-api-key secret..."
gcloud secrets create gemini-api-key --replication-policy="automatic" 2>/dev/null || echo "Secret already exists."

# Attempt reading .env automatically
if [ -f ".env" ]; then
    GEMINI_KEY=$(grep -E "^GEMINI_API_KEY=" .env | cut -d'"' -f2 | cut -d"'" -f2)
    if [ -n "$GEMINI_KEY" ]; then
        echo "Found GEMINI_API_KEY in .env, adding secret version..."
        echo -n "$GEMINI_KEY" | gcloud secrets versions add gemini-api-key --data-file=-
        echo "Secret version added successfully."
    fi
else
    echo "Please paste your GEMINI_API_KEY value:"
    read -rs GEMINI_KEY
    if [ -n "$GEMINI_KEY" ]; then
        echo -n "$GEMINI_KEY" | gcloud secrets versions add gemini-api-key --data-file=-
        echo "Secret version added successfully."
    else
        echo "Warning: No API key provided, skipping secret version update."
    fi
fi

# Create tfvars
echo "Generating terraform variables..."
cat <<EOF > infra/terraform/environments/staging.tfvars
project_id               = "${GOOGLE_CLOUD_PROJECT}"
environment              = "staging"
region                   = "${REGION}"
github_repository        = "${GITHUB_REPO}"
service_name             = "cognitive-swarm-staging"
artifact_registry_repository_id = "cognitive-swarm"
image                    = "${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/cognitive-swarm/the-cognitive-swarm:bootstrap"
inject_gemini_secret     = true
min_instances            = 1
max_instances            = 10
redis_tier               = "BASIC"
redis_memory_gb          = 1
EOF

cat <<EOF > infra/terraform/environments/prod.tfvars
project_id               = "${GOOGLE_CLOUD_PROJECT}"
environment              = "prod"
region                   = "${REGION}"
github_repository        = "${GITHUB_REPO}"
service_name             = "cognitive-swarm-prod"
artifact_registry_repository_id = "cognitive-swarm"
image                    = "${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/cognitive-swarm/the-cognitive-swarm:bootstrap"
inject_gemini_secret     = true
min_instances            = 2
max_instances            = 20
redis_tier               = "STANDARD_HA"
redis_memory_gb          = 5
EOF

# Terraform
echo "Applying terraform for staging environment (required for initial bootstrap & WIF)..."
cd infra/terraform
terraform init
terraform apply -auto-approve -var-file=environments/staging.tfvars

# Wait for services to fully provision
sleep 5

# Set GitHub Vars if GH CLI available
if [ "$GH_CLI_AVAILABLE" = true ]; then
  echo "Setting GitHub Actions Variables and Secrets via Terraform outputs..."
  
  # Expected Variables
  # GCP_PROJECT_ID, GCP_REGION, ARTIFACT_REGISTRY_REPOSITORY, DEPLOY_WIF_PROVIDER, DEPLOY_SERVICE_ACCOUNT
  
  # For staging/prod:
  # CLOUD_RUN_SERVICE_STAGING, RUNTIME_SERVICE_ACCOUNT_STAGING, VPC_CONNECTOR_STAGING, FIRESTORE_COLLECTION, REDIS_HOST_STAGING, REDIS_PORT_STAGING
  # MIN_INSTANCES_STAGING, MAX_INSTANCES_STAGING
  
  gh variable set GCP_PROJECT_ID --body "$GOOGLE_CLOUD_PROJECT"
  gh variable set GCP_REGION --body "$REGION"
  gh variable set ARTIFACT_REGISTRY_REPOSITORY --body "cognitive-swarm"
  gh variable set DEPLOY_WIF_PROVIDER --body "$(terraform output -raw deploy_wif_provider_name)"
  gh variable set DEPLOY_SERVICE_ACCOUNT --body "$(terraform output -raw deploy_service_account_email)"
  gh variable set GEMINI_SECRET_ID --body "gemini-api-key"
  gh variable set FIRESTORE_COLLECTION --body "cognitive_swarm_sessions"
  
  gh variable set CLOUD_RUN_SERVICE_STAGING --body "cognitive-swarm-staging" -e staging
  gh variable set RUNTIME_SERVICE_ACCOUNT_STAGING --body "$(terraform output -raw runtime_service_account_email)" -e staging
  gh variable set VPC_CONNECTOR_STAGING --body "$(terraform output -raw vpc_connector_id)" -e staging
  gh variable set REDIS_HOST_STAGING --body "$(terraform output -raw redis_host)" -e staging
  gh variable set REDIS_PORT_STAGING --body "$(terraform output -raw redis_port)" -e staging
  gh variable set MIN_INSTANCES_STAGING --body "1" -e staging
  gh variable set MAX_INSTANCES_STAGING --body "10" -e staging

  echo "Staging environment variables set successfully in GitHub repository!"
else
  echo -e "\n======================"
  echo "Please set the following GitHub Variables manually:"
  echo "- GCP_PROJECT_ID: $GOOGLE_CLOUD_PROJECT"
  echo "- GCP_REGION: $REGION"
  echo "Terraform deploy outputs are:"
  terraform output
  echo "Map these to your deploy workflows for staging and prod!"
fi

echo "Setup complete! Once variables are in GitHub, you can push to main to trigger the deploy workflow."
