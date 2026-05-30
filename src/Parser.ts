import { Token, TokenType, Lexer } from './Lexer.js';
import { Expr, Value, ValueType, Scope, TokenData, Param, ExecutionContext, TaskValue, HankError, HankErrorValue } from './Types.js';
import { HankErrorRegistry } from './ErrorRegistry.js';

export class Parser {
    private pos = 0;

    constructor(private tokens: Token[], private filename: string, private macroResolver: (id: string) => Expr) {}

    public parse(): Expr {
        this.skipNewlines();
        const stmts: Expr[] = [];

        // 1. Consume Macro Includes
        while (!this.isEof() && this.peek().type === TokenType.At) {
            stmts.push(this.parseInclude());
            this.skipNewlines();
        }

        if (this.isEof()) throw this.error(HankError.EmptyScript);

        // 2. Parse exactly ONE TaskDef (FuncDef or Block)
        let mainTask: Expr;
        if (this.peek().type === TokenType.LParen && this.isFuncDefStart()) {
            mainTask = this.parseFuncDef();
        } else if (this.peek().type === TokenType.LBrace) {
            mainTask = this.parseBlock();
        } else {
            throw this.error(HankError.ExpectedMainTask);
        }
        stmts.push(mainTask);

        // 3. Assert EOF
        this.skipNewlines();
        if (!this.isEof()) {
            throw this.error(HankError.UnexpectedCodeOutsideMainTask);
        }

        if (stmts.length === 1) return stmts[0];
        return { kind: 'Block', stmts, td: this.getTd(stmts[0]) };
    }

    private getTd(expr: Expr): TokenData {
        return (expr as any).td;
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
        const td: TokenData = { line: t.line, column: t.column, lineText: t.lineText };
        
        let condition: Expr;
        if (this.peek().type === TokenType.LParen) {
            this.consume(TokenType.LParen);
            condition = this.parseExpression();
            this.consume(TokenType.RParen);
        } else {
            condition = this.parseExpression();
        }
        
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
            if (this.peek().type === TokenType.LParen) {
                this.consume(TokenType.LParen);
                catchVar = this.consumeIdentifier();
                this.consume(TokenType.RParen);
            }
            rescue = this.parseBlock();
        } else {
            this.pos = savedPos;
        }
        
        return { kind: 'FlowControl', condition, success, fallback, rescue, catchVar, td };
    }

    private parseExpression(): Expr {
        return this.parseAssignment();
    }

    private parseAssignment(): Expr {
        const expr = this.parsePrimary();

        if (this.peek().type === TokenType.Assign) {
            if (expr.kind === 'Ident' && !expr.isCore) {
                this.consume(TokenType.Assign);
                const value = this.parseExpression();
                return { kind: 'Assign', name: expr.name, value, td: expr.td };
            } else {
                throw this.error(HankError.InvalidAssignmentTarget);
            }
        }

        return expr;
    }

    private parsePrimary(): Expr {
        const t = this.peek();
        const td: TokenData = { line: t.line, column: t.column, lineText: t.lineText };
        
        let expr: Expr;
        switch (t.type) {
            case TokenType.At:
                expr = this.parseInclude();
                break;
            case TokenType.LParen:
                if (this.isFuncDefStart()) {
                    expr = this.parseFuncDef();
                } else {
                    this.pos++;
                    const e = this.parseExpression();
                    this.consume(TokenType.RParen);
                    expr = e;
                }
                break;
            case TokenType.LBrace:
                expr = this.parseBlock();
                break;
            case TokenType.LBracket:
                expr = this.parseCollectionLiteral();
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
                expr = { kind: 'Ident', name: this.consumeIdentifier(), isCore: false, td };
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
                throw this.error(HankError.UnexpectedToken, [TokenType[t.type], t.literal]);
        }

        return this.finishPrimary(expr);
    }

    private finishPrimary(expr: Expr): Expr {
        while (true) {
            const t = this.peek();
            const td: TokenData = { line: t.line, column: t.column, lineText: t.lineText };
            if (t.type === TokenType.Dot) {
                this.consume(TokenType.Dot);
                expr = { kind: 'Field', collection: expr, fieldName: this.consumeIdentifier(), td };
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
        const td: TokenData = { line: t.line, column: t.column, lineText: t.lineText };
        const stmts: Expr[] = [];
        while (this.peek().type !== TokenType.RBrace && !this.isEof()) {
            this.skipNewlines();
            if (this.peek().type === TokenType.RBrace) break;
            stmts.push(this.parseStatement());
        }
        this.consume(TokenType.RBrace);
        return { kind: 'Block', stmts, td };
    }

    private parseCollectionLiteral(): Expr {
        const t = this.consume(TokenType.LBracket);
        const td: TokenData = { line: t.line, column: t.column, lineText: t.lineText };
        this.skipNewlines();

        // 1. Handle [:]
        if (this.peek().type === TokenType.Colon) {
            this.consume(TokenType.Colon);
            this.consume(TokenType.RBracket);
            return { kind: 'Map', fields: new Map(), td };
        }

        // 2. Handle []
        if (this.peek().type === TokenType.RBracket) {
            this.consume(TokenType.RBracket);
            return { kind: 'Array', items: [], td };
        }

        // 3. Parse first element
        const first = this.parseExpression();
        this.skipNewlines();

        if (this.peek().type === TokenType.Colon) {
            // This is a Map
            this.consume(TokenType.Colon);
            const val = this.parseExpression();
            const fields = new Map<string, Expr>();
            fields.set(this.getStaticKey(first), val);

            while (true) {
                this.skipNewlines();
                if (this.peek().type === TokenType.Comma) {
                    this.consume(TokenType.Comma);
                    this.skipNewlines();
                    if (this.peek().type === TokenType.RBracket) break;
                    const keyExpr = this.parseExpression();
                    this.consume(TokenType.Colon);
                    const valExpr = this.parseExpression();
                    fields.set(this.getStaticKey(keyExpr), valExpr);
                } else break;
            }
            this.consume(TokenType.RBracket);
            return { kind: 'Map', fields, td };
        } else {
            // This is an Array
            const items = [first];
            while (true) {
                this.skipNewlines();
                if (this.peek().type === TokenType.Comma) {
                    this.consume(TokenType.Comma);
                    this.skipNewlines();
                    if (this.peek().type === TokenType.RBracket) break;
                    items.push(this.parseExpression());
                } else break;
            }
            this.consume(TokenType.RBracket);
            return { kind: 'Array', items, td };
        }
    }

    private getStaticKey(e: Expr): string {
        if (e.kind === 'Literal' && e.value.type === ValueType.String) return e.value.value;
        if (e.kind === 'Ident' && !e.isCore) return e.name;
        throw this.error(HankError.ExpectedIdentifier, [TokenType[this.peek().type]]);
    }

    private parseArgList(): Expr[] {
        this.consume(TokenType.LParen);
        const args: Expr[] = [];
        this.skipNewlines();
        if (this.peek().type !== TokenType.RParen) {
            args.push(this.parseExpression());
            while (true) {
                this.skipNewlines();
                if (!this.isEof() && this.peek().type === TokenType.Comma) {
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
        const td: TokenData = { line: t.line, column: t.column, lineText: t.lineText };
        let val: Expr = { kind: 'Literal', value: { type: ValueType.Void }, td };
        if (!this.isEof()) {
            const next = this.peek().type;
            if (next !== TokenType.Newline && next !== TokenType.RBrace && next !== TokenType.RBracket && next !== TokenType.Comma && next !== TokenType.RParen) {
                val = this.parseExpression();
            }
        }
        return { kind: 'UnOp', op: '^', target: val, td };
    }

    private parseInclude(): Expr {
        const t = this.consume(TokenType.At);
        const td: TokenData = { line: t.line, column: t.column, lineText: t.lineText };
        let rawPath = '';
        if (this.peek().type === TokenType.String) {
            rawPath = this.consume(TokenType.String).literal;
        } else {
            throw this.error(HankError.MacroRequiresString);
        }

        const taskAst = this.macroResolver(rawPath);
        const taskName = rawPath.split('/').pop()?.split('\\').pop()?.replace(/\.hank$/, '') || 'unknown';

        return { kind: 'Assign', name: taskName, value: taskAst, td };
    }

    private consumeIdentifier(): string {
        const t = this.peek();
        if (t.type === TokenType.Identifier) {
            this.pos++;
            return t.literal;
        }
        throw this.error(HankError.ExpectedIdentifier, [TokenType[t.type]]);
    }

    private consume(type: TokenType): Token {
        const t = this.peek();
        if (t.type === type) {
            this.pos++;
            return t;
        }
        throw this.error(HankError.UnexpectedToken, [TokenType[type], TokenType[t.type]]);
    }

    private peek(): Token {
        if (this.pos >= this.tokens.length) return this.tokens[this.tokens.length - 1];
        return this.tokens[this.pos];
    }

    private peekTd(): TokenData {
        const t = this.peek();
        return { line: t.line, column: t.column, lineText: t.lineText };
    }

    private skipNewlines(): void {
        while (this.pos < this.tokens.length && this.tokens[this.pos].type === TokenType.Newline) {
            this.pos++;
        }
    }

    private isEof(): boolean {
        return this.pos >= this.tokens.length || this.tokens[this.pos].type === TokenType.EOF;
    }

    private error(code: HankError, args?: any[]): HankErrorValue {
        const t = this.peek();
        return HankErrorRegistry.create(code, args, this.filename, t.line, t.column, t.lineText);
    }
}
