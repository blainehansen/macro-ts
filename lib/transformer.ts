import * as ts from 'typescript'
import { Result, Ok, Err } from '@ts-std/monads'

import { Dict, PickVariants } from './utils'
import { SpanResult, SpanError, SpanWarning } from './message'

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true })
function printNodes(nodes: ts.Node[]) {
	const resultFile = ts.createSourceFile('', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
	let printed = ''
	for (const node of nodes)
		printed += '\n' + printer.printNode(ts.EmitHint.Unspecified, node, resultFile)

	return printed
}

export type Macro<S = undefined> =
	| { type: 'block', execute: BlockMacroFn }
	| { type: 'function', execute: FunctionMacroFn }
	| { type: 'decorator', execute: DecoratorMacroFn }
	| { type: 'import', execute: ImportMacroFn<S> }

export type SourceChannel<S> = (sources: Dict<S>) => void

function nonExistentErr(macroName: string): [string, string] {
	return [`Macro non-existent`, `The macro "${macroName}" doesn't exist.`]
}
function incorrectTypeErr(macroName: string, macroType: string, expectedType: string): [string, string] {
	return [`Macro type mismatch`, `The macro "${macroName}" is a ${macroType} type, but here it's being used as a ${expectedType} type.`]
}

type CompileContext<S> = {
	macros: Dict<Macro<S>>,
	fileContext: FileContext,
	sourceChannel: SourceChannel<S>,
	handleScript: (script: { path: string, source: string }) => void,
	readFile: (path: string) => string | undefined,
	joinPath: (...paths: string[]) => string,
	subsume: <T>(result: SpanResult<T>) => Result<T, void>,
	Err: (node: ts.TextRange, title: string, message: string) => Result<any, void>,
	macroCtx: MacroContext,
}

export type MacroContext = {
	Ok: <T>(value: T, warnings?: SpanWarning[]) => SpanResult<T>,
	TsNodeErr: (node: ts.TextRange, title: string, ...paragraphs: string[]) => SpanResult<any>,
	Err: (fileName: string, title: string, ...paragraphs: string[]) => SpanResult<any>,
	tsNodeWarn: (node: ts.TextRange, title: string, ...paragraphs: string[]) => void,
	warn: (fileName: string, title: string, ...paragraphs: string[]) => void,
	subsume: <T>(result: SpanResult<T>) => Result<T, void>,
}

export class Transformer<S> {
	protected readonly cache = new Map<string, string>()
	protected readonly factory: ts.TransformerFactory<ts.SourceFile>

	protected errors: SpanError[] = []
	protected warnings: SpanWarning[] = []
	checkSuccess() {
		return SpanResult.checkSuccess(this.errors, this.warnings)
	}

	constructor(
		readonly macros: Dict<Macro<S>> | undefined,
		workingDir: string,
		sourceChannel: SourceChannel<S>,
		readFile: (path: string) => string | undefined,
		joinPath: (...paths: string[]) => string,
		dirMaker: (sourceFileName: string) => { currentDir: string, currentFile: string },
	) {
		this.factory = macros !== undefined && Object.keys(macros).length !== 0 ? context => sourceFile => {
			const { currentDir, currentFile } = dirMaker(sourceFile.fileName)

			const ctx = new SpanResult.Context(sourceFile)

			const statements = flatVisitStatements({
				macros, fileContext: { workingDir, currentDir, currentFile },
				sourceChannel,
				handleScript: ({ path, source }) => {
					// we always transform the results of import macros because they might have user code in them from interpolations
					this.transformSource(path, source)
				},
				readFile, joinPath,
				subsume: result => ctx.subsume(result),
				Err: (node, title, message) => ctx.Err(node, title, message),
				macroCtx: {
					Ok: (value, warnings) => SpanResult.Ok(value, warnings),
					TsNodeErr: (node, title, ...paragraphs) => SpanResult.TsNodeErr(ctx.sourceFile, node, title, paragraphs),
					Err: (fileName, title, ...paragraphs) => SpanResult.Err(fileName, title, paragraphs),
					tsNodeWarn: (node, title, ...paragraphs) => { ctx.tsNodeWarn(node, title, paragraphs) },
					warn: (fileName, title, ...paragraphs) => { ctx.warn(fileName, title, paragraphs) },
					subsume: result => ctx.subsume(result),
				},
			}, sourceFile.statements, context)

			const { errors, warnings } = ctx.drop()
			this.errors = this.errors.concat(errors)
			this.warnings = this.warnings.concat(warnings)

			return ts.updateSourceFileNode(sourceFile, statements)
		} : () => sourceFile => sourceFile
	}

	reset() {
		this.cache.clear()
	}
	has(path: string) {
		return this.cache.has(path)
	}
	get(path: string) {
		return this.cache.get(path)
	}

	transformSourceFile(sourceFile: ts.SourceFile) {
		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [this.factory])
		const newSource = printer.printFile(newSourceFile)
		this.cache.set(sourceFile.fileName, newSource)
		return newSource
	}
	transformSource(path: string, source: string) {
		const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
		return this.transformSourceFile(sourceFile)
	}
}

export type BlockMacroFn = (
	ctx: MacroContext,
	args: ts.NodeArray<ts.Statement>,
) => BlockMacroResult
export type BlockMacroResult = SpanResult<ts.Statement[]>
export function BlockMacro(execute: BlockMacroFn): PickVariants<Macro, 'type', 'block'> {
	return { type: 'block', execute }
}

// TODO all of these macros could choose to access the filesystem, so we should make all of them async
function attemptBlockMacro<S>(
	ctx: CompileContext<S>,
	statement: ts.Statement,
	block: ts.Statement | undefined,
	context: ts.TransformationContext,
): SpanResult.UnSpan<BlockMacroResult> | undefined {
	if (!(
		ts.isExpressionStatement(statement)
		&& ts.isNonNullExpression(statement.expression)
		&& ts.isNonNullExpression(statement.expression.expression)
		&& ts.isIdentifier(statement.expression.expression.expression)
	))
		return undefined

	if (!block || !ts.isBlock(block))
		return ctx.Err(statement.expression, 'Block macro syntax without block.', `You've used the macro syntax with an identifier as you would when calling a block macro, but without a block.\nThis is likely a mistake.`)

	const macroName = statement.expression.expression.expression.text
	const macro = ctx.macros[macroName]
	if (!macro)
		return ctx.Err(statement.expression, ...nonExistentErr(macroName))
	if (macro.type !== 'block')
		return ctx.Err(statement.expression, ...incorrectTypeErr(macroName, macro.type, 'block'))

	return ctx.subsume(macro.execute(ctx.macroCtx, flatVisitStatements(ctx, block.statements, context)))
}


export type FunctionMacroFn = (
	ctx: MacroContext,
	args: ts.NodeArray<ts.Expression>,
	typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
) => FunctionMacroResult
export type FunctionMacroResult = SpanResult<{
	prepend?: ts.Statement[],
	expression: ts.Expression,
	append?: ts.Statement[],
}>
export function FunctionMacro(execute: FunctionMacroFn): PickVariants<Macro, 'type', 'function'> {
	return { type: 'function', execute }
}

function attemptFunctionMacro<S>(
	ctx: CompileContext<S>,
	node: ts.Node,
	argumentsVisitor: (args: ts.NodeArray<ts.Expression>) => ts.NodeArray<ts.Expression>,
): SpanResult.UnSpan<FunctionMacroResult> | undefined {
	if (!(
		ts.isCallExpression(node)
		&& ts.isNonNullExpression(node.expression)
		&& ts.isNonNullExpression(node.expression.expression)
		&& ts.isIdentifier(node.expression.expression.expression)
	))
		return undefined

	const macroName = node.expression.expression.expression.text
	const macro = ctx.macros[macroName]
	if (!macro)
		return ctx.Err(node.expression, ...nonExistentErr(macroName))
	if (macro.type !== 'function')
		return ctx.Err(node.expression, ...incorrectTypeErr(macroName, macro.type, 'function'))

	return ctx.subsume(macro.execute(ctx.macroCtx, argumentsVisitor(node.arguments), node.typeArguments))
}


export type DecoratorMacroFn = (
	ctx: MacroContext,
	statement: ts.Statement,
	args: ts.NodeArray<ts.Expression>,
	typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
) => DecoratorMacroResult
export type DecoratorMacroResult = SpanResult<{
	prepend?: ts.Statement[],
	replacement: ts.Statement | undefined,
	append?: ts.Statement[],
}>
export function DecoratorMacro(execute: DecoratorMacroFn): PickVariants<Macro, 'type', 'decorator'> {
	return { type: 'decorator', execute }
}

function attemptDecoratorMacros<S>(
	ctx: CompileContext<S>,
	statement: ts.Statement,
): Result<ts.Statement[], void> | undefined {
	if (statement.decorators === undefined)
		return undefined

	let currentStatement = statement as ts.Statement | undefined
	const decorators = statement.decorators.slice()
	;(statement as unknown as { decorators?: ts.NodeArray<ts.Decorator> }).decorators = undefined
	const prepends = [] as ts.Statement[]
	const appends = [] as ts.Statement[]
	for (const { expression } of decorators) {
		if (!(
			ts.isCallExpression(expression)
			&& ts.isNonNullExpression(expression.expression)
			&& ts.isNonNullExpression(expression.expression.expression)
			&& ts.isIdentifier(expression.expression.expression.expression)
		))
			return ctx.Err(expression, 'Disallowed normal decorator', `At this point, macro-ts doesn't allow normal decorators.`)

		const macroName = expression.expression.expression.expression.text
		if (!currentStatement)
			return ctx.Err(expression, 'Decorator conflict', `Can't perform decorator macro ${macroName}. A previous decorator removed the decorated statement.`)
		const macro = ctx.macros[macroName]
		if (!macro)
			return ctx.Err(expression.expression, ...nonExistentErr(macroName))
		if (macro.type !== 'decorator')
			return ctx.Err(expression.expression, ...incorrectTypeErr(macroName, macro.type, 'decorator'))

		const executionResult = ctx.subsume(macro.execute(ctx.macroCtx, currentStatement, expression.arguments, expression.typeArguments))
		if (executionResult.is_err()) return Err(undefined as void)
		const { prepend, replacement, append } = executionResult.value
		currentStatement = replacement
		if (prepend) Array.prototype.push.apply(prepends, prepend)
		if (append) Array.prototype.push.apply(appends, append)
	}

	return Ok(prepends.concat(currentStatement ? [currentStatement] : []).concat(appends))
}
// statements where the creation function includes decorators (implying support)
// FunctionDeclaration
// ClassDeclaration
// InterfaceDeclaration
// TypeAliasDeclaration
// EnumDeclaration
// ModuleDeclaration
// VariableStatement
// ImportEqualsDeclaration
// ImportDeclaration
// ExportAssignment
// ExportDeclaration

// these aren't statements but do seem to have support for decorators
// it seems only FunctionDeclaration/ClassDeclaration have them
// ParameterDeclaration
// SetAccessorDeclaration
// GetAccessorDeclaration
// ConstructorDeclaration


export type FileContext = {
	workingDir: string,
	currentDir: string, currentFile: string
}

export type ImportMacroFn<S = undefined> = (
	ctx: MacroContext,
	targetSource: string,
	targetPath: string,
	file: FileContext,
) => ImportMacroResult<S>
export type ImportMacroResult<S = undefined> = SpanResult<{
	statements: ts.Statement[],
	sources?: Dict<S>,
}>
export function ImportMacro<S = undefined>(execute: ImportMacroFn<S>): PickVariants<Macro<S>, 'type', 'import'> {
	return { type: 'import', execute }
}

function attemptImportMacro<S>(
	ctx: CompileContext<S>,
	declaration: ts.ImportDeclaration | ts.ExportDeclaration,
): ts.StringLiteral | undefined {
	const { macros, fileContext, sourceChannel, handleScript, readFile, joinPath } = ctx
	const moduleSpecifier = declaration.moduleSpecifier
	if (!(
		moduleSpecifier
		&& ts.isCallExpression(moduleSpecifier)
		&& ts.isNonNullExpression(moduleSpecifier.expression)
		&& ts.isNonNullExpression(moduleSpecifier.expression.expression)
		&& ts.isIdentifier(moduleSpecifier.expression.expression.expression)
	))
		return undefined

	if (moduleSpecifier.arguments.length !== 1)
		return ctx.Err(
			moduleSpecifier.arguments, 'Macro incorrect arguments',
			`Import macros have to have exactly one string literal argument.`,
		).ok_undef()
	const pathSpecifier = moduleSpecifier.arguments[0]
	if (!ts.isStringLiteral(pathSpecifier))
		return ctx.Err(
			pathSpecifier, 'Macro incorrect arguments',
			`Import macros have to have exactly one string literal argument.`,
		).ok_undef()
	if (moduleSpecifier.typeArguments)
		return ctx.Err(
			moduleSpecifier.typeArguments, 'Macro incorrect arguments',
			`Import macros don't allow type arguments.`,
		).ok_undef()

	const macroName = moduleSpecifier.expression.expression.expression.text
	const macro = macros[macroName]
	if (!macro)
		return ctx.Err(moduleSpecifier.expression, ...nonExistentErr(macroName)).ok_undef()
	if (macro.type !== 'import')
		return ctx.Err(moduleSpecifier.expression, ...incorrectTypeErr(macroName, macro.type, 'import')).ok_undef()

	const targetPath = pathSpecifier.text
	const { workingDir, currentDir } = fileContext
	const fullPath = joinPath(workingDir, currentDir, targetPath)
	const source = readFile(fullPath)
	if (source === undefined)
		return ctx.Err(
			pathSpecifier, 'Invalid path',
			`This path resolved to "${fullPath}", but for some reason that file couldn't be read.`,
		).ok_undef()

	const executionResult = ctx.subsume(macro.execute(ctx.macroCtx, source, targetPath, fileContext))
	if (executionResult.is_err()) return undefined
	const { sources = {}, statements  } = executionResult.value
	sourceChannel(sources)
	handleScript({ path: fullPath + '.ts', source: printNodes(statements) })

	return ts.createStringLiteral(targetPath)
}



type ExpandedStatement = { prepend?: ts.Statement[], statement: ts.Statement, append?: ts.Statement[] }
function visitStatement<S>(
	ctx: CompileContext<S>,
	statement: ts.Statement,
	context: ts.TransformationContext,
): ExpandedStatement {
	const result = attemptVisitStatement(ctx, statement, context)
	if (!result) throw new Error()
	return result
}

function visitBlock<S>(
	ctx: CompileContext<S>,
	block: ts.Block,
	context: ts.TransformationContext,
): ts.Block {
	return ts.updateBlock(block, flatVisitStatements(ctx, block.statements, context))
}
function visitStatementIntoBlock<S>(
	ctx: CompileContext<S>,
	inputStatement: ts.Statement,
	context: ts.TransformationContext,
): ts.Statement {
	if (ts.isBlock(inputStatement))
		return visitBlock(ctx, inputStatement, context)

	const { prepend = [], statement, append = [] } = visitStatement(ctx, inputStatement, context)
	if (prepend.length > 0 || append.length > 0)
		return ts.createBlock(prepend.concat(statement ? [statement] : []).concat(append))
	return statement
}


function attemptVisitStatement<S>(
	ctx: CompileContext<S>,
	statement: ts.Node,
	context: ts.TransformationContext,
): ExpandedStatement | undefined {
	const prepends = [] as ts.Statement[]
	const appends = [] as ts.Statement[]

	function subsumingVisitor(node: ts.Node): ts.Node {
		const statementResult = attemptVisitStatement(ctx, node, context)
		if (statementResult) {
			const { prepend, statement, append } = statementResult
			if (prepend) Array.prototype.push.apply(prepends, prepend)
			if (append) Array.prototype.push.apply(appends, append)
			return statement
		}
		const macroResult = attemptFunctionMacro(ctx, node, visitArgsSubsuming)
		if (macroResult) {
			if (macroResult.is_err()) return node
			const { prepend, expression, append } = macroResult.value
			if (prepend) Array.prototype.push.apply(prepends, prepend)
			if (append) Array.prototype.push.apply(appends, append)
			return expression
		}
		return visitChildrenSubsuming(node)
	}
	function visitNodeSubsuming<N extends ts.Node>(node: N): N {
		const result = ts.visitNode(node, subsumingVisitor)
		if (!result) throw new Error()
		return result
	}
	function visitArgsSubsuming(args: ts.NodeArray<ts.Expression>) {
		const nodeArray = ts.createNodeArray(args.map(visitNodeSubsuming))
		;(nodeArray as unknown as ts.TextRange).pos = args.pos
		;(nodeArray as unknown as ts.TextRange).end = args.end
		return nodeArray
	}
	function visitChildrenSubsuming<N extends ts.Node>(node: N): N {
		const result = ts.visitEachChild(node, subsumingVisitor, context)
		if (!result) throw new Error()
		return result
	}
	function include(statement: ts.Statement) {
		return { prepend: prepends, statement, append: appends }
	}

	if (ts.isBlock(statement))
		return { statement: visitBlock(ctx, statement, context) }

	else if (ts.isVariableStatement(statement))
		return include(ts.updateVariableStatement(
			statement, statement.modifiers,
			visitNodeSubsuming(statement.declarationList),
		))

	else if (ts.isExpressionStatement(statement))
		return include(ts.updateExpressionStatement(statement, visitNodeSubsuming(statement.expression)))

	else if (ts.isFunctionDeclaration(statement))
		return include(ts.updateFunctionDeclaration(
			statement,
			statement.decorators ? statement.decorators.map(visitNodeSubsuming) : undefined,
			statement.modifiers, statement.asteriskToken, statement.name,
			statement.typeParameters, statement.parameters.map(parameter => {
				return parameter.initializer
					? ts.updateParameter(
						parameter, parameter.decorators, parameter.modifiers, parameter.dotDotDotToken,
						parameter.name, parameter.questionToken, parameter.type,
						visitNodeSubsuming(parameter.initializer),
					)
					: parameter
			}), statement.type,
			statement.body ? ts.updateBlock(statement.body, flatVisitStatements(ctx, statement.body.statements, context)) : undefined,
		))

	else if (ts.isReturnStatement(statement))
		return include(ts.updateReturn(
			statement,
			statement.expression ? visitNodeSubsuming(statement.expression) : undefined,
		))

	else if (ts.isIfStatement(statement))
		return include(ts.updateIf(
			statement,
			visitNodeSubsuming(statement.expression),
			visitStatementIntoBlock(ctx, statement.thenStatement, context),
			statement.elseStatement ? visitStatementIntoBlock(ctx, statement.elseStatement, context) : undefined,
		))

	else if (ts.isSwitchStatement(statement))
		return include(ts.updateSwitch(
			statement,
			visitNodeSubsuming(statement.expression),
			ts.updateCaseBlock(
				statement.caseBlock,
				statement.caseBlock.clauses.map(clause => {
					switch (clause.kind) {
						case ts.SyntaxKind.CaseClause: return ts.updateCaseClause(
							clause,
							visitNodeSubsuming(clause.expression),
							flatVisitStatements(ctx, clause.statements, context),
						)
						case ts.SyntaxKind.DefaultClause: return ts.updateDefaultClause(
							clause, flatVisitStatements(ctx, clause.statements, context),
						)
					}
				}),
			),
		))

	else if (ts.isWhileStatement(statement))
		return include(ts.updateWhile(
			statement,
			visitNodeSubsuming(statement.expression),
			visitStatementIntoBlock(ctx, statement.statement, context),
		))

	else if (ts.isForStatement(statement))
		return include(ts.updateFor(
			statement,
			statement.initializer ? visitNodeSubsuming(statement.initializer) : undefined,
			statement.condition ? visitNodeSubsuming(statement.condition) : undefined,
			statement.incrementor ? visitNodeSubsuming(statement.incrementor) : undefined,
			visitStatementIntoBlock(ctx, statement.statement, context),
		))

	else if (ts.isForInStatement(statement))
		return include(ts.updateForIn(
			statement,
			visitNodeSubsuming(statement.initializer),
			visitNodeSubsuming(statement.expression),
			visitStatementIntoBlock(ctx, statement.statement, context),
		))

	else if (ts.isForOfStatement(statement))
		return include(ts.updateForOf(
			statement,
			statement.awaitModifier,
			visitNodeSubsuming(statement.initializer),
			visitNodeSubsuming(statement.expression),
			visitStatementIntoBlock(ctx, statement.statement, context),
		))

	else if (ts.isDoStatement(statement))
		return include(ts.updateDo(
			statement,
			visitStatementIntoBlock(ctx, statement.statement, context),
			visitNodeSubsuming(statement.expression),
		))

	else if (ts.isThrowStatement(statement))
		return statement.expression
			? include(ts.updateThrow(statement, visitNodeSubsuming(statement.expression)))
			: { statement }

	else if (ts.isTryStatement(statement))
		return include(ts.updateTry(
			statement,
			visitBlock(ctx, statement.tryBlock, context),
			statement.catchClause ? visitNodeSubsuming(statement.catchClause) : undefined,
			statement.finallyBlock ? visitBlock(ctx, statement.finallyBlock, context) : undefined,
		))

	else if (ts.isClassDeclaration(statement))
		return include(ts.updateClassDeclaration(
			statement,
			statement.decorators ? statement.decorators.map(visitNodeSubsuming) : undefined,
			statement.modifiers, statement.name, statement.typeParameters, statement.heritageClauses,
			statement.members.map(visitNodeSubsuming),
		))

	else if (ts.isWithStatement(statement))
		return include(ts.updateWith(
			statement,
			visitNodeSubsuming(statement.expression),
			visitStatementIntoBlock(ctx, statement.statement, context),
		))

	else if (ts.isLabeledStatement(statement))
		return include(ts.updateLabel(statement, statement.label, visitNodeSubsuming(statement.statement)))

	else if (ts.isEnumDeclaration(statement))
		return include(ts.updateEnumDeclaration(
			statement,
			statement.decorators ? statement.decorators.map(visitNodeSubsuming) : undefined,
			statement.modifiers, statement.name,
			statement.members.map(visitNodeSubsuming),
		))

	else if (ts.isModuleDeclaration(statement))
		return include(ts.updateModuleDeclaration(
			statement,
			statement.decorators ? statement.decorators.map(visitNodeSubsuming) : undefined,
			statement.modifiers, statement.name,
			statement.body ? visitNodeSubsuming(statement.body) : undefined,
		))
	else if (ts.isModuleBlock(statement))
		return { statement: ts.updateModuleBlock(statement, flatVisitStatements(ctx, statement.statements, context)) }

	else if (ts.isExportAssignment(statement))
		return include(ts.updateExportAssignment(
			statement,
			statement.decorators ? statement.decorators.map(visitNodeSubsuming) : undefined,
			statement.modifiers,
			visitNodeSubsuming(statement.expression),
		))

	else if (ts.isImportDeclaration(statement)) {
		const path = attemptImportMacro(ctx, statement)
		if (path)
			return { statement: ts.updateImportDeclaration(
				statement, statement.decorators, statement.modifiers,
				statement.importClause, path,
			) }
		return { statement }
	}
	else if (ts.isExportDeclaration(statement)) {
		const path = attemptImportMacro(ctx, statement)
		if (path)
			return { statement: ts.updateExportDeclaration(
				statement, statement.decorators, statement.modifiers,
				statement.exportClause, path, statement.isTypeOnly,
			) }
		return { statement }
	}

	else if (
		ts.isEmptyStatement(statement) || ts.isMissingDeclaration(statement)
		|| ts.isDebuggerStatement(statement) || ts.isBreakStatement(statement) || ts.isContinueStatement(statement)
		|| ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
		|| ts.isNamespaceExportDeclaration(statement)
		|| ts.isImportEqualsDeclaration(statement)
	)
		return { statement }

	return undefined
}

function flatVisitStatements<S>(
	ctx: CompileContext<S>,
	statements: ts.NodeArray<ts.Statement>,
	context: ts.TransformationContext,
): ts.NodeArray<ts.Statement> {
	let index = 0
	const finalStatements = [] as ts.Statement[]
	while (index < statements.length) {
		const current = statements[index]

		const blockResult = attemptBlockMacro(ctx, current, statements[index + 1], context)
		if (blockResult) {
			Array.prototype.push.apply(finalStatements, blockResult.default([]))
			index += 2
			continue
		}

		const decoratorsResult = attemptDecoratorMacros(ctx, current)
		if (decoratorsResult) {
			Array.prototype.push.apply(finalStatements, decoratorsResult.default([]))
			index += 1
			continue
		}

		const { prepend, statement, append } = visitStatement(ctx, current, context)
		if (prepend) Array.prototype.push.apply(finalStatements, prepend)
		finalStatements.push(statement)
		if (append) Array.prototype.push.apply(finalStatements, append)
		index++
	}

	const nodeArray = ts.createNodeArray(finalStatements)
	;(nodeArray as unknown as ts.TextRange).pos = statements.pos
	;(nodeArray as unknown as ts.TextRange).end = statements.end
	return nodeArray
}
