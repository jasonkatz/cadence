pub mod cancel;
pub mod config;
pub mod list;
pub mod logs;
pub mod proposal;
pub mod run;
pub mod status;

pub struct Context {
    pub base_url: String,
    pub json: bool,
}
