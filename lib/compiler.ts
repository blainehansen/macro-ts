import ts = require('typescript')
// import * as path from 'path'
// import * as fs from 'fs'

import { Dict } from './utils'
import { createTransformer, Macro } from './transformer'

const alwaysOptions = {
	strict: true, target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs,
}

type File = { filename: string, source: string }

// <T extends ImportMacroBasic>
export function compile(fileName: string, macros: Dict<Macro>) {
	const initialOptions = { ...alwaysOptions, noEmit: true, declaration: false, sourceMap: false }
	// const initialDefaultCompilerHost = ts.createCompilerHost(initialOptions)
	// const initialProgram = ts.createProgram(
	// 	[fileName], initialOptions,
	// 	{ ...initialDefaultCompilerHost, getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
	// 		const s = initialDefaultCompilerHost.readFile(fileName)
	// 		if (s === undefined) return undefined
	// 		return ts.createSourceFile(fileName, s, languageVersion, /* setParentNodes */ false)
	// 	}},
	// )
	const initialProgram = ts.createProgram([fileName], initialOptions)

	const transformer = createTransformer(macros)

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
