use serde::Serialize;

#[derive(Serialize)]
pub struct FileDoc {
    pub text: String,
    pub encoding: String,
    pub eol: String,
}

pub fn detect_eol(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "CRLF"
    } else {
        "LF"
    }
}

fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Foundation decodes UTF-8 (lossy) only; SP-1 replaces this with real detection.
fn decode(bytes: &[u8]) -> (String, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(&bytes[3..]).into_owned(),
            "UTF-8 BOM".to_string(),
        );
    }
    (String::from_utf8_lossy(bytes).into_owned(), "UTF-8".to_string())
}

fn encode(text: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "UTF-8 BOM" => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        _ => text.as_bytes().to_vec(),
    }
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileDoc, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let (raw_text, encoding) = decode(&bytes);
    let eol = detect_eol(&raw_text).to_string();
    Ok(FileDoc {
        text: normalize(&raw_text),
        encoding,
        eol,
    })
}

#[tauri::command]
pub fn save_file(path: String, text: String, encoding: String, eol: String) -> Result<(), String> {
    let out_text = if eol == "CRLF" {
        text.replace('\n', "\r\n")
    } else {
        text
    };
    std::fs::write(&path, encode(&out_text, &encoding)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_startup_file() -> Option<String> {
    std::env::args()
        .nth(1)
        .filter(|p| std::path::Path::new(p).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("klad_test_{}_{}", std::process::id(), name))
    }

    #[test]
    fn detects_eol() {
        assert_eq!(detect_eol("a\r\nb"), "CRLF");
        assert_eq!(detect_eol("a\nb"), "LF");
        assert_eq!(detect_eol("no newline"), "LF");
    }

    #[test]
    fn read_normalizes_crlf_and_reports_it() {
        let p = tmp("crlf.txt");
        std::fs::write(&p, b"one\r\ntwo\r\n").unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "one\ntwo\n");
        assert_eq!(doc.eol, "CRLF");
        assert_eq!(doc.encoding, "UTF-8");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn save_applies_crlf() {
        let p = tmp("save_crlf.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "one\ntwo".into(),
            "UTF-8".into(),
            "CRLF".into(),
        )
        .unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"one\r\ntwo");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn utf8_bom_roundtrip() {
        let p = tmp("bom.txt");
        std::fs::write(&p, [0xEF, 0xBB, 0xBF, b'h', b'i']).unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "hi");
        assert_eq!(doc.encoding, "UTF-8 BOM");
        save_file(
            p.to_string_lossy().into_owned(),
            doc.text,
            doc.encoding,
            doc.eol,
        )
        .unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), [0xEF, 0xBB, 0xBF, b'h', b'i']);
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn read_missing_file_errors() {
        assert!(read_file(tmp("nope.txt").to_string_lossy().into_owned()).is_err());
    }
}
