use anyhow::Result;

use crate::config::CadenceConfig;
use crate::output;

#[derive(Debug, clap::Args)]
pub struct ConfigArgs {
    #[command(subcommand)]
    pub command: Option<ConfigCommand>,
}

#[derive(Debug, clap::Subcommand)]
pub enum ConfigCommand {
    /// Create a default config file
    Init,
    /// Show the current config
    Show,
    /// Show the config file path
    Path,
}

pub async fn run(args: ConfigArgs) -> Result<()> {
    match args.command {
        Some(ConfigCommand::Init) => {
            let path = CadenceConfig::save_default()?;
            eprintln!("Config created at: {}", path.display());
            Ok(())
        }
        Some(ConfigCommand::Show) => {
            let config = CadenceConfig::load()?;
            output::print_json(&config)?;
            Ok(())
        }
        Some(ConfigCommand::Path) => {
            let path = CadenceConfig::path()?;
            println!("{}", path.display());
            Ok(())
        }
        None => {
            let config = CadenceConfig::load()?;
            output::print_json(&config)?;
            Ok(())
        }
    }
}
