// TODO put #!/usr/bin/env node back onto bin scripts
// https://stackoverflow.com/questions/10587615/unix-command-to-prepend-text-to-a-file

import * as fs from 'fs'
import arg = require('arg')
import * as nodepath from 'path'
import ts = require('typescript')
import toml = require('@iarna/toml')
import { Result } from '@ts-std/monads'
import { sync as globSync } from 'fast-glob'
import sourceMapSupport = require('source-map-support')

import { Dict, tuple as t, exec, NonEmpty } from '../lib/utils'
import { createTransformer, Macro, SourceChannel } from '../lib/transformer'
import { MacroTsConfig, CompilationEnvironment, ScriptTarget } from '../lib/config'

function fatal(message: string): never {
	console.error(message)
	return process.exit(1)
}
function exit(message: string): never {
	console.log(message)
	return process.exit(0)
}


const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

function glob(patterns: string[], ignore: string[]) {
	return globSync(patterns, { dot: true, ignore })
}

function undefReadFile(path: string) {
	try { return fs.readFileSync(path, 'utf8') }
	catch { return undefined }
}

function isNodeExported(node: ts.Node): boolean {
	return (
		(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0
		|| (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
	)
}

function createInterceptingHost(
	workingDir: string,
	transformedTsSources: Map<string, string>,
	compilerOptions: ts.CompilerOptions,
): ts.CompilerHost {
	const defaultCompilerHost = ts.createCompilerHost(compilerOptions)
	// https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#customizing-module-resolution
	return {
		...defaultCompilerHost,
		getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
			const transformedSource = transformedTsSources.get(nodepath.relative(workingDir, fileName))
			return transformedSource !== undefined
				? ts.createSourceFile(fileName, transformedSource, languageVersion)
				: defaultCompilerHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
		},
		fileExists(fileName) {
			return transformedTsSources.has(nodepath.relative(workingDir, fileName)) || defaultCompilerHost.fileExists(fileName)
		},
		// getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
		// getDirectories: path => ts.sys.getDirectories(path),
		// getCanonicalFileName: fileName => ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
		// getNewLine: () => ts.sys.newLine,
		// useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
		// readFile,
		// resolveModuleNames,
	}
}

// https://css-tricks.com/polyfill-javascript-need/

// TODO we have an option of doing virtual paths intelligently

const alwaysOptions = {
	strict: true, moduleResolution: ts.ModuleResolutionKind.NodeJs,
	allowSyntheticDefaultImports: false, esModuleInterop: false, resolveJsonModule: false,
}
const nonEmitOptions = {
	...alwaysOptions,
	noEmit: true, declaration: false, sourceMap: false,
}
const alwaysEmitOptions = {
	noEmitOnError: true, declaration: true, sourceMap: true,
}

function makeDevModeOptions(devMode: boolean) {
	const releaseMode = !devMode
	return { noUnusedParameters: releaseMode, noUnusedLocals: releaseMode, preserveConstEnums: !releaseMode, removeComments: releaseMode }
}

export function reportDiagnostics(workingDir: string, diagnostics: readonly ts.Diagnostic[]): never {
	const diagnosticText = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
		getNewLine: () => ts.sys.newLine,
		getCurrentDirectory: () => workingDir,
		getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? x => x : x => x.toLowerCase(),
	})
	return fatal(diagnosticText)
}


type CompileArgs = {
	entryFiles: string[],
	// emitOptions: {}[],
	outDir: string,
	platform: CompilationEnvironment['platform'],
	target: ScriptTarget,
	module: ts.ModuleKind,
	lib?: string[],
	types?: string[],
}

export const configLocation = './.macro-ts.toml'
export const defaultMacrosEntry = './.macros.ts'

const defaultEnvironment: CompilationEnvironment = { platform: 'anywhere', target: ts.ScriptTarget.Latest }

export function produceConfig(entryGlob: string | undefined, workingDir: string) {
	const configPath = nodepath.join(workingDir, configLocation)
	const configText = undefReadFile(configPath)

	// if an entryGlob is given, then we don't need to find a file
	const configResult = configText !== undefined
		? Result.attempt(() => toml.parse(configText))
			.change_err(e => e.message)
			.try_change(obj => MacroTsConfig.decode(obj))
		: undefined

	const [macrosEntry, configDevMode, compileArgsList] = entryGlob !== undefined
		? exec(() => {
			const [macrosEntry, configDevMode, environment] = configResult === undefined
				? [defaultMacrosEntry, false, defaultEnvironment]
				: exec(() => {
					const config = MacroTsConfig.expect(configResult)
					const {
						environment = defaultEnvironment,
						dev = false,
					} = MacroTsConfig.selectPackageForGlob(entryGlob, config) || {}
					return t(config.macros || defaultMacrosEntry, dev, environment)
				})

			// outDir can be a pointless value since entryGlob being defined means we're checking
			return t(macrosEntry, configDevMode, [{
				entryFiles: glob([entryGlob], []), outDir: '.',
				...environment,
				...CompilationEnvironment.options(environment)
			}] as CompileArgs[])
		})
		: exec(() => {
			const { macros, packages } = MacroTsConfig.expect(configResult)
			return t(
				macros || defaultMacrosEntry,
				false,
				Object.values(packages).map(({ location, entry, exclude, environment }): CompileArgs => {
					const entries = NonEmpty.flattenInto(entry).map(e => nodepath.join(location, e))
					const excludes = exclude ? NonEmpty.flattenInto(exclude) : []
					return {
						entryFiles: glob(entries, excludes),
						outDir: location,
						...environment,
						...CompilationEnvironment.options(environment),
					}
				}),
			)
		})

	return { macrosEntry, configDevMode, compileArgsList }
}

export function produceTransformer(macrosEntry: string, workingDir: string) {
	const macrosOptions = {
		...alwaysOptions, noEmit: false, noEmitOnError: true, declaration: false, sourceMap: false,
		target: ts.ScriptTarget.Latest, module: ts.ModuleKind.CommonJS, outDir: './target/.macros',
	}
	// TODO a good idea to add some hash/caching
	const macrosSourceFile = ts.createSourceFile(macrosEntry, fs.readFileSync(macrosEntry, 'utf8'), ts.ScriptTarget.ESNext)
	let foundMacros = false
	const { transformed: [newMacrosSourceFile] } = ts.transform(macrosSourceFile, [() => sourceFile => {
		const finalStatements = [['utils', 'Dict'], ['transformer', 'Macro']].map(([mod, name]) => ts.createImportDeclaration(
			undefined, undefined,
			ts.createImportClause(undefined, ts.createNamedImports([
				ts.createImportSpecifier(ts.createIdentifier(name), ts.createIdentifier(`___${name}`)),
			])),
			ts.createStringLiteral(`./lib/${mod}`),
		) as ts.Statement)

		for (const statement of sourceFile.statements) {
			if (foundMacros || !(
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
							ts.createTypeReferenceNode(ts.createIdentifier('___Macro'), undefined),
						]),
						statement.declarationList.declarations[0].initializer,
					)],
				),
			))
		}

		return ts.updateSourceFileNode(sourceFile, finalStatements)
	}])
	if (!foundMacros) fatal("your macros file didn't export a `macros` identifier")

	const macrosCompilerHost = createInterceptingHost(
		workingDir,
		new Map([[macrosEntry, printer.printFile(newMacrosSourceFile)]]),
		macrosOptions,
	)
	const macrosProgram = ts.createProgram([macrosEntry], macrosOptions, macrosCompilerHost)
	fs.rmdirSync(macrosOptions.outDir, { recursive: true })
	const emitResult = macrosProgram.emit()
	const wereErrors = emitResult.emitSkipped
	if (wereErrors)
		reportDiagnostics(workingDir, emitResult.diagnostics)

	const macrosPath = nodepath.join(workingDir, './target/.macros/', nodepath.basename(macrosEntry, '.ts'))
	const macros: Dict<Macro> = require(macrosPath).macros


	function dirMaker(sourceFileName: string) {
		const currentDir = nodepath.relative(workingDir, nodepath.dirname(sourceFileName))
		const currentFile = nodepath.basename(sourceFileName)
		return { currentDir, currentFile }
	}
	const transformedTsSources = new Map<string, string>()
	const receivePayload: SourceChannel<undefined> = script => {
		if (!script) return
		const sourceFile = ts.createSourceFile(script.path, script.source, ts.ScriptTarget.ESNext)
		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
		transformedTsSources.set(script.path, printer.printFile(newSourceFile))
	}
	const transformer = createTransformer(macros, receivePayload, workingDir, undefReadFile, dirMaker)

	return { transformer, transformedTsSources }
}


export function compile(entryGlob: string | undefined, devMode: boolean, shouldEmit: boolean) {
	const workingDir = process.cwd()
	const { macrosEntry, configDevMode, compileArgsList } = produceConfig(entryGlob, workingDir)
	const { transformer, transformedTsSources } = produceTransformer(macrosEntry, workingDir)

	const emitDirectory = './target/.dist'
	if (shouldEmit)
		fs.rmdirSync(emitDirectory, { recursive: true })

	for (const { entryFiles, outDir, platform, target, module, lib, types } of compileArgsList) {
		console.log('checking:', outDir, '; files:', entryFiles)
		transformedTsSources.clear()

		const initialProgram = ts.createProgram(entryFiles, nonEmitOptions)
		for (const sourceFile of initialProgram.getSourceFiles()) {
			if (sourceFile.isDeclarationFile) continue
			const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
			transformedTsSources.set(sourceFile.fileName, printer.printFile(newSourceFile))
		}

		const compileOptions = {
			...alwaysOptions, ...makeDevModeOptions(devMode || configDevMode),
			...(
				shouldEmit
					? { ...alwaysEmitOptions, outDir: nodepath.join(emitDirectory, outDir), target, module, lib, types }
					: nonEmitOptions
			),
		}
		const capturingCompilerHost = createInterceptingHost(workingDir, transformedTsSources, compileOptions)
		const transformedProgram = ts.createProgram(entryFiles, compileOptions, capturingCompilerHost)

		const diagnostics = shouldEmit
			? transformedProgram.emit().diagnostics
			: ts.getPreEmitDiagnostics(transformedProgram)

		if (diagnostics.length) {
			console.error(`while compiling ${outDir} for platform ${platform} and target ${ts.ScriptTarget[target]}:`)
			reportDiagnostics(workingDir, diagnostics)
		}
		console.log('no errors!\n')
	}
}

function check(entryGlob: string | undefined, devMode: boolean) {
	compile(entryGlob, devMode, false)
}
function build(devMode: boolean) {
	compile(undefined, devMode, true)
}


import Module = require('module')
function run(entryFile: string, runArgs: string[], devMode: boolean) {
	const workingDir = process.cwd()
	const { macrosEntry } = produceConfig(entryFile, workingDir)
	const { transformer, transformedTsSources } = produceTransformer(macrosEntry, workingDir)

	const initialProgram = ts.createProgram([entryFile], nonEmitOptions)
	for (const sourceFile of initialProgram.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue
		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
		transformedTsSources.set(sourceFile.fileName, printer.printFile(newSourceFile))
	}

	// TODO project discovery makes sense here?
	// I'm especially worried about testing, where some dom library has node tests that use ambient dom filler types
	const runOptions = {
		...alwaysOptions, ...makeDevModeOptions(devMode),
		noEmit: false, noEmitOnError: true, sourceMap: true, inlineSources: true,
	}
	// const fileVersions = new Map(rootFileNames.map(fileName => [fileName, 0]))
	// const fileContents = new Map<string, string>()

	const registry = ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, workingDir)
	const service = ts.createLanguageService({
		// getProjectVersion: () => String(projectVersion),
		// getScriptFileNames: () => Array.from(fileVersions.keys()),
		getScriptFileNames: () => [entryFile],
		getScriptVersion(_fileName: string) {
			// const version = fileVersions.get(fileName)
			// return version ? version.toString() : ''
			return '1'
		},
		getScriptSnapshot(fileName: string) {
			const contents = transformedTsSources.get(nodepath.relative(workingDir, fileName)) || undefReadFile(fileName)
			// let contents = fileContents.get(fileName)

			if (contents === undefined) return undefined
			return ts.ScriptSnapshot.fromString(contents)
		},
		// readFile: cachedReadFile,
		// readDirectory: ts.sys.readDirectory,
		// getDirectories: cachedLookup(debugFn('getDirectories', ts.sys.getDirectories)),
		// fileExists: cachedLookup(debugFn('fileExists', fileExists)),
		// directoryExists: cachedLookup(debugFn('directoryExists', ts.sys.directoryExists)),
		getNewLine: () => ts.sys.newLine,
		useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
		getCurrentDirectory: () => workingDir,
		getCompilationSettings: () => runOptions,
		getDefaultLibFileName: () => ts.getDefaultLibFilePath(runOptions),
	}, registry)

	// function updateMemoryCache(contents: string, fileName: string) {
	//   // Add to `rootFiles` when discovered for the first time.
	//   if (!fileVersions.has(fileName)) {
	//     rootFileNames.push(fileName)
	//   }

	//   const previousVersion = fileVersions.get(fileName) || 0
	//   const previousContents = fileContents.get(fileName)
	//   // Avoid incrementing cache when nothing has changed.
	//   if (contents !== previousContents) {
	//     fileVersions.set(fileName, previousVersion + 1)
	//     fileContents.set(fileName, contents)
	//     // Increment project version for every file change.
	//     projectVersion++
	//   }
	// }

	const emitCache = new Map<string, string>()
	sourceMapSupport.install({
		environment: 'node',
		retrieveFile(path: string) {
			// return emitCache.get(normalizeSlashes(path))?.content || ''
			return emitCache.get(path) || ''
		},
	})

	function compileWithService(_code: string, fileName: string){
		// updateMemoryCache(code, fileName)

		const output = service.getEmitOutput(fileName)
		const diagnostics = service.getSemanticDiagnostics(fileName).concat(service.getSyntacticDiagnostics(fileName))

		// const diagnosticList = filterDiagnostics(diagnostics, ignoreDiagnostics)
		// if (diagnosticList.length) reportTSError(diagnosticList)
		if (diagnostics.length)
			reportDiagnostics(workingDir, diagnostics)

		if (output.emitSkipped)
			throw new TypeError(`${nodepath.relative(workingDir, fileName)}: Emit skipped`)

		// Throw an error when requiring `.d.ts` files.
		if (output.outputFiles.length === 0)
			throw new TypeError(
				`Unable to require file: ${nodepath.relative(workingDir, fileName)}\n` +
				'This is usually the result of a faulty configuration or import. ' +
				'Make sure there is a `.js`, `.json` or other executable extension with ' +
				'loader attached before `ts-node` available.'
			)

		const compiledCode = output.outputFiles[1].text
		const sourceMap = JSON.parse(output.outputFiles[0].text)
		sourceMap.file = fileName
		sourceMap.sources = [fileName]
		delete sourceMap.sourceRoot
		const sourceMapText = JSON.stringify(sourceMap)
		const base64Map = Buffer.from(sourceMapText, 'utf8').toString('base64')
		const sourceMapContent = `data:application/json;charset=utf-8;base64,${base64Map}`
		const sourceMapLength = `${nodepath.basename(fileName)}.map`.length + ('.js'.length - nodepath.extname(fileName).length)
		const runnableCode = compiledCode.slice(0, -sourceMapLength) + sourceMapContent

		// emitCache.set(normalizedFileName, runnableCode)
		emitCache.set(fileName, runnableCode)

		return runnableCode
	}


	const jsHandler = require.extensions['.js']
	require.extensions['.ts'] = function(mod: any, filename) {
		if (/(?:^|\/)node_modules\//.test(filename)) return jsHandler(mod, filename)

		const originalModuleCompile = mod._compile
		mod._compile = function(code: string, fileName: string) {
			return originalModuleCompile.call(this, compileWithService(code, fileName), fileName)
		}

		return jsHandler(mod, filename)
	}

	process.argv = ['node', nodepath.join(workingDir, entryFile), ...runArgs]
	Module.runMain()
}


const helpText = `\
  Usage: macro-ts [options] <command>

  Commands:
    run <filename>.ts           Run the specified file.
    check [entryGlob]           Perform typechecking without running or emitting.
                                  Checks all configured packages if no entryGlob is provided.
    build                       Typecheck and emit javascript for all configured packages,
                                  emitting into target/.dist.

  Options:
    -h, --help                  Print this message.
    -v, --version               Print version.
    -d, --dev                   Set noUnusedParameters, noUnusedLocals, preserveConstEnums, and removeComments
                                  to more lenient dev quality values.
`
const versionText = require('../package.json').version

export function main(argv: string[]) {
	const {
		'--help': help = false,
		'--version': version = false,
		'--dev': devMode = false,
		_: [command = undefined, ...args] = [],
	} = arg({
		'--help': Boolean,
		'-h': '--help',
		'--version': Boolean,
		'-v': '--version',
		'--dev': Boolean,
		'-d': '--dev',
	}, { argv, stopAtPositional: true })

	if (help) exit(helpText)
	if (version) exit(versionText)

	switch (command) {
		case 'build':
			if (args.length) fatal(`build accepts no positional arguments\n\n` + helpText)
			build(devMode)
			break

		case 'check':
			if (args.length > 1) fatal(`check can only accept one positional argument\n\n` + helpText)
			check(args[0], devMode)
			break

		case 'run':
			const entryFile = args[0]
			if (entryFile === undefined) fatal(`run expects a filename\n\n` + helpText)
			run(entryFile, args.slice(1), devMode)
			break

		default:
			fatal(`invalid command: ${command}\n\n` + helpText)
	}
}

if (require.main === module)
	main(process.argv.slice(2))
