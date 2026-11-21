use super::{smtp::SmtpSettings, Account, MailError};
use ring::{
    aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN},
    rand::{SecureRandom, SystemRandom},
};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};
use zeroize::Zeroizing;

const KEY_FILE: &str = "credentials.key";
const KEY_LENGTH: usize = 32;
const FORMAT_VERSION: u8 = 1;

pub(super) fn seal(
    directory: &Path,
    account: &Account,
    password: &str,
) -> Result<Vec<u8>, MailError> {
    seal_with_context(directory, account_context(account)?, password)
}

pub(super) fn seal_outgoing(
    directory: &Path,
    email: &str,
    settings: &SmtpSettings,
    password: &str,
) -> Result<Vec<u8>, MailError> {
    seal_with_context(directory, outgoing_context(email, settings)?, password)
}

pub(super) fn unseal_outgoing(
    directory: &Path,
    email: &str,
    settings: &SmtpSettings,
    sealed: &[u8],
) -> Result<Zeroizing<String>, MailError> {
    unseal_with_context(directory, outgoing_context(email, settings)?, sealed)
}

fn outgoing_context(email: &str, settings: &SmtpSettings) -> Result<Vec<u8>, MailError> {
    serde_json::to_vec(&(
        "lusi-smtp-password-v1",
        email,
        &settings.host,
        settings.port,
        settings.login(email),
        settings.start_tls,
    ))
    .map_err(|_| MailError::Credentials)
}

fn seal_with_context(
    directory: &Path,
    context: Vec<u8>,
    password: &str,
) -> Result<Vec<u8>, MailError> {
    let path = directory.join(KEY_FILE);
    let key = match read_key(&path) {
        Ok(key) => key,
        Err(error) if error.kind() == io::ErrorKind::NotFound => create_key(directory, &path)?,
        Err(_) => return Err(MailError::Credentials),
    };
    // Make the key's directory entry durable before the DB can commit its ciphertext.
    #[cfg(unix)]
    File::open(directory)
        .and_then(|dir| dir.sync_all())
        .map_err(|_| MailError::Credentials)?;

    let mut nonce = [0; NONCE_LEN];
    fill_random(&mut nonce)?;
    let mut ciphertext = Zeroizing::new(Vec::with_capacity(password.len() + AES_256_GCM.tag_len()));
    ciphertext.extend_from_slice(password.as_bytes());
    cipher(&key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(context),
            &mut *ciphertext,
        )
        .map_err(|_| MailError::Credentials)?;
    let mut sealed = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    sealed.push(FORMAT_VERSION);
    sealed.extend_from_slice(&nonce);
    sealed.extend_from_slice(&ciphertext);
    Ok(sealed)
}

pub(super) fn unseal(
    directory: &Path,
    account: &Account,
    sealed: &[u8],
) -> Result<Zeroizing<String>, MailError> {
    unseal_with_context(directory, account_context(account)?, sealed)
}

fn unseal_with_context(
    directory: &Path,
    context: Vec<u8>,
    sealed: &[u8],
) -> Result<Zeroizing<String>, MailError> {
    let Some((&FORMAT_VERSION, payload)) = sealed.split_first() else {
        return Err(MailError::Credentials);
    };
    let (nonce, ciphertext) = payload
        .split_at_checked(NONCE_LEN)
        .ok_or(MailError::Credentials)?;
    let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| MailError::Credentials)?;
    let key = read_key(&directory.join(KEY_FILE)).map_err(|_| MailError::Credentials)?;
    let mut ciphertext = Zeroizing::new(ciphertext.to_vec());
    let plaintext = cipher(&key)?
        .open_in_place(nonce, Aad::from(context), &mut ciphertext)
        .map_err(|_| MailError::Credentials)?;
    let password = std::str::from_utf8(plaintext).map_err(|_| MailError::Credentials)?;
    Ok(Zeroizing::new(password.to_owned()))
}

fn account_context(account: &Account) -> Result<Vec<u8>, MailError> {
    serde_json::to_vec(&(
        "lusi-imap-password-v1",
        &account.email,
        &account.host,
        account.port,
        account.login(),
        account.start_tls,
    ))
    .map_err(|_| MailError::Credentials)
}

fn cipher(key: &[u8; KEY_LENGTH]) -> Result<LessSafeKey, MailError> {
    UnboundKey::new(&AES_256_GCM, key)
        .map(LessSafeKey::new)
        .map_err(|_| MailError::Credentials)
}

fn fill_random(output: &mut [u8]) -> Result<(), MailError> {
    SystemRandom::new()
        .fill(output)
        .map_err(|_| MailError::Credentials)
}

fn read_key(path: &Path) -> io::Result<Zeroizing<[u8; KEY_LENGTH]>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.len() != KEY_LENGTH as u64 {
        return Err(io::ErrorKind::InvalidData.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
    }
    let mut key = Zeroizing::new([0; KEY_LENGTH]);
    File::open(path)?.read_exact(&mut *key)?;
    Ok(key)
}

fn create_key(directory: &Path, path: &Path) -> Result<Zeroizing<[u8; KEY_LENGTH]>, MailError> {
    let mut key = Zeroizing::new([0; KEY_LENGTH]);
    fill_random(&mut *key)?;
    let mut file =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| MailError::Credentials)?;
    file.write_all(&*key)
        .and_then(|()| file.as_file().sync_all())
        .map_err(|_| MailError::Credentials)?;
    match file.persist_noclobber(path) {
        Ok(_) => Ok(key),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
            read_key(path).map_err(|_| MailError::Credentials)
        }
        Err(_) => Err(MailError::Credentials),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_a_fresh_nonce_and_rejects_modified_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let account = Account {
            email: "mail@example.test".into(),
            host: "imap.example.test".into(),
            port: 993,
            username: None,
            start_tls: false,
        };
        let sealed = seal(directory.path(), &account, "test-password").unwrap();
        let second = seal(directory.path(), &account, "test-password").unwrap();
        assert_ne!(&sealed[1..=NONCE_LEN], &second[1..=NONCE_LEN]);
        for position in [0, 1, sealed.len() - 1] {
            let mut modified = sealed.clone();
            modified[position] ^= 1;
            assert_eq!(
                unseal(directory.path(), &account, &modified).err(),
                Some(MailError::Credentials)
            );
        }
        let redirected = Account {
            host: "other.example.test".into(),
            ..account.clone()
        };
        assert_eq!(
            unseal(directory.path(), &redirected, &sealed).err(),
            Some(MailError::Credentials)
        );
        let other_directory = tempfile::tempdir().unwrap();
        seal(other_directory.path(), &account, "test-password").unwrap();
        assert_eq!(
            unseal(other_directory.path(), &account, &sealed).err(),
            Some(MailError::Credentials)
        );
    }
}
