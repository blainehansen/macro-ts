import ts = require('typescript')
import * as path from 'path'
import * as fs from 'fs'

type Dict<T> = { [key: string]: T | undefined }

type Macro =
	| { type: 'block', macro: BlockMacro }
	| { type: 'function', macro: FunctionMacro }
	// | { type: 'import', macro: ImportMacro }

type BlockMacro = (args: ts.NodeArray<ts.Statement>) => ts.Statement[]
type BlockMacroReturn = ReturnType<BlockMacro>

type FunctionMacro = (args: ts.NodeArray<ts.Expression>, typeArgs: ts.NodeArray<ts.TypeNode> | undefined) => {
	prepend?: ts.Statement[],
	expression: ts.Expression,
	append?: ts.Statement[],
}
type FunctionMacroReturn = ReturnType<FunctionMacro>

// type ImportMacro = () => {}
// type ImportMacroReturn = ReturnType<ImportMacro>

// TODO at some point these will all return errors
function attemptBlockMacro(statement: ts.Statement, block: ts.Statement | undefined): BlockMacroReturn | undefined {
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

function attemptFunctionMacro(node: ts.Node): FunctionMacroReturn | undefined {
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

const macros: Dict<Macro> = {
	die: { type: 'function', macro: args => {
		if (args.length !== 1) throw new Error()
		const target = args[0]
		return {
			prepend: [ts.createIf(
				ts.createBinary(target, ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken), ts.createIdentifier('undefined')),
				ts.createThrow(ts.createNew(ts.createIdentifier('Error'), undefined, [])), undefined,
			)],
			expression: target,
			append: [],
		}
	}},

	t: { type: 'function', macro: args => {
		if (args.length !== 1) throw new Error()
		const target = args[0]
		return {
			prepend: [ts.createIf(
				ts.createBinary(target, ts.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken), ts.createIdentifier('undefined')),
				// ts.createCall(
				// 	ts.createPropertyAccess(target, ts.createIdentifier('is_err')),
				// 	undefined, [],
				// ),
				ts.createReturn(ts.createIdentifier('undefined')), undefined,
			)],
			// expression: ts.createPropertyAccess(target, ts.createIdentifier('value')),
			expression: target,
			append: [],
		}
	}},
}


type ExpandedStatement = { prepend?: ts.Statement[], statement: ts.Statement, append?: ts.Statement[] }
function visitStatement(
	statement: ts.Statement,
	context: ts.TransformationContext,
): ExpandedStatement {
	const result = attemptVisitStatement(statement, context)
	if (!result) throw new Error()
	return result
}

function visitBlock(block: ts.Block, context: ts.TransformationContext): ts.Block {
	return ts.updateBlock(block, flatVisitStatements(block.statements, context))
}
function visitStatementIntoBlock(
	inputStatement: ts.Statement,
	context: ts.TransformationContext,
): ts.Statement {
	if (ts.isBlock(inputStatement))
		return visitBlock(inputStatement, context)

	const { prepend = [], statement, append = [] } = visitStatement(inputStatement, context)
	if (prepend.length > 0 || append.length > 0)
		return ts.createBlock(prepend.concat([statement].concat(append)))
	else return statement
}


function attemptVisitStatement(
	statement: ts.Node,
	context: ts.TransformationContext,
): ExpandedStatement | undefined {
	const prepends = [] as ts.Statement[]
	const appends = [] as ts.Statement[]

	function subsumingVisitor(node: ts.Node): ts.Node {
		const statementResult = attemptVisitStatement(node, context)
		if (statementResult) {
			const { prepend, statement, append } = statementResult
			if (prepend) Array.prototype.push.apply(prepends, prepend)
			if (append) Array.prototype.push.apply(appends, append)
			return statement
		}
		const macroResult = attemptFunctionMacro(node)
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
		return { statement: visitBlock(statement, context) }

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
			// TODO parameters can have initializers, which are expressions. maybe visit those?
			statement.typeParameters, statement.parameters, statement.type,
			statement.body ? ts.updateBlock(statement.body, flatVisitStatements(statement.body.statements, context)) : undefined,
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
			visitStatementIntoBlock(statement.thenStatement, context),
			statement.elseStatement ? visitStatementIntoBlock(statement.elseStatement, context) : undefined,
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
							flatVisitStatements(clause.statements, context),
						)
						case ts.SyntaxKind.DefaultClause: return ts.updateDefaultClause(
							clause, flatVisitStatements(clause.statements, context),
						)
					}
				}),
			),
		))

	else if (ts.isWhileStatement(statement))
		return include(ts.updateWhile(
			statement,
			visitNodeSubsuming(statement.expression),
			visitStatementIntoBlock(statement.statement, context),
		))

	else if (ts.isForStatement(statement))
		return include(ts.updateFor(
			statement,
			statement.initializer ? visitNodeSubsuming(statement.initializer) : undefined,
			statement.condition ? visitNodeSubsuming(statement.condition) : undefined,
			statement.incrementor ? visitNodeSubsuming(statement.incrementor) : undefined,
			visitStatementIntoBlock(statement.statement, context),
		))

	else if (ts.isForInStatement(statement))
		return include(ts.updateForIn(
			statement,
			visitNodeSubsuming(statement.initializer),
			visitNodeSubsuming(statement.expression),
			visitStatementIntoBlock(statement.statement, context),
		))

	else if (ts.isForOfStatement(statement))
		return include(ts.updateForOf(
			statement,
			statement.awaitModifier,
			visitNodeSubsuming(statement.initializer),
			visitNodeSubsuming(statement.expression),
			visitStatementIntoBlock(statement.statement, context),
		))

	else if (ts.isDoStatement(statement))
		return include(ts.updateDo(
			statement,
			visitStatementIntoBlock(statement.statement, context),
			visitNodeSubsuming(statement.expression),
		))

	else if (ts.isThrowStatement(statement))
		return statement.expression
			? include(ts.updateThrow(statement, visitNodeSubsuming(statement.expression)))
			: { statement }

	else if (ts.isTryStatement(statement))
		return include(ts.updateTry(
			statement,
			visitBlock(statement.tryBlock, context),
			statement.catchClause ? visitNodeSubsuming(statement.catchClause) : undefined,
			statement.finallyBlock ? visitBlock(statement.finallyBlock, context) : undefined,
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
			visitStatementIntoBlock(statement.statement, context),
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
		return { statement: ts.updateModuleBlock(statement, flatVisitStatements(statement.statements, context)) }

	else if (ts.isExportAssignment(statement))
		return include(ts.updateExportAssignment(
			statement,
			statement.decorators ? statement.decorators.map(visitNodeSubsuming) : undefined,
			statement.modifiers,
			visitNodeSubsuming(statement.expression),
		))

	// TODO the only reason we care about isExportDeclaration is because they are implicitly imports as well
	// maybe we should discourage this though
	// else if (ts.isExportDeclaration(statement))
	// 	return include(ts.updateExportDeclaration(statement))

	// else if (ts.isImportDeclaration(statement))
	// 	return include(ts.updateImportDeclaration(statement))
	// else if (ts.isImportEqualsDeclaration(statement))
	// 	return include(ts.updateImportEqualsDeclaration(statement))


	else if (
		ts.isEmptyStatement(statement) || ts.isMissingDeclaration(statement)
		|| ts.isDebuggerStatement(statement) || ts.isBreakStatement(statement) || ts.isContinueStatement(statement)
		|| ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
		|| ts.isNamespaceExportDeclaration(statement)
	)
		return { statement }

	return undefined
}

function flatVisitStatements(
	statements: ts.NodeArray<ts.Statement>,
	context: ts.TransformationContext,
): ts.NodeArray<ts.Statement> {
	let index = 0
	const finalStatements = [] as ts.Statement[]
	while (index < statements.length) {
		const current = statements[index]

		const result = attemptBlockMacro(current, statements[index + 1])
		if (result) {
			Array.prototype.push.apply(finalStatements, result)
			index += 2
			continue
		}

		const { prepend, statement, append } = visitStatement(current, context)
		if (prepend) Array.prototype.push.apply(finalStatements, prepend)
		finalStatements.push(statement)
		if (append) Array.prototype.push.apply(finalStatements, append)
		index++
	}

	return ts.createNodeArray(finalStatements)
}

const transformer: ts.TransformerFactory<ts.SourceFile> = context => sourceFile => {
	return ts.updateSourceFileNode(sourceFile, flatVisitStatements(sourceFile.statements, context))
}


const alwaysOptions = {
	strict: true, target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs,
}

function compile(fileName: string) {
	// gathering the intial files. for this I can use a normal host. no emits of any kind should happen on this pass
	// createSourceFile
	const initialOptions = { ...alwaysOptions, noEmit: true, declaration: false, sourceMap: false }
	const initialDefaultCompilerHost = ts.createCompilerHost(initialOptions)
	const initialProgram = ts.createProgram(
		[fileName], initialOptions,
		{ ...initialDefaultCompilerHost, getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
			const s = initialDefaultCompilerHost.readFile(fileName)
			if (s === undefined) return undefined
			return ts.createSourceFile(fileName, s, languageVersion, /* setParentNodes */ true)
		} }
	)

	// transform based on macros, and print out the ast of each file into a map of paths to these transformed sources
	// there's an optimization sitting here where if a file has no macros we can cache the sourceFile and keep it around for the final pass
	const transformedSourceMap: Dict<string> = {}
	const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
	for (const sourceFile of initialProgram.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue
		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
		transformedSourceMap[sourceFile.fileName] = printer.printFile(newSourceFile)
		console.log()
		console.log(sourceFile.fileName)
		console.log()
		console.log(transformedSourceMap[sourceFile.fileName])
		console.log()
	}

	// then I gather all the files again! on this pass I want to use a host that reads the files from my map, and writes files to a map of outputs that I want to possibly process further (at least the js)
	// const transformedRoundOptions = { ...alwaysOptions, outDir: 'dist', declaration: true, sourceMap: true }
	const transformedRoundOptions = { ...alwaysOptions, outDir: 'dist', declaration: false, sourceMap: false }
	const defaultCompilerHost = ts.createCompilerHost(transformedRoundOptions)
	const capturedOutput: Dict<string> = {}
	// https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#customizing-module-resolution
	const capturingCompilerHost: ts.CompilerHost = {
		...defaultCompilerHost,
		getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
			// console.log('getSourceFile')
			// console.log(fileName)
			// console.log()
			const transformedSource = transformedSourceMap[fileName]
			return transformedSource !== undefined
				? ts.createSourceFile(fileName, transformedSource, languageVersion)
				: defaultCompilerHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
		},
		writeFile(fileName, content) {
			// console.log()
			// console.log('writeFile')
			// console.log(fileName)
			// console.log()
			// console.log(content)
			// console.log()
			capturedOutput[fileName] = content
		},
	}
	const transformedProgram = ts.createProgram([fileName], transformedRoundOptions, capturingCompilerHost)

	const diagnostics = ts.getPreEmitDiagnostics(transformedProgram)
	// use diagnostic.category === ts.DiagnosticCategory.Error to see if any of these are actually severe
	// if (diagnostics.length)
	for (const diagnostic of diagnostics)
		console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
	const emitResult = transformedProgram.emit()

	// const exitCode = emitResult.emitSkipped ? 1 : 0
	// process.exit(exitCode)
}

compile('./app/main.ts')




// just to get it off my mind, we'll use rollup to do the actual tree shaking and its plugin ecosystem, minification etc
// https://rollupjs.org/guide/en/#javascript-api
