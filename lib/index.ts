import ts = require('typescript')
import * as path from 'path'
import * as fs from 'fs'

type Dict<T> = { [key: string]: T | undefined }

type Macro =
	| {
		type: 'function',
		macro: (args: ts.NodeArray<ts.Expression>) => {
			prepend: ts.Statement[]
			expression: ts.Expression,
			append: ts.Statement[]
		}
	}

type MacroArgs =
	| { type: 'function', typeArguments: ts.NodeArray<ts.TypeNode> | undefined, args: ts.NodeArray<ts.Expression> }

type MacroEntry = [string, MacroArgs]

function macroType(node: ts.Node): MacroEntry | undefined {
	if (ts.isCallExpression(node)) {
		if (
			!ts.isNonNullExpression(node.expression)
			|| !ts.isNonNullExpression(node.expression.expression)
			|| !ts.isIdentifier(node.expression.expression.expression)
		)
			return undefined

		return [
			node.expression.expression.expression.text,
			{ type: 'function', typeArguments: node.typeArguments, args: node.arguments },
		]
	}
}

const macros: Dict<Macro> = {
	t: { type: 'function', macro: args => {
		if (args.length !== 0) throw new Error()
		// if (r.is_err()) return r
		// const v = r.value
		const target = args[0]
		return {
			expression: ts.createPropertyAccess(target, ts.createIdentifier('value')),
			prepend: [ts.createIf(
				ts.createCall(
					ts.createPropertyAccess(target, ts.createIdentifier('is_err')),
					undefined, [],
				),
				ts.createReturn(target), undefined,
			)],
			append: []
		}
	} }
}

function isStatement(node: ts.Node): node is ts.Statement {
	return ts.isVariableStatement(node)
}

function findParent<N extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is N): N | undefined {
  if (!node.parent) return undefined
  if (predicate(node.parent)) return node.parent
  return findParent(node.parent, predicate)
}

const transformer: ts.TransformerFactory<ts.SourceFile> = context => sourceFile => {
	const visitor: ts.Visitor = node => {
		const maybeEntry = macroType(node)
		// TODO have to think about calling macros on the args of macros?
		// we definitely won't recurse on the return values of macros. they can do that themselves
		if (!maybeEntry) return ts.visitEachChild(node, visitor, context)

		const [name, { args }] = maybeEntry
		const macro = macros[name]
		if (!macro) throw new Error()

		// you can achieve this by having this visitor notice all statements
		// then save the statement, and create a local visitor that just walks the children of that statement
		// this visitor can have a closure that builds prepend/append statements
		// and once the children have been walked, return the prepend.concat([self]).concat(append)
		// since we've captured the statement we can guarantee it won't be replaced?

		// another hack is to just make this macro a block one for now, passing the ident and result
		// another is to use one of the nodearray visitors instead, or something like that
		const { expression, prepend, append } = macro.macro(args)
		if (prepend.length !== 0 || append.length !== 0) {
			const immediateParent

			const parent = findParent(node, isStatement)
			// if (parent)
			console.log(parent)
		}

		return expression
	}

	return ts.visitNode(sourceFile, visitor)
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
	}

	// then I gather all the files again! on this pass I want to use a host that reads the files from my map, and writes files to a map of outputs that I want to possibly process further (at least the js)
	const transformedRoundOptions = { ...alwaysOptions, outDir: 'dist', declaration: true, sourceMap: true }
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
			console.log('writeFile')
			console.log(fileName)
			console.log(content)
			console.log()
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
	console.log(emitResult)

	// const exitCode = emitResult.emitSkipped ? 1 : 0
	// process.exit(exitCode)
}

compile('./app/main.ts')
