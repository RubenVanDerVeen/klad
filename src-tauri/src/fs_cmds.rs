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

fn decode_utf16(bytes: &[u8], le: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks(2)
        .map(|c| {
            let pair = [c[0], *c.get(1).unwrap_or(&0)];
            if le {
                u16::from_le_bytes(pair)
            } else {
                u16::from_be_bytes(pair)
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

fn decode(bytes: &[u8]) -> (String, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(&bytes[3..]).into_owned(),
            "UTF-8 BOM".to_string(),
        );
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (decode_utf16(&bytes[2..], true), "UTF-16 LE".to_string());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (decode_utf16(&bytes[2..], false), "UTF-16 BE".to_string());
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return (s.to_string(), "UTF-8".to_string());
    }
    let mut det = chardetng::EncodingDetector::new();
    det.feed(bytes, true);
    let enc = det.guess(None, true);
    let (text, _, _) = enc.decode(bytes);
    (text.into_owned(), enc.name().to_string())
}

fn encode(text: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "UTF-8" => text.as_bytes().to_vec(),
        "UTF-8 BOM" => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        "UTF-16 LE" => {
            let mut out = vec![0xFF, 0xFE];
            for u in text.encode_utf16() {
                out.extend_from_slice(&u.to_le_bytes());
            }
            out
        }
        "UTF-16 BE" => {
            let mut out = vec![0xFE, 0xFF];
            for u in text.encode_utf16() {
                out.extend_from_slice(&u.to_be_bytes());
            }
            out
        }
        other => {
            let enc = encoding_rs::Encoding::for_label(other.as_bytes())
                .unwrap_or(encoding_rs::WINDOWS_1252);
            enc.encode(text).0.into_owned()
        }
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

    #[test]
    fn detects_utf16_le_bom() {
        let p = tmp("u16le.txt");
        let mut bytes = vec![0xFF, 0xFE];
        for u in "héllo".encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        std::fs::write(&p, &bytes).unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "héllo");
        assert_eq!(doc.encoding, "UTF-16 LE");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn detects_utf16_be_bom() {
        let p = tmp("u16be.txt");
        let mut bytes = vec![0xFE, 0xFF];
        for u in "hi".encode_utf16() {
            bytes.extend_from_slice(&u.to_be_bytes());
        }
        std::fs::write(&p, &bytes).unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "hi");
        assert_eq!(doc.encoding, "UTF-16 BE");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn detects_windows_1252() {
        let p = tmp("w1252.txt");
        // "café" in windows-1252: é = 0xE9 (invalid as UTF-8 here)
        std::fs::write(&p, [b'c', b'a', b'f', 0xE9]).unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "café");
        assert_eq!(doc.encoding, "windows-1252");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn utf16_le_roundtrip() {
        let p = tmp("u16_rt.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "één\nregel".into(),
            "UTF-16 LE".into(),
            "CRLF".into(),
        )
        .unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "één\nregel");
        assert_eq!(doc.encoding, "UTF-16 LE");
        assert_eq!(doc.eol, "CRLF");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn utf16_be_roundtrip() {
        let p = tmp("u16be_rt.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "abc".into(),
            "UTF-16 BE".into(),
            "LF".into(),
        )
        .unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "abc");
        assert_eq!(doc.encoding, "UTF-16 BE");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn saves_windows_1252_label() {
        let p = tmp("w1252_save.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "café".into(),
            "Windows-1252".into(),
            "LF".into(),
        )
        .unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), [b'c', b'a', b'f', 0xE9]);
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn unmappable_chars_become_entities_in_1252() {
        // encoding_rs replaces unmappable chars with numeric character references
        let p = tmp("w1252_lossy.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "漢".into(),
            "Windows-1252".into(),
            "LF".into(),
        )
        .unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"&#28450;");
        std::fs::remove_file(p).unwrap();
    }
}
