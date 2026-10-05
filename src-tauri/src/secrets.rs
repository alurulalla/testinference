//! Provider keys. They live in the OS keychain and nowhere else: not in the
//! workspace, not in config, never in a log line, and never handed to the
//! renderer — the UI only ever learns whether a key is present.

use keyring::Entry;

const SERVICE: &str = "dev.testinference.desktop";

pub fn store(provider: &str, key: &str) -> Result<(), String> {
    entry(provider)?
        .set_password(key)
        .map_err(|error| format!("could not save the key: {error}"))
}

pub fn read(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("could not read the key: {error}")),
    }
}

pub fn clear(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("could not remove the key: {error}")),
    }
}

pub fn has_key(provider: &str) -> bool {
    matches!(read(provider), Ok(Some(_)))
}

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|error| format!("could not reach the keychain: {error}"))
}
