import ts = require('typescript')
// import * as nodepath from 'path'

import { Dict, AbstractFileSystem } from './utils'
import { createTransformer, Macro, SourceChannel } from './transformer'

const alwaysOptions = {
	strict: true, target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs,
}

// class NodeMemoryFileSystem extends AbstractFileSystem {
// 	protected files: Dict<string | Buffer> = {}

// 	fileExists(path: string) { return path in this.files }

// 	readFile(path: string): string | undefined
// 	readFile(path: string, encoding: 'utf8'): string | undefined
// 	readFile(path: string, encoding: string): Buffer | undefined
// 	readFile(path: string, encoding = 'utf8') {
// 		const file = this.files[path]
// 		if (file === undefined) return undefined
// 		if (typeof file === 'string')
// 		if (encoding === undefined || encoding === 'utf8')
// 	}

// 	writeFile(path: string, content: string | Buffer) { this.files[path] = content }
// 	dirname(path: string) { return nodepath.dirname(path) }
// 	basename(path: string) { return nodepath.basename(path) }
// 	relative(fromPath: string, toPath: string) { return nodepath.relative(fromPath, toPath) }
// }

export type Producer<T> = T | (() => T)
export type EntryFiles = Dict<{ lang: string }>

function addAllEntries<T>(src: Dict<T>, dest: Dict<T>) {
	// TODO perhaps get mad at overwrites
	for (const key in src)
		dest[key] = src[key]
}

export function compile<S>(
	fs: AbstractFileSystem,
	entries: EntryFiles,
	macros: Dict<Macro<S>>,
	sourceConverter: (sources: Dict<S>) => Dict<string | Buffer>,
	finalizer: (entries: EntryFiles, resources: Dict<string | Buffer>) => Dict<string | Buffer>,
): void {
	const transformedTsSourceMap: Dict<string> = {}
	const unprocessedSources: Dict<S> = {}

	const workingDir = fs.getWorkingDirectory()
	function dirMaker(sourceFileName: string) {
		const currentDir = fs.relative(workingDir, fs.dirname(sourceFileName))
		const currentFile = fs.basename(sourceFileName)
		return { currentDir, currentFile }
	}
	const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
	const receivePayload: SourceChannel<S> = (sources, script) => {
		if (script) {
			const sourceFile = ts.createSourceFile(script.path, script.source, alwaysOptions.target)
			const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
			transformedTsSourceMap[script.path] = printer.printFile(newSourceFile)
		}
		addAllEntries(sources, unprocessedSources)
	}
	const transformer = createTransformer(macros, receivePayload, workingDir, fs, dirMaker)

	const entryScripts = [] as string[]
	for (const [path, { lang }] of Object.entries(entries)) {
		if (lang === 'ts') {
			entryScripts.push(path)
			continue
		}

		const macro = macros[lang]
		if (macro === undefined || macro.type !== 'import') throw new Error()
		const source = fs.readFile(path)
		if (source === undefined) throw new Error()
		const { currentDir, currentFile } = dirMaker(path)
		const { /*statements, */ sources, targetTs } = macro.macro(
			{ workingDir, currentDir, currentFile }, path, source,
			{ isExport: false, clause: undefined }, ts.createNodeArray([]), undefined,
		)
		if (targetTs)
			entryScripts.push(path)
		receivePayload(sources, targetTs ? { path, source: targetTs } : undefined)
	}


	const initialOptions = { ...alwaysOptions, noEmit: true, declaration: false, sourceMap: false }
	// TODO need to intervene in module resolution so this will discover any transformed entryScripts
	const initialProgram = ts.createProgram(entryScripts, initialOptions)

	for (const sourceFile of initialProgram.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue
		// TODO probably check here that this isn't one of the entry files, it's already been transformed

		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
		transformedTsSourceMap[sourceFile.fileName] = printer.printFile(newSourceFile)
		if (sourceFile.fileName !== 'app/App.ts') continue
		console.log('sourceFile.fileName:', sourceFile.fileName)
		console.log('transformedTsSourceMap[sourceFile.fileName]')
		console.log(transformedTsSourceMap[sourceFile.fileName])
		console.log()
	}

	const outputResources = sourceConverter(unprocessedSources)

	const transformedRoundOptions = {
		...alwaysOptions, declaration: false, sourceMap: false,
		// outDir: 'dist',
		// module: ts.ModuleKind.AMD, outFile: "./app/App.js",
	}
	const defaultCompilerHost = ts.createCompilerHost(transformedRoundOptions)
	// https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#customizing-module-resolution
	const capturingCompilerHost: ts.CompilerHost = {
		...defaultCompilerHost,
		getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
			if (!fileName.includes('node_modules')) {
				console.log('getSourceFile')
				console.log(fileName)
				console.log()
			}
			const transformedSource = transformedTsSourceMap[fs.relative(process.cwd(), fileName)]
			return transformedSource !== undefined
				? ts.createSourceFile(fileName, transformedSource, languageVersion)
				: defaultCompilerHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
		},
		fileExists(fileName) {
			if (!fileName.includes('node_modules')) {
				console.log('fileExists')
				console.log(fileName)
				console.log()
			}
			return fs.relative(process.cwd(), fileName) in transformedTsSourceMap || defaultCompilerHost.fileExists(fileName)
		},
		writeFile(fileName, content) {
			console.log()
			console.log('writeFile')
			console.log(fileName)
			// console.log()
			// console.log(content)
			// console.log()
			outputResources[fileName] = content
		},
		// getDefaultLibFileName: () => "lib.d.ts",
		// getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
		// getDirectories: path => ts.sys.getDirectories(path),
		// getCanonicalFileName: fileName => ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
		// getNewLine: () => ts.sys.newLine,
		// useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
		// fileExists,
		// readFile,
		// resolveModuleNames,
	}
	const transformedProgram = ts.createProgram(entryScripts, transformedRoundOptions, capturingCompilerHost)
	const diagnostics = ts.getPreEmitDiagnostics(transformedProgram)
	// use diagnostic.category === ts.DiagnosticCategory.Error to see if any of these are actually severe
	// if (diagnostics.length)
	for (const diagnostic of diagnostics)
		console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
	// const emitResult = transformedProgram.emit()
	transformedProgram.emit()


	// const exitCode = emitResult.emitSkipped ? 1 : 0
	// process.exit(exitCode)

	const outputFiles = finalizer(entries, outputResources)
	for (const [path, content] of Object.entries(outputFiles))
		fs.writeFile(path, content)
}


// function resolveModuleNames(
// 	moduleNames: string[],
// 	containingFile: string,
// ): ts.ResolvedModule[] {
// 	const resolvedModules: ts.ResolvedModule[] = []
// 	for (const moduleName of moduleNames) {
// 		// try to use standard resolution
// 		let result = ts.resolveModuleName(moduleName, containingFile, options, { fileExists, readFile })
// 		if (result.resolvedModule) {
// 			resolvedModules.push(result.resolvedModule)
// 			continue
// 		}

// 		// check fallback locations, for simplicity assume that module at location
// 		// should be represented by '.d.ts' file
// 		for (const location of moduleSearchLocations) {
// 			const modulePath = path.join(location, moduleName + ".d.ts")
// 			if (fileExists(modulePath))
// 				resolvedModules.push({ resolvedFileName: modulePath })
// 				// /** True if `resolvedFileName` comes from `node_modules`. */
// 				// isExternalLibraryImport?: boolean;
// 		}
// 	}

// 	return resolvedModules
// }
