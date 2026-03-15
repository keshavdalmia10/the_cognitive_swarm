variable "project_id" {
  type        = string
  description = "Google Cloud project ID."
}

variable "region" {
  type        = string
  description = "Primary deployment region."
  default     = "us-central1"
}

variable "environment" {
  type        = string
  description = "Environment name such as staging or prod."
}

variable "name" {
  type        = string
  description = "Base application name."
  default     = "cognitive-swarm"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name override."
  default     = null
}

variable "artifact_registry_repository_id" {
  type        = string
  description = "Artifact Registry repository ID."
  default     = "cognitive-swarm"
}

variable "image" {
  type        = string
  description = "Container image to deploy initially."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "github_repository" {
  type        = string
  description = "GitHub repository in owner/name form."
}

variable "github_branch" {
  type        = string
  description = "GitHub branch allowed to use the deploy workload identity provider."
  default     = "main"
}

variable "gemini_secret_id" {
  type        = string
  description = "Secret Manager secret ID for the Gemini API key."
  default     = "gemini-api-key"
}

variable "inject_gemini_secret" {
  type        = bool
  description = "Whether Cloud Run should read GEMINI_API_KEY from Secret Manager."
  default     = false
}

variable "gemini_api_key_value" {
  type        = string
  description = "Optional bootstrap Gemini API key. Leave empty to manage the secret version outside Terraform."
  default     = ""
  sensitive   = true
}

variable "container_port" {
  type        = number
  description = "Container listening port."
  default     = 8080
}

variable "min_instances" {
  type        = number
  description = "Minimum Cloud Run instances."
  default     = 1
}

variable "max_instances" {
  type        = number
  description = "Maximum Cloud Run instances."
  default     = 10
}

variable "concurrency" {
  type        = number
  description = "Cloud Run request concurrency."
  default     = 20
}

variable "cpu" {
  type        = string
  description = "Cloud Run CPU limit."
  default     = "2"
}

variable "memory" {
  type        = string
  description = "Cloud Run memory limit."
  default     = "2Gi"
}

variable "redis_tier" {
  type        = string
  description = "Memorystore Redis tier."
  default     = "BASIC"
}

variable "redis_memory_gb" {
  type        = number
  description = "Memorystore Redis memory allocation."
  default     = 1
}

variable "vpc_connector_cidr" {
  type        = string
  description = "CIDR range reserved for the serverless VPC connector."
  default     = "10.8.0.0/28"
}

variable "firestore_collection" {
  type        = string
  description = "Firestore collection used for room durability."
  default     = "cognitive_swarm_sessions"
}

variable "create_firestore_database" {
  type        = bool
  description = "Create the default Firestore database when bootstrapping a new project."
  default     = false
}

variable "firestore_location" {
  type        = string
  description = "Firestore location for new projects."
  default     = "nam5"
}

variable "create_public_invoker" {
  type        = bool
  description = "Allow unauthenticated web access to the Cloud Run service."
  default     = true
}

variable "labels" {
  type        = map(string)
  description = "Additional labels for GCP resources."
  default     = {}
}

variable "env_vars" {
  type        = map(string)
  description = "Additional environment variables injected into Cloud Run."
  default     = {}
}

variable "bootstrap_terraform_ci" {
  type        = bool
  description = "Create the Terraform CI service account and grant it project roles."
  default     = false
}
