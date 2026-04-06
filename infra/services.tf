resource "railway_service" "postgres" {
  project_id   = railway_project.this.id
  name         = "postgres"
  source_image = "postgres:16-alpine"

  volume = {
    name       = "postgres-data"
    mount_path = "/var/lib/postgresql/mount"
  }
}

resource "railway_variable" "pgdata" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.postgres.id
  name           = "PGDATA"
  value          = "/var/lib/postgresql/mount/pgdata"
}

resource "railway_variable" "postgres_user" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.postgres.id
  name           = "POSTGRES_USER"
  value          = "tmpo"
}

resource "railway_variable" "postgres_password" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.postgres.id
  name           = "POSTGRES_PASSWORD"
  value          = var.postgres_password
}

resource "railway_variable" "postgres_db" {
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.postgres.id
  name           = "POSTGRES_DB"
  value          = "tmpo"
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
  value          = "postgresql://tmpo:${var.postgres_password}@$${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/tmpo"
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
