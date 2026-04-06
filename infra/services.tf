resource "railway_service" "postgres" {
  project_id   = railway_project.this.id
  name         = "postgres"
  source_image = "postgres:16-alpine"

  volume = {
    name       = "postgres-data"
    mount_path = "/var/lib/postgresql/data"
  }
}

resource "railway_tcp_proxy" "postgres" {
  environment_id   = railway_project.this.default_environment.id
  service_id       = railway_service.postgres.id
  application_port = 5432
}

resource "railway_service" "server" {
  project_id = railway_project.this.id
  name       = "server"
}

resource "railway_variable" "server_port" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.server.id
  name           = "PORT"
  value          = "8080"
}

resource "railway_variable" "server_node_env" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.server.id
  name           = "NODE_ENV"
  value          = "production"
}

resource "railway_variable" "server_database_url" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.server.id
  name           = "DATABASE_URL"
  value          = "postgresql://$${{postgres.POSTGRES_USER}}:$${{postgres.POSTGRES_PASSWORD}}@$${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/$${{postgres.POSTGRES_DB}}"
}

resource "railway_variable" "server_auth0_audience" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.server.id
  name           = "AUTH0_AUDIENCE"
  value          = var.auth0_audience
}

resource "railway_variable" "server_auth0_issuer" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.server.id
  name           = "AUTH0_ISSUER_BASE_URL"
  value          = var.auth0_issuer_base_url
}

resource "railway_variable" "server_encryption_key" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.server.id
  name           = "ENCRYPTION_KEY"
  value          = var.encryption_key
}

resource "railway_service_domain" "server" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.server.id
  subdomain      = "tmpo"
}
