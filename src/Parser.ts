import { Expr, Param, TokenData, Value, ValueType } from './Types.js';
import { Lexer, Token, TokenType } from './Lexer.js';

export class Parser {
    private tokens: Token[];
    private pos: number = 0;
    private filename: string;
    private macroMap: Map<string, string>;

    constructor(tokens: Token[], filename: string, macroMap: Map<string, string> = new Map()) {
        this.tokens = tokens;
        this.filename = filename;
        this.macroMap = macroMap;
    }

    parse(): Expr {
        const tdRoot = this.peekTd();
        const stmts: Expr[] = [];

        // { MacroInclude }
        while (!this.isEof()) {
            this.skipNewlines();
            if (this.peek().type !== TokenType.At) break;
            stmts.push(this.parseInclude());
        }

        this.skipNewlines();
        if (this.isEof()) {
            throw this.error("Script must conclude with a FuncDef or a bare Block");
        }

        // ( FuncDef | Block )
        const tdTask = this.peekTd();
        let task: Expr;
        const t = this.peek();
        if (t.type === TokenType.LParen) {
            task = this.parseFuncDef();
        } else if (t.type === TokenType.LBrace) {
            const body = this.parseBlock();
            task = { kind: 'FuncDef', params: [], body, td: tdTask };
        } else {
            throw this.error("Script must conclude with a FuncDef or a bare Block");
        }

        stmts.push(task);

        this.skipNewlines();
        if (!this.isEof()) {
            throw this.error("Unexpected content after script task definition");
        }

        return { kind: 'Block', stmts, td: tdRoot };
    }

    private parseStatement(): Expr {
        this.skipNewlines();
        const t = this.peek();
        switch (t.type) {
            case TokenType.Question: return this.parseFlowControl();
            case TokenType.Caret: return this.parseReturn();
            case TokenType.At: return this.parseInclude();
            default: return this.parseExpression();
        }
    }

    private parseFlowControl(): Expr {
        const t = this.consume(TokenType.Question);
        const td: TokenData = { line: t.line, lineText: t.lineText };
        this.consume(TokenType.LParen);
        const condition = this.parseExpression();
        this.consume(TokenType.RParen);
        
        const success = this.parseBlock();
        
        let fallback: Expr | undefined;
        let rescue: Expr | undefined;
        let catchVar: string | undefined;
        
        let savedPos = this.pos;
        this.skipNewlines();
        if (this.peek().type === TokenType.Colon) {
            this.consume(TokenType.Colon);
            fallback = this.parseBlock();
            savedPos = this.pos;
            this.skipNewlines();
        } else {
            this.pos = savedPos;
        }
        
        if (this.peek().type === TokenType.Rescue) {
            this.consume(TokenType.Rescue);
            this.consume(TokenType.LParen);
            catchVar = this.consumeIdentifier();
            this.consume(TokenType.RParen);
            rescue = this.parseBlock();
        } else {
            this.pos = savedPos;
        }
        
        return { kind: 'FlowControl', condition, success, fallback, rescue, catchVar, td };
    }

    private parseExpression(): Expr {
        return this.parsePrimary();
    }

    private parsePrimary(): Expr {
        const t = this.peek();
        const td: TokenData = { line: t.line, lineText: t.lineText };
        let expr: Expr;

        switch (t.type) {
            case TokenType.LParen:
                if (this.isFuncDefStart()) {
                    expr = this.parseFuncDef();
                } else {
                    this.pos++;
                    expr = this.parseExpression();
                    this.consume(TokenType.RParen);
                }
                break;
            case TokenType.LBrace: expr = this.parseObjectLiteral(); break;
            case TokenType.LBracket: expr = this.parseArrayLiteral(); break;
            case TokenType.Not:
                this.pos++;
                expr = { kind: 'UnOp', op: '!', target: this.parsePrimary(), td };
                break;
            case TokenType.Question:
                this.pos++;
                expr = { kind: 'UnOp', op: '?', target: this.parsePrimary(), td };
                break;
            case TokenType.Hash:
                this.pos++;
                expr = { kind: 'Ident', name: this.consumeIdentifier(), isCore: true, td };
                break;
            case TokenType.Identifier:
                const name = this.consumeIdentifier();
                if (this.peek().type === TokenType.Assign) {
                    this.consume(TokenType.Assign);
                    return { kind: 'Assign', name, value: this.parseExpression(), td };
                }
                expr = { kind: 'Ident', name, isCore: false, td };
                break;
            case TokenType.String:
                this.pos++;
                expr = { kind: 'Literal', value: { type: ValueType.String, value: t.literal }, td };
                break;
            case TokenType.Number:
                this.pos++;
                expr = { kind: 'Literal', value: { type: ValueType.Number, value: parseFloat(t.literal) }, td };
                break;
            case TokenType.Regex:
                this.pos++;
                expr = { kind: 'Literal', value: this.parseRegexValue(t.literal), td };
                break;
            default:
                throw this.error(`Unexpected token: ${TokenType[t.type]}`);
        }

        return this.finishPrimary(expr);
    }

    private finishPrimary(expr: Expr): Expr {
        while (true) {
            const t = this.peek();
            const td: TokenData = { line: t.line, lineText: t.lineText };
            if (t.type === TokenType.Dot) {
                this.consume(TokenType.Dot);
                expr = { kind: 'Field', object: expr, fieldName: this.consumeIdentifier(), td };
            } else if (t.type === TokenType.LParen) {
                expr = { kind: 'FuncCall', target: expr, args: this.parseArgList(), td };
            } else break;
        }
        return expr;
    }

    private isFuncDefStart(): boolean {
        let p = this.pos + 1;
        let depth = 1;
        while (p < this.tokens.length && depth > 0) {
            if (this.tokens[p].type === TokenType.LParen) depth++;
            if (this.tokens[p].type === TokenType.RParen) depth--;
            p++;
        }
        while (p < this.tokens.length && this.tokens[p].type === TokenType.Newline) p++;
        return p < this.tokens.length && this.tokens[p].type === TokenType.LBrace;
    }

    private parseFuncDef(): Expr {
        const td = this.peekTd();
        this.consume(TokenType.LParen);
        const params: Param[] = [];
        if (this.peek().type !== TokenType.RParen) {
            params.push(this.parseParam());
            while (this.peek().type === TokenType.Comma) {
                this.consume(TokenType.Comma);
                params.push(this.parseParam());
            }
        }
        this.consume(TokenType.RParen);
        const body = this.parseBlock();
        return { kind: 'FuncDef', params, body, td };
    }

    private parseParam(): Param {
        let isOptional = false;
        if (this.peek().type === TokenType.Question) {
            this.consume(TokenType.Question);
            isOptional = true;
        }
        const name = this.consumeIdentifier();
        let defaultValue: Expr | undefined;
        if (this.peek().type === TokenType.Assign) {
            this.consume(TokenType.Assign);
            defaultValue = this.parseExpression();
            isOptional = true;
        }
        return { name, isOptional, defaultValue };
    }

    private parseBlock(): Expr {
        const t = this.consume(TokenType.LBrace);
        const td: TokenData = { line: t.line, lineText: t.lineText };
        const stmts: Expr[] = [];
        while (this.peek().type !== TokenType.RBrace && !this.isEof()) {
            this.skipNewlines();
            if (this.peek().type === TokenType.RBrace) break;
            stmts.push(this.parseStatement());
        }
        this.consume(TokenType.RBrace);
        return { kind: 'Block', stmts, td };
    }

    private parseObjectLiteral(): Expr {
        const t = this.consume(TokenType.LBrace);
        const td: TokenData = { line: t.line, lineText: t.lineText };
        const fields = new Map<string, Expr>();
        while (this.peek().type !== TokenType.RBrace && !this.isEof()) {
            this.skipNewlines();
            if (this.peek().type === TokenType.RBrace) break;
            const key = this.consumeIdentifier();
            this.consume(TokenType.Colon);
            fields.set(key, this.parseExpression());
            if (this.peek().type === TokenType.Comma) this.consume(TokenType.Comma);
        }
        this.consume(TokenType.RBrace);
        return { kind: 'Object', fields, td };
    }

    private parseArrayLiteral(): Expr {
        const t = this.consume(TokenType.LBracket);
        const td: TokenData = { line: t.line, lineText: t.lineText };
        const items: Expr[] = [];
        while (this.peek().type !== TokenType.RBracket && !this.isEof()) {
            this.skipNewlines();
            if (this.peek().type === TokenType.RBracket) break;
            items.push(this.parseExpression());
            if (this.peek().type === TokenType.Comma) this.consume(TokenType.Comma);
        }
        this.consume(TokenType.RBracket);
        return { kind: 'Array', items, td };
    }

    private parseArgList(): Expr[] {
        this.consume(TokenType.LParen);
        const args: Expr[] = [];
        this.skipNewlines();
        if (this.peek().type !== TokenType.RParen) {
            args.push(this.parseExpression());
            while (true) {
                this.skipNewlines();
                if (this.peek().type === TokenType.Comma) {
                    this.consume(TokenType.Comma);
                    this.skipNewlines();
                    args.push(this.parseExpression());
                } else break;
            }
        }
        this.skipNewlines();
        this.consume(TokenType.RParen);
        return args;
    }

    private parseReturn(): Expr {
        const t = this.consume(TokenType.Caret);
        const td: TokenData = { line: t.line, lineText: t.lineText };
        let val: Expr = { kind: 'Literal', value: { type: ValueType.Void }, td };
        if (!this.isEof() && ![TokenType.Newline, TokenType.RBrace, TokenType.RBracket, TokenType.Comma].includes(this.peek().type)) {
            val = this.parseExpression();
        }
        return { kind: 'UnOp', op: '^', target: val, td };
    }

    private parseInclude(): Expr {
        const t = this.consume(TokenType.At);
        const td: TokenData = { line: t.line, lineText: t.lineText };
        let rawPath = '';
        if (this.peek().type === TokenType.String) {
            rawPath = this.consume(TokenType.String).literal;
        } else {
            rawPath = this.consumeIdentifier();
        }

        const content = this.macroMap.get(rawPath);
        if (content === undefined) throw this.error(`Macro resource not found: @${rawPath}`);

        const taskName = rawPath.split(/[\\/]/).pop()?.replace(/\.hal$/, '') || rawPath;

        const lexer = new Lexer(content);
        const subParser = new Parser(lexer.tokenize(), rawPath, this.macroMap);
        
        // Everything is a Task now
        const taskAst = subParser.parse();
        
        return { kind: 'Assign', name: taskName, value: taskAst, td };
    }

    private parseRegexValue(lit: string): Value {
        const lastSlash = lit.lastIndexOf('/');
        const pattern = lit.substring(1, lastSlash);
        const flags = lit.substring(lastSlash + 1);
        
        let jsFlags = '';
        if (flags.includes('i')) jsFlags += 'i';
        if (flags.includes('m')) jsFlags += 'm';

        return {
            type: ValueType.Regex,
            pattern,
            flags,
            engine: new RegExp(pattern, jsFlags)
        };
    }

    private consumeIdentifier(): string {
        const t = this.peek();
        if (t.type !== TokenType.Identifier) throw this.error(`Expected identifier, found ${TokenType[t.type]}`);
        this.pos++;
        return t.literal;
    }

    private consume(type: TokenType): Token {
        const t = this.peek();
        if (t.type !== type) throw this.error(`Expected ${TokenType[type]}, found ${TokenType[t.type]}`);
        this.pos++;
        return t;
    }

    private peek(): Token {
        return this.tokens[this.pos] || { type: TokenType.EOF, literal: '', line: 0, lineText: '' };
    }

    private peekTd(): TokenData {
        const t = this.peek();
        return { line: t.line, lineText: t.lineText };
    }

    private skipNewlines() {
        while (this.tokens[this.pos]?.type === TokenType.Newline) this.pos++;
    }

    private isEof(): boolean {
        return this.pos >= this.tokens.length || this.tokens[this.pos].type === TokenType.EOF;
    }

    private error(msg: string): string {
        const t = this.peek();
        return `ERROR: ${msg} in ${this.filename} at\n\t${t.line}:\t${t.lineText}`;
    }
}
