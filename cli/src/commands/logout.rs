use crate::commands::Context;
use crate::config::Credentials;
use crate::output::print_success;

pub async fn run(_ctx: &Context) -> anyhow::Result<()> {
    Credentials::clear()?;
    print_success("Logged out. Run 'tmpo login' to authenticate again.");
    Ok(())
}
