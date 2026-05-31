import { TokenData, HankError } from './Types.js';
import { HankErrorRegistry } from './ErrorRegistry.js';

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
    column: number;
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
                case ',': this.addToken(TokenType.Comma, ','); break;
                case '(': this.addToken(TokenType.LParen, '('); break;
                case ')': this.addToken(TokenType.RParen, ')'); break;
                case '{': this.addToken(TokenType.LBrace, '{'); break;
                case '}': this.addToken(TokenType.RBrace, '}'); break;
                case '[': this.addToken(TokenType.LBracket, '['); break;
                case ']': this.addToken(TokenType.RBracket, ']'); break;
                default:
                    this.addToken(TokenType.Error, HankErrorRegistry.create(HankError.UnexpectedCharacter, [char]).message);
            }
            this.pos++;
        }
        this.addToken(TokenType.EOF, '');
        return this.tokens;
    }

    private addToken(type: TokenType, literal: string, posOffset: number = 0) {
        const column = (this.pos - posOffset) - this.lineStart + 1;
        this.tokens.push({
            type,
            literal,
            line: this.line,
            column,
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
        
        let hasDot = false;
        while (this.pos < this.input.length) {
            const char = this.input[this.pos];
            if (char === '.') {
                if (hasDot) break; // Stop at second dot; parser will catch dot-after-number
                hasDot = true;
            } else if (!/[0-9]/.test(char)) {
                break;
            }
            this.pos++;
        }

        // Validate: EBNF requires digits after a dot if present
        const literal = this.input.substring(start, this.pos);
        if (literal.endsWith('.')) {
            this.pos--; // Roll back the dot
        }

        // Check for illegal suffix (e.g., 100a)
        if (this.pos < this.input.length && /[a-zA-Z_]/.test(this.input[this.pos])) {
            const char = this.input[this.pos];
            this.addToken(TokenType.Error, HankErrorRegistry.create(HankError.UnexpectedCharacter, [char]).message, this.pos - start);
            return;
        }

        this.addToken(TokenType.Number, this.input.substring(start, this.pos), this.pos - start);
    }

    private readIdentifier() {
        const start = this.pos;
        this.pos++;
        while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.pos])) {
            this.pos++;
        }
        this.addToken(TokenType.Identifier, this.input.substring(start, this.pos), this.pos - start);
    }

    private readString(quote: string) {
        const start = this.pos;
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
            this.addToken(TokenType.Error, HankErrorRegistry.create(HankError.UnclosedStringLiteral).message, this.pos - start);
            return;
        }
        this.pos++; // skip quote
        this.addToken(TokenType.String, val, this.pos - start);
    }

    private getCurrentLineText(): string {
        let end = this.pos;
        while (end < this.input.length && this.input[end] !== '\n') {
            end++;
        }
        return this.input.substring(this.lineStart, end);
    }
}
