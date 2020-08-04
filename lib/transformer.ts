import ts = require('typescript')
import { Dict, PickVariants } from './utils'

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true })
function printNodes(nodes: ts.Node[]) {
	const resultFile = ts.createSourceFile('', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
	let printed = ''
	for (const node of nodes)
		printed += '\n' + printer.printNode(ts.EmitHint.Unspecified, node, resultFile)

	return printed
}

export type Macro<S = undefined> =
	| { type: 'block', execute: BlockMacro }
	| { type: 'function', execute: FunctionMacro }
	| { type: 'decorator', execute: DecoratorMacro }
	| { type: 'import', execute: ImportMacro<S> }

export type SourceChannel<S> = (targetTs: { path: string, source: string }, sources: Dict<S>) => void

type CompileContext<S> = {
	macros: Dict<Macro<S>>,
	sendSources: SourceChannel<S>,
	current: FileContext,
	// TODO I'm not sure this is the right idea. we have to assume what path they'll be reading from
	readFile: (path: string) => string | undefined,
}
export function createTransformer<S>(
	macros: Dict<Macro<S>>,
	sendSources: SourceChannel<S>,
	workingDir: string,
	readFile: (path: string) => string | undefined,
	dirMaker: (sourceFileName: string) => { currentDir: string, currentFile: string },
): ts.TransformerFactory<ts.SourceFile> {
	return context => sourceFile => {
		const { currentDir, currentFile } = dirMaker(sourceFile.fileName)
		const ctx = { macros, sendSources, current: { workingDir, currentDir, currentFile }, readFile }
		return ts.updateSourceFileNode(sourceFile, flatVisitStatements(ctx, sourceFile.statements, context))
	}
}


export type BlockMacro = (args: ts.NodeArray<ts.Statement>) => ts.Statement[]
export type BlockMacroReturn = ReturnType<BlockMacro>
export function BlockMacro(execute: BlockMacro): PickVariants<Macro, 'type', 'block'> {
	return { type: 'block', execute }
}

// TODO at some point these will all return Result
// TODO all of these macros could choose to access the filesystem, so we should make all of them async
function attemptBlockMacro<S>(
	ctx: CompileContext<S>,
	statement: ts.Statement,
	block: ts.Statement | undefined,
	context: ts.TransformationContext,
): BlockMacroReturn | undefined {
	if (!(
		ts.isExpressionStatement(statement)
		&& ts.isNonNullExpression(statement.expression)
		&& ts.isNonNullExpression(statement.expression.expression)
		&& ts.isIdentifier(statement.expression.expression.expression)
	))
		return undefined

	if (!block || !ts.isBlock(block))
		throw new Error('this is probably a mistake')

	const macro = ctx.macros[statement.expression.expression.expression.text]
	if (!macro || macro.type !== 'block') throw new Error()

	return macro.execute(flatVisitStatements(ctx, block.statements, context))
}


export type FunctionMacro = (args: ts.NodeArray<ts.Expression>, typeArgs: ts.NodeArray<ts.TypeNode> | undefined) => {
	prepend?: ts.Statement[],
	expression: ts.Expression,
	append?: ts.Statement[],
}
export type FunctionMacroReturn = ReturnType<FunctionMacro>
export function FunctionMacro(execute: FunctionMacro): PickVariants<Macro, 'type', 'function'> {
	return { type: 'function', execute }
}

function attemptFunctionMacro<S>(
	ctx: CompileContext<S>,
	node: ts.Node,
	argumentsVisitor: (args: ts.NodeArray<ts.Expression>) => ts.NodeArray<ts.Expression>,
): FunctionMacroReturn | undefined {
	if (!(
		ts.isCallExpression(node)
		&& ts.isNonNullExpression(node.expression)
		&& ts.isNonNullExpression(node.expression.expression)
		&& ts.isIdentifier(node.expression.expression.expression)
	))
		return undefined

	const macro = ctx.macros[node.expression.expression.expression.text]
	if (!macro || macro.type !== 'function') throw new Error()
	return macro.execute(argumentsVisitor(node.arguments), node.typeArguments)
}


export type DecoratorMacro = (
	statement: ts.Statement,
	args: ts.NodeArray<ts.Expression> | undefined,
	typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
) => ts.Statement[]
export type DecoratorMacroReturn = ReturnType<DecoratorMacro>
export function DecoratorMacro(execute: DecoratorMacro): PickVariants<Macro, 'type', 'decorator'> {
	return { type: 'decorator', execute }
}

function attemptDecoratorMacros<S>(
	ctx: CompileContext<S>,
	statement: ts.Statement,
	// argumentsVisitor: (args: ts.NodeArray<ts.Expression>) => ts.NodeArray<ts.Expression>,
): DecoratorMacroReturn | undefined {
	if (statement.decorators === undefined)
		return undefined

	const statements = [] as ts.Statement[]
	for (const decorator of statement.decorators) {
		const { expression } = decorator
		if (!(
			ts.isCallExpression(expression)
			&& ts.isNonNullExpression(expression.expression)
			&& ts.isNonNullExpression(expression.expression.expression)
			&& ts.isIdentifier(expression.expression.expression.expression)
		))
			throw new Error("normal decorators are lame")

		const macro = ctx.macros[expression.expression.expression.expression.text]
		if (!macro || macro.type !== 'decorator') throw new Error()
		const additionalStatements = macro.execute(statement, expression.arguments, expression.typeArguments)
		Array.prototype.push.apply(statements, additionalStatements)
	}

	return statements
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

export type ImportMacro<S> = (
	ctx: FileContext,
	targetPath: string,
	targetSource: string,
) => {
	statements: ts.Statement[],
	sources?: Dict<S>,
}
export type ImportMacroReturn<S> = ReturnType<ImportMacro<S>>
export function ImportMacro<S>(execute: ImportMacro<S>): PickVariants<Macro<S>, 'type', 'import'> {
	return { type: 'import', execute }
}

function attemptImportMacro<S>(
	{ macros, current, sendSources, readFile }: CompileContext<S>,
	declaration: ts.ImportDeclaration | ts.ExportDeclaration,
): ts.StringLiteral | undefined {
	const moduleSpecifier = declaration.moduleSpecifier
	if (!(
		moduleSpecifier
		&& ts.isCallExpression(moduleSpecifier)
		&& ts.isNonNullExpression(moduleSpecifier.expression)
		&& ts.isNonNullExpression(moduleSpecifier.expression.expression)
		&& ts.isIdentifier(moduleSpecifier.expression.expression.expression)
	))
		return undefined

	if (moduleSpecifier.arguments.length !== 1) throw new Error()
	const pathSpecifier = moduleSpecifier.arguments[0]
	if (!ts.isStringLiteral(pathSpecifier)) throw new Error()

	if (moduleSpecifier.typeArguments) throw new Error()

	const macro = macros[moduleSpecifier.expression.expression.expression.text]
	if (!macro || macro.type !== 'import') throw new Error()

	const path = pathSpecifier.text
	const source = readFile(path)
	if (source === undefined) throw new Error()

	const { sources = {}, statements  } = macro.execute(current, path, source)
	sendSources({ path: path + '.ts', source: printNodes(statements) }, sources)

	return ts.createStringLiteral(path)
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
			const { prepend, expression, append } = macroResult
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
		return ts.createNodeArray(args.map(visitNodeSubsuming))
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
			Array.prototype.push.apply(finalStatements, blockResult)
			index += 2
			continue
		}

		const decoratorsResult = attemptDecoratorMacros(ctx, current)
		if (decoratorsResult) {
			Array.prototype.push.apply(finalStatements, decoratorsResult)
			index += 1
			continue
		}

		const { prepend, statement, append } = visitStatement(ctx, current, context)
		if (prepend) Array.prototype.push.apply(finalStatements, prepend)
		finalStatements.push(statement)
		if (append) Array.prototype.push.apply(finalStatements, append)
		index++
	}

	return ts.createNodeArray(finalStatements)
}
