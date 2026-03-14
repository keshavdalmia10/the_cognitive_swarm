output "artifact_registry_repository" {
  value       = google_artifact_registry_repository.app.name
  description = "Artifact Registry repository name."
}

output "cloud_run_service_name" {
  value       = google_cloud_run_v2_service.app.name
  description = "Cloud Run service name."
}

output "cloud_run_service_url" {
  value       = google_cloud_run_v2_service.app.uri
  description = "Cloud Run service URL."
}

output "runtime_service_account_email" {
  value       = google_service_account.runtime.email
  description = "Runtime service account email."
}

output "deploy_service_account_email" {
  value       = google_service_account.deployer.email
  description = "GitHub deploy service account email."
}

output "deploy_workload_identity_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "GitHub Actions workload identity provider resource name."
}

output "redis_host" {
  value       = google_redis_instance.cache.host
  description = "Memorystore host IP for Cloud Run."
}

output "redis_port" {
  value       = google_redis_instance.cache.port
  description = "Memorystore port."
}

output "vpc_connector_name" {
  value       = google_vpc_access_connector.serverless.name
  description = "Serverless VPC connector name."
}

output "gemini_secret_id" {
  value       = google_secret_manager_secret.gemini_api_key.secret_id
  description = "Gemini API key secret ID."
}
