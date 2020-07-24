import * as fs from 'fs'
import * as nodepath from 'path'
import yaml = require('js-yaml')
import ts = require('typescript')
import * as c from '@ts-std/codec'
import { Result, Ok, Err } from '@ts-std/monads'

// import { transform } from './compiler'
import { createTransformer, Macro, SourceChannel } from './transformer'

const alwaysOptions = {
	strict: true, target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs,
}
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

const GlobalConfig = c.object({
	macros: c.optional(c.string),
})
type GlobalConfig = c.TypeOf<typeof GlobalConfig>

function parseGlobalConfig(fileName: string) {
	return Result.attempt(() => yaml.safeLoad(fs.readFileSync(fileName, 'utf8')))
		.change_err(error => error.message)
		.try_change(obj => GlobalConfig.decode(obj))
}


function check(entryFile: string) {
	const workingDir = process.cwd()
	console.log(workingDir)

	// for now we know exactly where it is
	const entryDir = nodepath.relative(workingDir, nodepath.dirname(entryFile))
	console.log(entryDir)

	const configPath = nodepath.join(entryDir, '.macro-ts.yml')
	console.log(configPath)
	const globalconfig = parseGlobalConfig(configPath).unwrap()
	console.log(globalconfig)

	// function dirMaker(sourceFileName: string) {
	// 	const currentDir = nodepath.relative(workingDir, nodepath.dirname(sourceFileName))
	// 	const currentFile = nodepath.basename(sourceFileName)
	// 	return { currentDir, currentFile }
	// }

	// const receivePayload: SourceChannel<undefined> = script => {
	// 	if (script) {
	// 		const sourceFile = ts.createSourceFile(script.path, script.source, alwaysOptions.target)
	// 		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
	// 		transformedTsSources[script.path] = printer.printFile(newSourceFile)
	// 	}
	// 	// addAllEntries(sources, unprocessedSources)
	// }
	// const transformer = createTransformer(macros, receivePayload, workingDir, fs, dirMaker)

	// const entryScripts = new Set<string>()
	// for (const [path, { importer }] of Object.entries(entries)) {
	// 	if (importer === 'ts') {
	// 		entryScripts.add(path)
	// 		continue
	// 	}

	// 	const macro = macros[importer]
	// 	if (macro === undefined || macro.type !== 'import') throw new Error()
	// 	const source = fs.readFile(path)
	// 	if (source === undefined) throw new Error()
	// 	const { currentDir, currentFile } = dirMaker(path)
	// 	const { sources, targetTs } = macro.macro({ workingDir, currentDir, currentFile }, path, source)
	// 	const tsPath = path + '.ts'
	// 	entryScripts.add(tsPath)
	// 	receivePayload({ path: tsPath, source: targetTs }, sources)
	// }


	// const initialOptions = { ...alwaysOptions, noEmit: true, declaration: false, sourceMap: false }
	// // TODO need to intervene in module resolution so this will discover any transformed entryScripts
	// const initialProgram = ts.createProgram([...entryScripts], initialOptions)

	// for (const sourceFile of initialProgram.getSourceFiles()) {
	// 	if (sourceFile.isDeclarationFile) continue
	// 	// TODO probably check here that this isn't one of the entry files, it's already been transformed

	// 	const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
	// 	transformedTsSources[sourceFile.fileName] = printer.printFile(newSourceFile)
	// 	// if (sourceFile.fileName !== 'app/App.ts') continue
	// 	// console.log('sourceFile.fileName:', sourceFile.fileName)
	// 	// console.log('transformedTsSources[sourceFile.fileName]')
	// 	// console.log(transformedTsSources[sourceFile.fileName])
	// 	// console.log()
	// }

	// const outputResources = sourceConverter(unprocessedSources)

	// const transformedRoundOptions = {
	// 	...alwaysOptions, declaration: false, sourceMap: false,
	// 	// outDir: 'dist',
	// 	// module: ts.ModuleKind.AMD, outFile: "./app/App.js",
	// }
	// const defaultCompilerHost = ts.createCompilerHost(transformedRoundOptions)
	// // https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#customizing-module-resolution
	// const capturingCompilerHost: ts.CompilerHost = {
	// 	...defaultCompilerHost,
	// 	getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
	// 		if (!fileName.includes('node_modules')) {
	// 			console.log('getSourceFile')
	// 			console.log(fileName)
	// 			console.log()
	// 		}
	// 		const transformedSource = transformedTsSources[fs.relative(process.cwd(), fileName)]
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
	// 		return fs.relative(process.cwd(), fileName) in transformedTsSources || defaultCompilerHost.fileExists(fileName)
	// 	},
	// 	writeFile(fileName, content) {
	// 		console.log()
	// 		console.log('writeFile')
	// 		console.log(fileName)
	// 		// console.log()
	// 		// console.log(content)
	// 		// console.log()
	// 		outputResources[fileName] = jsLifter(
	// 			fileName, content,
	// 			fileName.endsWith('.d.ts') ? '.d.ts'
	// 				: fileName.endsWith('.js.map') ? '.js.map'
	// 				: '.js'
	// 		)
	// 	},
	// 	// getDefaultLibFileName: () => "lib.d.ts",
	// 	// getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
	// 	// getDirectories: path => ts.sys.getDirectories(path),
	// 	// getCanonicalFileName: fileName => ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
	// 	// getNewLine: () => ts.sys.newLine,
	// 	// useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
	// 	// fileExists,
	// 	// readFile,
	// 	// resolveModuleNames,
	// }
	// const transformedProgram = ts.createProgram([...entryScripts], transformedRoundOptions, capturingCompilerHost)
	// const diagnostics = ts.getPreEmitDiagnostics(transformedProgram)
	// // use diagnostic.category === ts.DiagnosticCategory.Error to see if any of these are actually severe
	// // if (diagnostics.length)
	// for (const diagnostic of diagnostics)
	// 	console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
	// // const emitResult = transformedProgram.emit()
	// transformedProgram.emit()


	// // const exitCode = emitResult.emitSkipped ? 1 : 0
	// // process.exit(exitCode)

	// const outputFiles = finalizer(entryScripts, outputResources)
	// for (const [path, content] of Object.entries(outputFiles))
	// 	fs.writeFile(path, content)
}

check('./app/main.ts')
