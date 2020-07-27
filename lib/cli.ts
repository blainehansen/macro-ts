import * as fs from 'fs'
import * as nodepath from 'path'
import yaml = require('js-yaml')
import ts = require('typescript')
import * as c from '@ts-std/codec'
import { Result, Ok, Err } from '@ts-std/monads'

import { Dict } from './utils'
import { createTransformer, Macro, SourceChannel } from './transformer'

const alwaysOptions = {
	strict: true, moduleResolution: ts.ModuleResolutionKind.NodeJs,
}
const nonEmitOptions = {
	...alwaysOptions,
	noEmit: true, declaration: false, sourceMap: false,
}
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

const GlobalConfig = c.object({
	// macros: c.optional(c.string),
	macros: c.string,
})
type GlobalConfig = c.TypeOf<typeof GlobalConfig>

function parseGlobalConfig(fileName: string) {
	return Result.attempt(() => yaml.safeLoad(fs.readFileSync(fileName, 'utf8')))
		.change_err(error => error.message)
		.try_change(obj => GlobalConfig.decode(obj))
}

function isNodeExported(node: ts.Node): boolean {
	return (
		(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0
		|| (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
	)
}


function check(entryFile: string) {
	const workingDir = process.cwd()
	const entryDir = nodepath.relative(workingDir, nodepath.dirname(entryFile))

	const configPath = nodepath.join(entryDir, '.macro-ts.yml')
	const globalconfig = parseGlobalConfig(configPath).unwrap()

	const macrosOptions = {
		...alwaysOptions, noEmit: false, noEmitOnError: true, declaration: false, sourceMap: false,
		module: ts.ModuleKind.CommonJS, outDir: './target/.macros',
	}
	// TODO a good idea to add some hash/caching
	const macrosEntry = nodepath.join(entryDir, globalconfig.macros)
	const macrosSourceFile = ts.createSourceFile(macrosEntry, fs.readFileSync(macrosEntry, 'utf8'), ts.ScriptTarget.ESNext)
	let foundMacros = false
	const { transformed: [newMacrosSourceFile] } = ts.transform(macrosSourceFile, [() => sourceFile => {
		// const { currentDir, currentFile } = dirMaker(sourceFile.fileName)
		// const ctx = { macros, sendSources, current: { workingDir, currentDir, currentFile }, readFile }
		const finalStatements: ts.Statement[] = []
		for (const statement of sourceFile.statements) {
			if (!(
				ts.isVariableStatement(statement)
				&& isNodeExported(statement)
				&& statement.declarationList.declarations.length === 1
				&& ts.isIdentifier(statement.declarationList.declarations[0].name)
				&& statement.declarationList.declarations[0].name.text === 'macros'
			)) {
				finalStatements.push(statement)
				continue
			}

			foundMacros = true
			finalStatements.push(ts.updateVariableStatement(
				statement, statement.modifiers,
				ts.updateVariableDeclarationList(
					statement.declarationList, [ts.updateVariableDeclaration(
						statement.declarationList.declarations[0],
						statement.declarationList.declarations[0].name,
						ts.createTypeReferenceNode(ts.createIdentifier('___Dict'), [
							ts.createTypeReferenceNode(
								ts.createIdentifier('___Macro'),
								undefined,
							),
						]),
						statement.declarationList.declarations[0].initializer,
					)],
				),
			))
		}

		return ts.updateSourceFileNode(sourceFile, finalStatements)
	}])
	if (!foundMacros)
		process.exit(1)
	console.log(printer.printFile(newMacrosSourceFile))
	// transformedTsSources[script.path] = printer.printFile(newMacrosSourceFile)

	// const macrosProgram = ts.createProgram([], macrosOptions)
	// const emitResult = macrosProgram.emit()
	// const wereErrors = emitResult.emitSkipped
	// if (wereErrors) {
	// 	for (const diagnostic of emitResult.diagnostics)
	// 		console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
	// 	process.exit(1)
	// }

	// const macrosPath = nodepath.join(workingDir, './target/.macros/', entryDir, nodepath.basename(globalconfig.macros, '.ts'))
	// const macros: Dict<Macro> = require(macrosPath).macros


	// function dirMaker(sourceFileName: string) {
	// 	const currentDir = nodepath.relative(workingDir, nodepath.dirname(sourceFileName))
	// 	const currentFile = nodepath.basename(sourceFileName)
	// 	return { currentDir, currentFile }
	// }
	// const transformedTsSources: Dict<string> = {}
	// const receivePayload: SourceChannel<undefined> = script => {
	// 	if (!script) return
	// 	const sourceFile = ts.createSourceFile(script.path, script.source, ts.ScriptTarget.ESNext)
	// 	const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
	// 	transformedTsSources[script.path] = printer.printFile(newSourceFile)
	// }
	// const transformer = createTransformer(
	// 	macros, receivePayload, workingDir,
	// 	path => Result.attempt(() => fs.readFileSync(path, 'utf8')).ok_undef(),
	// 	dirMaker,
	// )


	// const initialProgram = ts.createProgram([entryFile], nonEmitOptions)
	// for (const sourceFile of initialProgram.getSourceFiles()) {
	// 	if (sourceFile.isDeclarationFile) continue
	// 	const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
	// 	transformedTsSources[sourceFile.fileName] = printer.printFile(newSourceFile)
	// }

	// const defaultCompilerHost = ts.createCompilerHost(nonEmitOptions)
	// // https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#customizing-module-resolution
	// const capturingCompilerHost: ts.CompilerHost = {
	// 	...defaultCompilerHost,
	// 	getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
	// 		if (!fileName.includes('node_modules')) {
	// 			console.log('getSourceFile')
	// 			console.log(fileName)
	// 			console.log()
	// 		}
	// 		const transformedSource = transformedTsSources[nodepath.relative(workingDir, fileName)]
	// 		return transformedSource !== undefined
	// 			? ts.createSourceFile(fileName, transformedSource, languageVersion)
	// 			: defaultCompilerHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
	// 	},
	// 	fileExists(fileName) {
	// 		if (!fileName.includes('node_modules')) {
	// 			console.log('fileExists')
	// 			console.log(fileName)
	// 			console.log()
	// 		}
	// 		return nodepath.relative(workingDir, fileName) in transformedTsSources || defaultCompilerHost.fileExists(fileName)
	// 	},
	// 	// getDefaultLibFileName: () => "lib.d.ts",
	// 	// getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
	// 	// getDirectories: path => ts.sys.getDirectories(path),
	// 	// getCanonicalFileName: fileName => ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
	// 	// getNewLine: () => ts.sys.newLine,
	// 	// useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
	// 	// readFile,
	// 	// resolveModuleNames,
	// }
	// const transformedProgram = ts.createProgram([entryFile], nonEmitOptions, capturingCompilerHost)
	// const diagnostics = ts.getPreEmitDiagnostics(transformedProgram)
	// // use diagnostic.category === ts.DiagnosticCategory.Error to see if any of these are actually severe
	// if (diagnostics.length) {
	// 	for (const diagnostic of diagnostics)
	// 		console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
	// 	process.exit(1)
	// }
}

// the check command should accept an optional file/directory, but by default look for src/_main.ts?

check('./app/main.ts')
