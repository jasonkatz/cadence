use crate::commands::Context;
use crate::output::{print_json, print_success};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum CheckStatus {
    Pass,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
struct CheckResult {
    name: String,
    status: CheckStatus,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    fix: Option<String>,
}

#[derive(Debug, Serialize)]
struct DoctorReport {
    checks: Vec<CheckResult>,
    versions: Versions,
    all_passed: bool,
}

#[derive(Debug, Serialize)]
struct Versions {
    tmpo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tmpod: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    claude: Option<String>,
}

fn tmpo_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"));
    home.join(".tmpo")
}

fn check_claude_cli() -> (CheckResult, Option<String>) {
    let output = Command::new("claude").arg("--version").output();
    match output {
        Ok(o) if o.status.success() => {
            let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
            (
                CheckResult {
                    name: "claude CLI".to_string(),
                    status: CheckStatus::Pass,
                    message: format!("Found: {}", version),
                    fix: None,
                },
                Some(version),
            )
        }
        _ => (
            CheckResult {
                name: "claude CLI".to_string(),
                status: CheckStatus::Fail,
                message: "claude CLI not found on PATH".to_string(),
                fix: Some(
                    "Install Claude Code: https://docs.anthropic.com/en/docs/claude-code"
                        .to_string(),
                ),
            },
            None,
        ),
    }
}

fn find_tmpod_path() -> Option<PathBuf> {
    // Check PATH first
    if let Ok(output) = Command::new("which").arg("tmpod").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // Check ~/.tmpo/bin/tmpod
    let managed = tmpo_dir().join("bin").join("tmpod");
    if managed.exists() {
        return Some(managed);
    }

    // Check /usr/local/bin/tmpod
    let usr_local = PathBuf::from("/usr/local/bin/tmpod");
    if usr_local.exists() {
        return Some(usr_local);
    }

    None
}

fn check_tmpod() -> (CheckResult, Option<String>) {
    match find_tmpod_path() {
        Some(path) => {
            // Try to get version
            let version = Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

            let msg = match &version {
                Some(v) => format!("Found: {} ({})", path.display(), v),
                None => format!("Found: {}", path.display()),
            };

            (
                CheckResult {
                    name: "tmpod daemon".to_string(),
                    status: CheckStatus::Pass,
                    message: msg,
                    fix: None,
                },
                version,
            )
        }
        None => (
            CheckResult {
                name: "tmpod daemon".to_string(),
                status: CheckStatus::Fail,
                message: "tmpod binary not found on PATH or in ~/.tmpo/bin/".to_string(),
                fix: Some(
                    "Run `brew install tmpo` or download from https://github.com/jasonkatz/tmpo/releases"
                        .to_string(),
                ),
            },
            None,
        ),
    }
}

fn check_tmpo_dir() -> CheckResult {
    let dir = tmpo_dir();

    if !dir.exists() {
        return CheckResult {
            name: "~/.tmpo/ directory".to_string(),
            status: CheckStatus::Fail,
            message: "~/.tmpo/ does not exist".to_string(),
            fix: Some("Run `mkdir -p ~/.tmpo` or start the daemon with `tmpo daemon start`".to_string()),
        };
    }

    // Check writable by attempting to create a temp file
    let test_file = dir.join(".doctor-write-test");
    match std::fs::write(&test_file, "test") {
        Ok(_) => {
            let _ = std::fs::remove_file(&test_file);
            CheckResult {
                name: "~/.tmpo/ directory".to_string(),
                status: CheckStatus::Pass,
                message: "Exists and writable".to_string(),
                fix: None,
            }
        }
        Err(e) => CheckResult {
            name: "~/.tmpo/ directory".to_string(),
            status: CheckStatus::Fail,
            message: format!("~/.tmpo/ exists but is not writable: {}", e),
            fix: Some("Run `chmod u+w ~/.tmpo`".to_string()),
        },
    }
}

fn check_config_toml() -> CheckResult {
    let config_path = tmpo_dir().join("config.toml");

    if !config_path.exists() {
        return CheckResult {
            name: "config.toml".to_string(),
            status: CheckStatus::Pass,
            message: "Not present (will use defaults)".to_string(),
            fix: None,
        };
    }

    match std::fs::read_to_string(&config_path) {
        Ok(contents) => match contents.parse::<toml::Table>() {
            Ok(_) => CheckResult {
                name: "config.toml".to_string(),
                status: CheckStatus::Pass,
                message: "Valid TOML".to_string(),
                fix: None,
            },
            Err(e) => CheckResult {
                name: "config.toml".to_string(),
                status: CheckStatus::Fail,
                message: format!("Invalid TOML: {}", e),
                fix: Some("Fix syntax errors in ~/.tmpo/config.toml".to_string()),
            },
        },
        Err(e) => CheckResult {
            name: "config.toml".to_string(),
            status: CheckStatus::Fail,
            message: format!("Cannot read config.toml: {}", e),
            fix: Some("Check file permissions on ~/.tmpo/config.toml".to_string()),
        },
    }
}

fn check_github_token() -> CheckResult {
    // Check environment variable
    if std::env::var("GITHUB_TOKEN").is_ok() || std::env::var("GH_TOKEN").is_ok() {
        return CheckResult {
            name: "GitHub token".to_string(),
            status: CheckStatus::Pass,
            message: "Configured via environment variable".to_string(),
            fix: None,
        };
    }

    // Check config.toml
    let config_path = tmpo_dir().join("config.toml");
    if config_path.exists() {
        if let Ok(contents) = std::fs::read_to_string(&config_path) {
            if let Ok(table) = contents.parse::<toml::Table>() {
                if let Some(token) = table.get("github_token") {
                    if let Some(s) = token.as_str() {
                        if !s.is_empty() {
                            return CheckResult {
                                name: "GitHub token".to_string(),
                                status: CheckStatus::Pass,
                                message: "Configured in config.toml".to_string(),
                                fix: None,
                            };
                        }
                    }
                }
            }
        }
    }

    CheckResult {
        name: "GitHub token".to_string(),
        status: CheckStatus::Warn,
        message: "No GitHub token found".to_string(),
        fix: Some(
            "Run `tmpo config set github-token <token>` or set GITHUB_TOKEN env var".to_string(),
        ),
    }
}

pub async fn run(ctx: &Context) -> anyhow::Result<()> {
    let mut checks = Vec::new();

    // Run all checks
    let (claude_check, claude_version) = check_claude_cli();
    checks.push(claude_check);

    let (tmpod_check, tmpod_version) = check_tmpod();
    checks.push(tmpod_check);

    checks.push(check_tmpo_dir());
    checks.push(check_config_toml());
    checks.push(check_github_token());

    let versions = Versions {
        tmpo: env!("CARGO_PKG_VERSION").to_string(),
        tmpod: tmpod_version,
        claude: claude_version,
    };

    let all_passed = checks.iter().all(|c| matches!(c.status, CheckStatus::Pass));

    let report = DoctorReport {
        checks: checks.clone(),
        versions,
        all_passed,
    };

    if ctx.json {
        print_json(&report)?;
    } else {
        println!("tmpo doctor\n");

        for check in &checks {
            let icon = match check.status {
                CheckStatus::Pass => "\x1b[32m✓\x1b[0m",
                CheckStatus::Warn => "\x1b[33m!\x1b[0m",
                CheckStatus::Fail => "\x1b[31m✗\x1b[0m",
            };
            println!("  {} {}: {}", icon, check.name, check.message);
            if let Some(ref fix) = check.fix {
                println!("    → {}", fix);
            }
        }

        println!("\nVersions:");
        println!("  tmpo:   {}", report.versions.tmpo);
        println!(
            "  tmpod:  {}",
            report.versions.tmpod.as_deref().unwrap_or("not found")
        );
        println!(
            "  claude: {}",
            report.versions.claude.as_deref().unwrap_or("not found")
        );

        if all_passed {
            println!();
            print_success("All checks passed.");
        } else {
            println!();
            eprintln!("Some checks failed. See fix suggestions above.");
        }
    }

    if !all_passed {
        std::process::exit(1);
    }

    Ok(())
}
