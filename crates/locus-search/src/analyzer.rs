use tantivy::tokenizer::{Token, TokenStream, Tokenizer};

/// Version 1: lowercase contiguous Latin/digits; individual CJK codepoints.
/// Both indexing and native parsing use this exact tokenizer. Character tokens
/// preserve Chinese phrase order without a mutable dictionary dependency.
#[derive(Clone)]
pub(crate) struct Hybrid;
pub(crate) struct Stream {
    tokens: std::vec::IntoIter<Token>,
    current: Token,
}
impl Tokenizer for Hybrid {
    type TokenStream<'a> = Stream;
    fn token_stream<'a>(&'a mut self, text: &'a str) -> Stream {
        let mut tokens = Vec::new();
        let mut word: Option<usize> = None;
        let mut boundaries = 0usize;
        let emit = |tokens: &mut Vec<Token>, start: usize, end: usize, boundaries: usize| {
            tokens.push(Token {
                offset_from: start,
                offset_to: end,
                position: tokens.len() + boundaries,
                text: text[start..end].to_lowercase(),
                position_length: 1,
            });
        };
        for (offset, ch) in text.char_indices() {
            let cjk = matches!(ch as u32,0x3400..=0x9fff|0x20000..=0x3134f);
            if cjk || !ch.is_alphanumeric() {
                if let Some(start) = word.take() {
                    emit(&mut tokens, start, offset, boundaries);
                }
                if cjk {
                    emit(&mut tokens, offset, offset + ch.len_utf8(), boundaries);
                }
                if ch == '\u{001f}' {
                    boundaries += 100;
                }
            } else if word.is_none() {
                word = Some(offset);
            }
        }
        if let Some(start) = word {
            emit(&mut tokens, start, text.len(), boundaries);
        }
        Stream {
            tokens: tokens.into_iter(),
            current: Token::default(),
        }
    }
}
impl TokenStream for Stream {
    fn advance(&mut self) -> bool {
        if let Some(token) = self.tokens.next() {
            self.current = token;
            true
        } else {
            false
        }
    }
    fn token(&self) -> &Token {
        &self.current
    }
    fn token_mut(&mut self) -> &mut Token {
        &mut self.current
    }
}
