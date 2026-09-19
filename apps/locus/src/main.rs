mod shell;
mod startup;

fn main() -> anyhow::Result<()> {
    startup::run()
}
