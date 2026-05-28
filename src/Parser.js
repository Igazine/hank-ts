import { ValueType } from './Types.js';
import { TokenType } from './Lexer.js';
export class Parser {
    tokens;
    pos = 0;
    filename;
    macroResolver;
    constructor(tokens, filename, macroResolver) {
        this.tokens = tokens;
        this.filename = filename;
        this.macroResolver = macroResolver;
    }
    parse() {
        this.skipNewlines();
        const stmts = [];
        // 1. Consume Macro Includes
        while (!this.isEof() && this.peek().type === TokenType.At) {
            stmts.push(this.parseInclude());
            this.skipNewlines();
        }
        if (this.isEof())
            throw new Error("Syntax Error: Script is empty.");
        // 2. Parse exactly ONE TaskDef (FuncDef or Block)
        let mainTask;
        if (this.peek().type === TokenType.LParen && this.isFuncDefStart()) {
            mainTask = this.parseFuncDef();
        }
        else if (this.peek().type === TokenType.LBrace) {
            mainTask = this.parseBlock();
        }
        else {
            throw new Error("Syntax Error: Expected main task definition (a closure or a block).");
        }
        stmts.push(mainTask);
        // 3. Assert EOF
        this.skipNewlines();
        if (!this.isEof()) {
            throw new Error("Syntax Error: Unexpected code outside of main task. A Hank script must contain exactly one Task definition.");
        }
        if (stmts.length === 1)
            return stmts[0];
        return { kind: 'Block', stmts, td: this.getTd(stmts[0]) };
    }
    getTd(expr) {
        return expr.td;
    }
    parseStatement() {
        this.skipNewlines();
        const t = this.peek();
        switch (t.type) {
            case TokenType.Question: return this.parseFlowControl();
            case TokenType.Caret: return this.parseReturn();
            case TokenType.At: return this.parseInclude();
            default: return this.parseExpression();
        }
    }
    parseFlowControl() {
        const t = this.consume(TokenType.Question);
        const td = { line: t.line, lineText: t.lineText };
        this.consume(TokenType.LParen);
        const condition = this.parseExpression();
        this.consume(TokenType.RParen);
        const success = this.parseBlock();
        let fallback;
        let rescue;
        let catchVar;
        let savedPos = this.pos;
        this.skipNewlines();
        if (this.peek().type === TokenType.Colon) {
            this.consume(TokenType.Colon);
            fallback = this.parseBlock();
            savedPos = this.pos;
            this.skipNewlines();
        }
        else {
            this.pos = savedPos;
        }
        if (this.peek().type === TokenType.Rescue) {
            this.consume(TokenType.Rescue);
            this.consume(TokenType.LParen);
            catchVar = this.consumeIdentifier();
            this.consume(TokenType.RParen);
            rescue = this.parseBlock();
        }
        else {
            this.pos = savedPos;
        }
        return { kind: 'FlowControl', condition, success, fallback, rescue, catchVar, td };
    }
    parseExpression() {
        return this.parseAssignment();
    }
    parseAssignment() {
        const expr = this.parsePrimary();
        if (this.peek().type === TokenType.Assign) {
            if (expr.kind === 'Ident' && !expr.isCore) {
                const t = this.consume(TokenType.Assign);
                const td = { line: t.line, lineText: t.lineText };
                const value = this.parseExpression();
                return { kind: 'Assign', name: expr.name, value, td };
            }
            else {
                throw this.error("Invalid assignment target");
            }
        }
        return expr;
    }
    parsePrimary() {
        const t = this.peek();
        const td = { line: t.line, lineText: t.lineText };
        let expr;
        switch (t.type) {
            case TokenType.At:
                expr = this.parseInclude();
                break;
            case TokenType.LParen:
                if (this.isFuncDefStart()) {
                    expr = this.parseFuncDef();
                }
                else {
                    this.pos++;
                    expr = this.parseExpression();
                    this.consume(TokenType.RParen);
                }
                break;
            case TokenType.LBrace:
                if (this.isObjectLiteral()) {
                    expr = this.parseObjectLiteral();
                }
                else {
                    expr = this.parseBlock();
                }
                break;
            case TokenType.LBracket:
                expr = this.parseArrayLiteral();
                break;
            case TokenType.Not:
                this.pos++;
                expr = { kind: 'UnOp', op: '!', target: this.parsePrimary(), td };
                break;
            case TokenType.Hash:
                this.pos++;
                expr = { kind: 'Ident', name: this.consumeIdentifier(), isCore: true, td };
                break;
            case TokenType.Identifier:
                const name = this.consumeIdentifier();
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
            case TokenType.Caret:
                expr = this.parseReturn();
                break;
            default:
                throw this.error(`Unexpected token: ${TokenType[t.type]} (${t.literal})`);
        }
        return this.finishPrimary(expr);
    }
    finishPrimary(expr) {
        while (true) {
            const t = this.peek();
            const td = { line: t.line, lineText: t.lineText };
            if (t.type === TokenType.Dot) {
                this.consume(TokenType.Dot);
                expr = { kind: 'Field', object: expr, fieldName: this.consumeIdentifier(), td };
            }
            else if (t.type === TokenType.LParen) {
                expr = { kind: 'FuncCall', target: expr, args: this.parseArgList(), td };
            }
            else
                break;
        }
        return expr;
    }
    isFuncDefStart() {
        let p = this.pos + 1;
        let depth = 1;
        while (p < this.tokens.length && depth > 0) {
            if (this.tokens[p].type === TokenType.LParen)
                depth++;
            if (this.tokens[p].type === TokenType.RParen)
                depth--;
            p++;
        }
        while (p < this.tokens.length && this.tokens[p].type === TokenType.Newline)
            p++;
        return p < this.tokens.length && this.tokens[p].type === TokenType.LBrace;
    }
    parseFuncDef() {
        const td = this.peekTd();
        this.consume(TokenType.LParen);
        const params = [];
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
    parseParam() {
        let isOptional = false;
        if (this.peek().type === TokenType.Question) {
            this.consume(TokenType.Question);
            isOptional = true;
        }
        const name = this.consumeIdentifier();
        let defaultValue;
        if (this.peek().type === TokenType.Assign) {
            this.consume(TokenType.Assign);
            defaultValue = this.parseExpression();
            isOptional = true;
        }
        return { name, isOptional, defaultValue };
    }
    parseBlock() {
        const t = this.consume(TokenType.LBrace);
        const td = { line: t.line, lineText: t.lineText };
        const stmts = [];
        while (this.peek().type !== TokenType.RBrace && !this.isEof()) {
            this.skipNewlines();
            if (this.peek().type === TokenType.RBrace)
                break;
            stmts.push(this.parseStatement());
        }
        this.consume(TokenType.RBrace);
        return { kind: 'Block', stmts, td };
    }
    isObjectLiteral() {
        let p = this.pos + 1;
        while (p < this.tokens.length && this.tokens[p].type === TokenType.Newline)
            p++;
        if (p >= this.tokens.length)
            return false;
        if (this.tokens[p].type === TokenType.RBrace)
            return true;
        if (this.tokens[p].type === TokenType.Identifier) {
            let next = p + 1;
            while (next < this.tokens.length && this.tokens[next].type === TokenType.Newline)
                next++;
            return next < this.tokens.length && this.tokens[next].type === TokenType.Colon;
        }
        return false;
    }
    parseObjectLiteral() {
        const t = this.consume(TokenType.LBrace);
        const td = { line: t.line, lineText: t.lineText };
        const fields = new Map();
        while (this.peek().type !== TokenType.RBrace && !this.isEof()) {
            this.skipNewlines();
            if (this.peek().type === TokenType.RBrace)
                break;
            const key = this.consumeIdentifier();
            this.consume(TokenType.Colon);
            fields.set(key, this.parseExpression());
            if (this.peek().type === TokenType.Comma)
                this.consume(TokenType.Comma);
        }
        this.consume(TokenType.RBrace);
        return { kind: 'Object', fields, td };
    }
    parseArrayLiteral() {
        const t = this.consume(TokenType.LBracket);
        const td = { line: t.line, lineText: t.lineText };
        const items = [];
        while (this.peek().type !== TokenType.RBracket && !this.isEof()) {
            this.skipNewlines();
            if (this.peek().type === TokenType.RBracket)
                break;
            items.push(this.parseExpression());
            if (this.peek().type === TokenType.Comma)
                this.consume(TokenType.Comma);
        }
        this.consume(TokenType.RBracket);
        return { kind: 'Array', items, td };
    }
    parseArgList() {
        this.consume(TokenType.LParen);
        const args = [];
        this.skipNewlines();
        if (this.peek().type !== TokenType.RParen) {
            args.push(this.parseExpression());
            while (true) {
                this.skipNewlines();
                if (this.peek().type === TokenType.Comma) {
                    this.consume(TokenType.Comma);
                    this.skipNewlines();
                    args.push(this.parseExpression());
                }
                else
                    break;
            }
        }
        this.skipNewlines();
        this.consume(TokenType.RParen);
        return args;
    }
    parseReturn() {
        const t = this.consume(TokenType.Caret);
        const td = { line: t.line, lineText: t.lineText };
        let val = { kind: 'Literal', value: { type: ValueType.Void }, td };
        if (!this.isEof() && ![TokenType.Newline, TokenType.RBrace, TokenType.RBracket, TokenType.Comma, TokenType.RParen].includes(this.peek().type)) {
            val = this.parseExpression();
        }
        return { kind: 'UnOp', op: '^', target: val, td };
    }
    parseInclude() {
        const t = this.consume(TokenType.At);
        const td = { line: t.line, lineText: t.lineText };
        let rawPath = '';
        if (this.peek().type === TokenType.String) {
            rawPath = this.consume(TokenType.String).literal;
        }
        else {
            throw new Error("Syntax Error: The '@' macro strictly requires a string literal path (e.g., @ \"utils\"). Identifier shorthand is not allowed.");
        }
        const taskAst = this.macroResolver(rawPath);
        const taskName = rawPath.split(/[\\/]/).pop()?.replace(/\.hank$/, '') || rawPath;
        return { kind: 'Assign', name: taskName, value: taskAst, td };
    }
    consumeIdentifier() {
        const t = this.peek();
        if (t.type !== TokenType.Identifier)
            throw this.error(`Expected identifier, found ${TokenType[t.type]}`);
        this.pos++;
        return t.literal;
    }
    consume(type) {
        const t = this.peek();
        if (t.type !== type)
            throw this.error(`Expected ${TokenType[type]}, found ${TokenType[t.type]}`);
        this.pos++;
        return t;
    }
    peek() {
        return this.tokens[this.pos] || { type: TokenType.EOF, literal: '', line: 0, lineText: '' };
    }
    peekTd() {
        const t = this.peek();
        return { line: t.line, lineText: t.lineText };
    }
    skipNewlines() {
        while (this.tokens[this.pos]?.type === TokenType.Newline)
            this.pos++;
    }
    isEof() {
        return this.pos >= this.tokens.length || this.tokens[this.pos].type === TokenType.EOF;
    }
    error(msg) {
        const t = this.peek();
        return `ERROR: ${msg} in ${this.filename} at\n\t${t.line}:\t${t.lineText}`;
    }
}
