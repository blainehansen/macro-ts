import ts = require('typescript')
import { Dict, PickVariants, AbstractFileSystem } from './utils'

export type Macro<S = undefined> =
	| { type: 'block', macro: BlockMacro }
	| { type: 'function', macro: FunctionMacro }
	| { type: 'import', macro: ImportMacro<S> }

export type BlockMacro = (args: ts.NodeArray<ts.Statement>) => ts.Statement[]
export type BlockMacroReturn = ReturnType<BlockMacro>
export function BlockMacro(macro: BlockMacro): PickVariants<Macro, 'type', 'block'> {
	return { type: 'block', macro }
}

export type FunctionMacro = (args: ts.NodeArray<ts.Expression>, typeArgs: ts.NodeArray<ts.TypeNode> | undefined) => {
	prepend?: ts.Statement[],
	expression: ts.Expression,
	append?: ts.Statement[],
}
export type FunctionMacroReturn = ReturnType<FunctionMacro>
export function FunctionMacro(macro: FunctionMacro): PickVariants<Macro, 'type', 'function'> {
	return { type: 'function', macro }
}

export type FileContext = {
	workingDir: string,
	currentDir: string, currentFile: string
}

export type ImportMacro<S> = (
	ctx: FileContext,
	targetPath: string,
	targetSource: string,
	clause: { isExport: false, clause: ts.ImportClause | undefined } | { isExport: true, clause: ts.NamedExportBindings | undefined },
	args: ts.NodeArray<ts.Expression>,
	typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
) => {
	statements: ts.Statement[],
	targetTs?: string,
	sources: Dict<S>,
}
export type ImportMacroReturn<S> = ReturnType<ImportMacro<S>>
export function ImportMacro<S>(macro: ImportMacro<S>): PickVariants<Macro<S>, 'type', 'import'> {
	return { type: 'import', macro }
}

export type SourceChannel<S> = (sources: Dict<S>, targetTs: { path: string, source: string } | undefined) => void

type CompileContext<S> = {
	macros: Dict<Macro<S>>,
	sendSources: SourceChannel<S>,
	current: FileContext,
	// TODO I'm not sure this is the right idea. we have to assume what path they'll be reading from
	fs: AbstractFileSystem,
}
export function createTransformer<S>(
	macros: Dict<Macro<S>>,
	sendSources: SourceChannel<S>,
	workingDir: string,
	fs: AbstractFileSystem,
	dirMaker: (sourceFileName: string) => { currentDir: string, currentFile: string },
): ts.TransformerFactory<ts.SourceFile> {
	return context => sourceFile => {
		const { currentDir, currentFile } = dirMaker(sourceFile.fileName)
		const ctx = { macros, sendSources, current: { workingDir, currentDir, currentFile }, fs }
		return ts.updateSourceFileNode(sourceFile, flatVisitStatements(ctx, sourceFile.statements, context))
	}
}


// TODO at some point these will all return Result
// TODO all of these macro could choose to access the filesystem, so we should make all of them async
function attemptBlockMacro<S>(
	{ macros }: CompileContext<S>,
	statement: ts.Statement,
	block: ts.Statement | undefined,
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

	const macro = macros[statement.expression.expression.expression.text]
	if (!macro || macro.type !== 'block') throw new Error()

	return macro.macro(block.statements)
}

function attemptFunctionMacro<S>(
	{ macros }: CompileContext<S>,
	node: ts.Node,
): FunctionMacroReturn | undefined {
	if (!(
		ts.isCallExpression(node)
		&& ts.isNonNullExpression(node.expression)
		&& ts.isNonNullExpression(node.expression.expression)
		&& ts.isIdentifier(node.expression.expression.expression)
	))
		return undefined

	const macro = macros[node.expression.expression.expression.text]
	if (!macro || macro.type !== 'function') throw new Error()
	return macro.macro(node.arguments, node.typeArguments)
}

function attemptImportMacro<S>(
	{ macros, current, sendSources, fs }: CompileContext<S>,
	declaration: ts.ImportDeclaration | ts.ExportDeclaration,
): ts.Statement[] | undefined {
	const moduleSpecifier = declaration.moduleSpecifier
	if (!(
		moduleSpecifier
		&& ts.isCallExpression(moduleSpecifier)
		&& ts.isNonNullExpression(moduleSpecifier.expression)
		&& ts.isNonNullExpression(moduleSpecifier.expression.expression)
		&& ts.isIdentifier(moduleSpecifier.expression.expression.expression)
	))
		return undefined

	const pathSpecifier = moduleSpecifier.arguments[0]
	if (!pathSpecifier || !ts.isStringLiteral(pathSpecifier)) throw new Error()

	const macro = macros[moduleSpecifier.expression.expression.expression.text]
	if (!macro || macro.type !== 'import') throw new Error()

	const path = pathSpecifier.text
	const source = fs.readFile(path)
	if (source === undefined) throw new Error()

	const { statements, sources, targetTs  } = macro.macro(
		current, path, source,
		ts.isExportDeclaration(declaration)
			? { isExport: true, clause: declaration.exportClause }
			: { isExport: false, clause: declaration.importClause },
		ts.createNodeArray(moduleSpecifier.arguments.slice(1)),
		moduleSpecifier.typeArguments,
	)
	sendSources(sources, targetTs ? { path, source: targetTs } : undefined)

	return statements
}



type ExpandedStatement = { prepend?: ts.Statement[], statement?: ts.Statement, append?: ts.Statement[] }
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
	if (!statement) throw new Error()
	return statement
}


function attemptVisitStatement<S>(
	ctx: CompileContext<S>,
	statement: ts.Node,
	context: ts.TransformationContext,
): ExpandedStatement | undefined {
	const prepends = [] as ts.Statement[]
	const appends = [] as ts.Statement[]

	function subsumingVisitor(node: ts.Node): ts.Node | undefined {
		const statementResult = attemptVisitStatement(ctx, node, context)
		if (statementResult) {
			const { prepend, statement, append } = statementResult
			if (prepend) Array.prototype.push.apply(prepends, prepend)
			if (append) Array.prototype.push.apply(appends, append)
			return statement
		}
		// TODO expand macros inside node.arguments?
		const macroResult = attemptFunctionMacro(ctx, node)
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

	else if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
		const statements = attemptImportMacro(ctx, statement)
		if (statements) {
			const [statement, ...append] = statements
			return { statement, append }
		}
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

		// TODO expand macros inside node.statements?
		const result = attemptBlockMacro(ctx, current, statements[index + 1])
		if (result) {
			Array.prototype.push.apply(finalStatements, result)
			index += 2
			continue
		}

		const { prepend, statement, append } = visitStatement(ctx, current, context)
		if (prepend) Array.prototype.push.apply(finalStatements, prepend)
		if (statement) finalStatements.push(statement)
		if (append) Array.prototype.push.apply(finalStatements, append)
		index++
	}

	return ts.createNodeArray(finalStatements)
}

// const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true })
// function _printNodes(nodes: ts.Node[]) {
// 	const resultFile = ts.createSourceFile('', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
// 	let printed = ''
// 	for (const node of nodes)
// 		printed += '\n' + printer.printNode(ts.EmitHint.Unspecified, node, resultFile)

// 	return printed
// }
