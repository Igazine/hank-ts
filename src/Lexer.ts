import { TokenData } from './Types.js';

export enum TokenType {
    Identifier,
    Number,
    String,
    
    Assign,    // =
    Question,  // ?
    Colon,     // :
    Rescue,    // ~
    At,        // @
    Hash,      // #
    Not,       // !
    Caret,     // ^
    Dot,       // .
    Comma,     // ,
    
    LParen,    // (
    RParen,    // )
    LBrace,    // {
    RBrace,    // }
    LBracket,  // [
    RBracket,  // ]
    
    Newline,
    EOF,
    Error
}

export interface Token {
    type: TokenType;
    literal: string;
    line: number;
    lineText: string;
}

export class Lexer {
    private input: string;
    private pos: number = 0;
    private line: number = 1;
    private lineStart: number = 0;
    private tokens: Token[] = [];

    constructor(input: string) {
        this.input = input;
    }

    tokenize(): Token[] {
        while (this.pos < this.input.length) {
            const char = this.input[this.pos];

            if (/\s/.test(char)) {
                if (char === '\n') {
                    this.addToken(TokenType.Newline, '\n');
                    this.line++;
                    this.pos++;
                    this.lineStart = this.pos;
                } else {
                    this.pos++;
                }
                continue;
            }

            if (char === '/' && this.input[this.pos + 1] === '/') {
                this.skipComment();
                continue;
            }

            if (char === '-' && /[0-9]/.test(this.input[this.pos + 1] || '')) {
                this.readNumber();
                continue;
            }

            if (/[0-9]/.test(char)) {
                this.readNumber();
                continue;
            }

            if (/[a-zA-Z_]/.test(char)) {
                this.readIdentifier();
                continue;
            }

            if (char === '"' || char ==="'") {
                this.readString(char);
                continue;
            }

            switch (char) {
                case '=': this.addToken(TokenType.Assign, '='); break;
                case '?': this.addToken(TokenType.Question, '?'); break;
                case ':': this.addToken(TokenType.Colon, ':'); break;
                case '~': this.addToken(TokenType.Rescue, '~'); break;
                case '@': this.addToken(TokenType.At, '@'); break;
                case '#': this.addToken(TokenType.Hash, '#'); break;
                case '!': this.addToken(TokenType.Not, '!'); break;
                case '^': this.addToken(TokenType.Caret, '^'); break;
                case '.': this.addToken(TokenType.Dot, '.'); break;
                case ',': this.addToken(TokenType.Comma, ','); break;
                case '(': this.addToken(TokenType.LParen, '('); break;
                case ')': this.addToken(TokenType.RParen, ')'); break;
                case '{': this.addToken(TokenType.LBrace, '{'); break;
                case '}': this.addToken(TokenType.RBrace, '}'); break;
                case '[': this.addToken(TokenType.LBracket, '['); break;
                case ']': this.addToken(TokenType.RBracket, ']'); break;
                default:
                    this.addToken(TokenType.Error, `Unexpected character: ${char}`);
            }
            this.pos++;
        }
        this.addToken(TokenType.EOF, '');
        return this.tokens;
    }

    private addToken(type: TokenType, literal: string) {
        this.tokens.push({
            type,
            literal,
            line: this.line,
            lineText: this.getCurrentLineText()
        });
    }

    private skipComment() {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
            this.pos++;
        }
    }

    private readNumber() {
        const start = this.pos;
        if (this.input[this.pos] === '-') this.pos++;
        while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos])) {
            this.pos++;
        }
        this.addToken(TokenType.Number, this.input.substring(start, this.pos));
    }

    private readIdentifier() {
        const start = this.pos;
        this.pos++;
        while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.pos])) {
            this.pos++;
        }
        this.addToken(TokenType.Identifier, this.input.substring(start, this.pos));
    }

    private readString(quote: string) {
        this.pos++; // skip quote
        let val = '';
        while (this.pos < this.input.length && this.input[this.pos] !== quote) {
            if (this.input[this.pos] === '\\') {
                this.pos++;
                switch (this.input[this.pos]) {
                    case 'n': val += '\n'; break;
                    case 't': val += '\t'; break;
                    default: val += this.input[this.pos]; break;
                }
            } else {
                val += this.input[this.pos];
            }
            this.pos++;
        }
        if (this.pos >= this.input.length) {
            this.addToken(TokenType.Error, 'Unclosed string literal');
            return;
        }
        this.pos++; // skip quote
        this.addToken(TokenType.String, val);
    }

    private getCurrentLineText(): string {
        let end = this.pos;
        while (end < this.input.length && this.input[end] !== '\n') {
            end++;
        }
        return this.input.substring(this.lineStart, end);
    }
}
