pub mod cancel;
pub mod config;
pub mod list;
pub mod login;
pub mod logout;
pub mod run;
pub mod status;
pub mod whoami;

pub struct Context {
    pub base_url: String,
    pub json: bool,
}
