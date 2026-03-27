use anyhow::Result;

use crate::achievements::AchievementStore;
use crate::output;

#[derive(Debug, clap::Args)]
pub struct AchievementsArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

pub async fn run(args: AchievementsArgs) -> Result<()> {
    let store = AchievementStore::load()?;

    if args.json {
        output::print_json(&store)?;
        return Ok(());
    }

    eprintln!(
        "\n\x1b[1;33m🏅 Cadence Achievements ({} workflows completed)\x1b[0m",
        store.workflows_completed
    );

    if store.achievements.is_empty() {
        eprintln!("  No badges earned yet — run your first pipeline!");
        return Ok(());
    }

    for achievement in &store.achievements {
        eprintln!(
            "  {} — {}",
            achievement.kind.label(),
            achievement.kind.description()
        );
    }

    eprintln!();
    Ok(())
}
