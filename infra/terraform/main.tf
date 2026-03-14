locals {
  service_name                 = coalesce(var.service_name, "${var.name}-${var.environment}")
  connector_name               = "cs-${var.environment}-connector"
  github_pool_display_name     = "cs-${var.environment} gh pool"
  github_provider_display_name = "cs-${var.environment} gh provider"
  labels = merge(var.labels, {
    app         = var.name
    environment = var.environment
    managed_by  = "terraform"
  })
  service_env = merge({
    APP_ENV               = var.environment
    NODE_ENV              = "production"
    DEFAULT_ROOM_ID       = "main-room"
    REQUIRE_REDIS         = "true"
    REQUIRE_FIRESTORE     = "true"
    FIRESTORE_COLLECTION  = var.firestore_collection
    ALLOW_IN_MEMORY_STATE = "false"
    REDIS_HOST            = google_redis_instance.cache.host
    REDIS_PORT            = tostring(google_redis_instance.cache.port)
  }, var.env_vars)
  enabled_services = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "vpcaccess.googleapis.com",
  ])
}

resource "google_project_service" "apis" {
  for_each           = local.enabled_services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = var.artifact_registry_repository_id
  description   = "Container repository for ${local.service_name}"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = var.gemini_secret_id

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "gemini_api_key" {
  count       = var.gemini_api_key_value != "" ? 1 : 0
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key_value
}

resource "google_firestore_database" "default" {
  count                   = var.create_firestore_database ? 1 : 0
  project                 = var.project_id
  name                    = "(default)"
  location_id             = var.firestore_location
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"

  depends_on = [google_project_service.apis]
}

resource "google_compute_network" "serverless" {
  name                    = "${local.service_name}-network"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_vpc_access_connector" "serverless" {
  name          = local.connector_name
  region        = var.region
  ip_cidr_range = var.vpc_connector_cidr
  network       = google_compute_network.serverless.name
  min_instances = 2
  max_instances = 3

  depends_on = [google_project_service.apis, google_compute_network.serverless]
}

resource "google_redis_instance" "cache" {
  name               = "${local.service_name}-redis"
  display_name       = "${local.service_name} redis"
  tier               = var.redis_tier
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  authorized_network = google_compute_network.serverless.id
  redis_version      = "REDIS_7_0"
  labels             = local.labels

  depends_on = [google_project_service.apis, google_compute_network.serverless]
}

resource "google_service_account" "runtime" {
  account_id   = substr(replace("${local.service_name}-runtime", "_", "-"), 0, 30)
  display_name = "${local.service_name} runtime"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "deployer" {
  account_id   = substr(replace("${local.service_name}-deployer", "_", "-"), 0, 30)
  display_name = "${local.service_name} deployer"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "runtime_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "deployer_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_artifact_writer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_service_account_user" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = substr(replace("${local.service_name}-github", "_", "-"), 0, 32)
  display_name              = local.github_pool_display_name
  description               = "OIDC trust for GitHub Actions deployments"

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = local.github_provider_display_name
  description                        = "GitHub OIDC provider for ${var.github_repository}"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  attribute_condition = "assertion.repository == \"${var.github_repository}\" && assertion.ref == \"refs/heads/${var.github_branch}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_wif_deployer" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

resource "google_cloud_run_v2_service" "app" {
  name                = local.service_name
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels

  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "3600s"
    max_instance_request_concurrency = var.concurrency

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      connector = google_vpc_access_connector.serverless.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      ports {
        container_port = var.container_port
      }

      dynamic "env" {
        for_each = local.service_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.inject_gemini_secret ? [1] : []
        content {
          name = "GEMINI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.gemini_api_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }

  depends_on = [
    google_project_service.apis,
    google_artifact_registry_repository.app,
    google_redis_instance.cache,
    google_vpc_access_connector.serverless,
    google_project_iam_member.runtime_secret_accessor,
    google_project_iam_member.runtime_firestore_user,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = var.create_public_invoker ? 1 : 0
  name     = google_cloud_run_v2_service.app.name
  location = google_cloud_run_v2_service.app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
