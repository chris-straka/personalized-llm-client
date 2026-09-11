//! Offline language identification for platforms without Apple's
//! `NLLanguageRecognizer` (everything off macOS/iOS, where
//! `tts_identify_lang` has no recognizer to call).
//!
//! Same contract as the macOS recognizer path: a BCP-47-ish tag, or
//! None when the sample is too short or unscorable — callers fall back
//! to script detection. Fully offline (a small stop-word scorer, no
//! downloads, no new crates). The TypeScript copy in
//! `src/lib/langId.ts` covers the browser preview; the word lists here
//! deliberately match it so shell and preview agree.
//!
//! Pure and unit-tested on any host.

/// Minimum Latin tokens before a sample counts as classifiable.
pub const MIN_WORDS: usize = 10;
/// Minimum winning stop-word hits before a sample counts as identified.
pub const MIN_SCORE: usize = 2;

const STOP_WORDS: &[(&str, &[&str])] = &[
    (
        "en-US",
        &[
            "the", "and", "that", "have", "with", "this", "from", "they", "would", "there",
        ],
    ),
    (
        "fr-FR",
        &["les", "des", "une", "que", "est", "dans", "pour", "vous", "avec", "pas"],
    ),
    (
        "de-DE",
        &["der", "die", "und", "den", "von", "mit", "ist", "das", "sich", "nicht"],
    ),
    (
        "es-ES",
        &["los", "las", "una", "que", "está", "para", "con", "por", "como", "pero"],
    ),
    (
        "it-IT",
        &[
            "che", "una", "della", "sono", "come", "più", "anche", "nostra", "questo", "molto",
        ],
    ),
    (
        "pt-PT",
        &["que", "uma", "para", "com", "não", "como", "mais", "seus", "entre", "muito"],
    ),
    (
        "nl-NL",
        &["van", "het", "een", "dat", "die", "voor", "met", "zijn", "niet", "ook"],
    ),
];

fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'
        | '\u{AC00}'..='\u{D7AF}' | '\u{0600}'..='\u{06FF}' | '\u{0750}'..='\u{077F}')
}

fn is_latin_word_char(c: char) -> bool {
    c.is_alphabetic() && !('\u{3040}'..='\u{30FF}').contains(&c) && !is_cjk(c)
}

/// BCP-47 tag for `text`, or None when it cannot be told apart.
/// Non-Latin scripts resolve by script block (Japanese kana, Han,
/// Hangul, Arabic); Latin scripts go through the stop-word scorer.
pub fn identify_lang_offline(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.chars().any(|c| ('\u{3040}'..='\u{30FF}').contains(&c)) {
        return Some("ja-JP".to_string());
    }
    if trimmed.chars().any(|c| ('\u{AC00}'..='\u{D7AF}').contains(&c)) {
        return Some("ko-KR".to_string());
    }
    if trimmed
        .chars()
        .any(|c| matches!(c, '\u{0600}'..='\u{06FF}' | '\u{0750}'..='\u{077F}'))
    {
        return Some("ar-SA".to_string());
    }
    if trimmed.chars().any(|c| matches!(c,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'))
    {
        return Some("zh-CN".to_string());
    }
    let tokens: Vec<String> = trimmed
        .to_lowercase()
        .split(|c: char| !is_latin_word_char(c))
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect();
    if tokens.len() < MIN_WORDS {
        return None;
    }
    let mut best: Option<&str> = None;
    let mut best_score = 0;
    for (lang, words) in STOP_WORDS {
        let mut score = 0;
        for word in *words {
            score += tokens.iter().filter(|t| t.as_str() == *word).count();
        }
        if score > best_score {
            best_score = score;
            best = Some(lang);
        }
    }
    if best_score < MIN_SCORE {
        return None;
    }
    best.map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::identify_lang_offline;

    #[test]
    fn resolves_scripts_without_statistics() {
        assert_eq!(
            identify_lang_offline("日本語を勉強しています").as_deref(),
            Some("ja-JP")
        );
        assert_eq!(
            identify_lang_offline("我正在学习中文").as_deref(),
            Some("zh-CN")
        );
        assert_eq!(identify_lang_offline("hi"), None);
    }

    #[test]
    fn tells_french_from_english() {
        let french = "Les enfants jouent dans le jardin avec leurs amis pour fêter la fin de lannée";
        let english =
            "The children have played with their friends and they would come back from there";
        assert_eq!(identify_lang_offline(french).as_deref(), Some("fr-FR"));
        assert_eq!(identify_lang_offline(english).as_deref(), Some("en-US"));
    }

    #[test]
    fn rejects_short_and_scoreless_samples() {
        assert_eq!(identify_lang_offline(""), None);
        assert_eq!(identify_lang_offline("hi there"), None);
        assert_eq!(
            identify_lang_offline("lorem ipsum dolor sit amet consectetur adipiscing"),
            None
        );
    }
}
