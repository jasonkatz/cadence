variable "project_name" {
  description = "Railway project name"
  type        = string
  default     = "cadence"
}

variable "auth0_audience" {
  description = "Auth0 API audience identifier"
  type        = string
}

variable "auth0_issuer_base_url" {
  description = "Auth0 issuer base URL (e.g. https://your-tenant.auth0.com/)"
  type        = string
}

variable "encryption_key" {
  description = "AES-256-GCM key for encrypting GitHub tokens at rest"
  type        = string
  sensitive   = true
}

variable "postgres_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}
