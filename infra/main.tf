terraform {
  required_version = ">= 1.5"
  required_providers {
    railway = {
      source  = "terraform-community-providers/railway"
      version = "~> 0.6"
    }
  }
}

provider "railway" {
  # Reads RAILWAY_TOKEN from environment
}

resource "railway_project" "this" {
  name = var.project_name
}
