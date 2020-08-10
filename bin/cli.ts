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

import { Transformer, Macro, SourceChannel } from '../lib/transformer'
import { Dict, tuple as t, exec, NonEmpty, cachedLookup } from '../lib/utils'
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
	// transformedTsSources: Map<string, string>,
	transformer: Transformer<unknown>,
	compilerOptions: ts.CompilerOptions,
): ts.CompilerHost {
	const defaultCompilerHost = ts.createCompilerHost(compilerOptions)
	// https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#customizing-module-resolution
	return {
		...defaultCompilerHost,
		getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
			const transformedSource = transformer.get(fileName)
			return transformedSource !== undefined
				? ts.createSourceFile(fileName, transformedSource, languageVersion)
				: defaultCompilerHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
		},
		fileExists(fileName) {
			return transformer.has(fileName) || defaultCompilerHost.fileExists(fileName)
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
	dev: boolean | undefined,
	lib?: string[],
	types?: string[],
}

export const configLocation = './.macro-ts.toml'
export const defaultMacrosEntry = './.macros.ts'

const defaultEnvironment: CompilationEnvironment = { platform: 'anywhere', target: ts.ScriptTarget.Latest }

function attemptGetConfig(workingDir: string) {
	const configPath = nodepath.join(workingDir, configLocation)
	const configText = undefReadFile(configPath)
	if (configText === undefined) return undefined

	const configResult = Result.attempt(() => toml.parse(configText))
		.change_err(e => e.message)
		.try_change(obj => MacroTsConfig.decode(obj))

	return MacroTsConfig.expect(configResult)
}


function getRunConfig(entryFile: string | undefined, workingDir: string) {
	const config = attemptGetConfig(workingDir)
	if (config === undefined)
		return { macrosEntry: defaultMacrosEntry, configDevMode: false, target: ts.ScriptTarget.Latest }

	const {
		environment: { target } = defaultEnvironment,
		dev = false,
	} = entryFile ? MacroTsConfig.selectPackageForPath(entryFile, config) || {} : {}

	return {
		macrosEntry: (config.macros || defaultMacrosEntry),
		configDevMode: dev,
		target: target,
	}
}

function getCompileConfig(entryGlob: string | undefined, workingDir: string) {
	const config = attemptGetConfig(workingDir)

	if (entryGlob === undefined) {
		if (config === undefined)
			fatal(`if an entryGlob isn't provided, a .macro-ts.toml config file must be present`)

		const compileArgsList = Object.values(config.packages).map(({ location, entry, exclude, environment, dev }) => {
			const entries = NonEmpty.flattenInto(entry).map(e => nodepath.join(location, e))
			const excludes = exclude ? NonEmpty.flattenInto(exclude) : []
			return {
				entryFiles: glob(entries, excludes),
				outDir: location, dev,
				...environment,
				...CompilationEnvironment.options(environment),
			} as CompileArgs
		})

		return { macrosEntry: config.macros || defaultMacrosEntry, configDevMode: false, compileArgsList }
	}

	const {
		environment = defaultEnvironment,
		dev = false,
	} = config ? MacroTsConfig.selectPackageForPath(entryGlob, config) || {} : {}

	const macrosEntry = config ? config.macros || defaultMacrosEntry : defaultMacrosEntry
	const compileArgsList = [{
		// outDir can be a pointless value since entryGlob being defined means we're checking
		entryFiles: glob([entryGlob], []), outDir: '.',
		dev,
		...environment,
		...CompilationEnvironment.options(environment)
	} as CompileArgs]

	return { macrosEntry, configDevMode: dev, compileArgsList }
}

// TODO a good idea to add some kind of hash-enabled caching
export function produceTransformer(macrosEntry: string, workingDir: string) {
	const macrosContents = undefReadFile(macrosEntry)
	if (macrosContents === undefined) return undefined

	const macrosOptions = {
		...alwaysOptions, noEmit: false, noEmitOnError: true, declaration: false, sourceMap: false,
		target: ts.ScriptTarget.Latest, module: ts.ModuleKind.CommonJS, outDir: './target/.macros',
	}
	const macrosSourceFile = ts.createSourceFile(macrosEntry, macrosContents, ts.ScriptTarget.Latest)
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


	function dirMaker(sourceFileName: string) {
		const currentDir = nodepath.relative(workingDir, nodepath.dirname(sourceFileName))
		const currentFile = nodepath.basename(sourceFileName)
		return { currentDir, currentFile }
	}
	const dummyTransformer = new Transformer<undefined>(undefined, workingDir, () => {}, undefReadFile, dirMaker)
	dummyTransformer.transformSourceFile(newMacrosSourceFile)
	const macrosCompilerHost = createInterceptingHost(
		workingDir,
		// new Map([[macrosEntry, printer.printFile(newMacrosSourceFile)]]),
		dummyTransformer,
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
	if (Object.keys(macros).length === 0) return undefined

	return new Transformer<undefined>(macros, workingDir, () => {}, undefReadFile, dirMaker)
}


export function compile(entryGlob: string | undefined, devMode: boolean, shouldEmit: boolean) {
	const workingDir = process.cwd()
	const { macrosEntry, configDevMode, compileArgsList } = getCompileConfig(entryGlob, workingDir)
	const transformer = produceTransformer(macrosEntry, workingDir)

	const emitDirectory = './target/.dist'
	if (shouldEmit)
		fs.rmdirSync(emitDirectory, { recursive: true })

	for (const { entryFiles, outDir, platform, target, dev, module, lib, types } of compileArgsList) {
		console.log('checking:', outDir, '; files:', entryFiles)
		const compileOptions = {
			...alwaysOptions, ...makeDevModeOptions(dev || devMode || configDevMode),
			...(
				shouldEmit
					? { ...alwaysEmitOptions, outDir: nodepath.join(emitDirectory, outDir), target, module, lib, types }
					: nonEmitOptions
			),
		}

		const finalProgram = transformer
			? exec(() => {
				transformer.reset()
				const initialProgram = ts.createProgram(entryFiles, nonEmitOptions)
				for (const sourceFile of initialProgram.getSourceFiles()) {
					if (sourceFile.isDeclarationFile) continue
					transformer.transformSourceFile(sourceFile)
				}

				const capturingCompilerHost = createInterceptingHost(workingDir, transformer, compileOptions)
				return ts.createProgram(entryFiles, compileOptions, capturingCompilerHost)
			})
			: ts.createProgram(entryFiles, compileOptions)

		const diagnostics = shouldEmit
			? finalProgram.emit().diagnostics
			: ts.getPreEmitDiagnostics(finalProgram)

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
	register(entryFile, workingDir, devMode)

	process.argv = ['node', nodepath.join(workingDir, entryFile), ...runArgs]
	Module.runMain()
}

export function register(entryFile: string | undefined, workingDir: string, devMode: boolean) {
	const { macrosEntry, configDevMode, target } = getRunConfig(entryFile, workingDir)
	const transformer = produceTransformer(macrosEntry, workingDir)

	const runOptions = {
		...alwaysOptions, ...makeDevModeOptions(devMode || configDevMode),
		noEmit: false, noEmitOnError: true, sourceMap: true, inlineSources: true,
		target, module: ts.ModuleKind.CommonJS,
	}

	const fileVersions = new Map(entryFile ? [[entryFile, 0]] : [])
	const fileContents = new Map<string, string>()
	function updateFiles(contents: string, fileName: string) {
		const previousVersion = fileVersions.get(fileName) || 0
		const previousContents = fileContents.get(fileName)
		if (contents === previousContents) return

		fileVersions.set(fileName, previousVersion + 1)
		fileContents.set(fileName, contents)
		projectVersion++
	}
	let projectVersion = 1
	const scriptSnapshotCache = new Map<string, ts.IScriptSnapshot>()

	const registry = ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, workingDir)
	const service = ts.createLanguageService({
		getProjectVersion: () => String(projectVersion),
		getScriptFileNames: () => Array.from(fileVersions.keys()),
		getScriptVersion(fileName: string) {
			const version = fileVersions.get(fileName)
			return version ? version.toString() : ''
		},
		getScriptSnapshot(fileName: string) {
			const cachedScriptSnapshot = scriptSnapshotCache.get(fileName)
			if (cachedScriptSnapshot !== undefined) return cachedScriptSnapshot

			const fileContents = (transformer ? transformer.get(fileName) : undefined) || undefReadFile(fileName)
			if (fileContents === undefined) return undefined

			const finalContents = transformer
				? transformer.transformSource(fileName, fileContents)
				: fileContents

			const snapshot = ts.ScriptSnapshot.fromString(finalContents)
			scriptSnapshotCache.set(fileName, snapshot)
			return snapshot
		},
		readFile: cachedLookup(ts.sys.readFile),
		// readDirectory: ts.sys.readDirectory,
		getDirectories: cachedLookup(ts.sys.getDirectories),
		fileExists: cachedLookup(ts.sys.fileExists),
		directoryExists: cachedLookup(ts.sys.directoryExists),
		getNewLine: () => ts.sys.newLine,
		useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
		getCurrentDirectory: () => workingDir,
		getCompilationSettings: () => runOptions,
		getDefaultLibFileName: () => ts.getDefaultLibFilePath(runOptions),
	}, registry)

	const emitCache = new Map<string, string>()
	sourceMapSupport.install({
		environment: 'node',
		retrieveFile(path: string) {
			// return emitCache.get(normalizeSlashes(path))?.content || ''
			return emitCache.get(path) || ''
		},
	})

	function compileWithService(code: string, fileName: string){
		updateFiles(code, fileName)

		const output = service.getEmitOutput(fileName)
		const diagnostics = service.getSemanticDiagnostics(fileName).concat(service.getSyntacticDiagnostics(fileName))

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

	return service
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
// const versionText = require('../package.json').version
const versionText = "0.1.0"

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
		case 'run':
			const entryFile = args[0]
			if (entryFile === undefined) fatal(`run expects a filename\n\n` + helpText)
			run(entryFile, args.slice(1), devMode)
			break

		case 'build':
			if (args.length) fatal(`build accepts no positional arguments\n\n` + helpText)
			build(devMode)
			break

		case 'check':
			if (args.length > 1) fatal(`check can only accept one positional argument\n\n` + helpText)
			check(args[0], devMode)
			break

		default:
			fatal(`invalid command: ${command}\n\n` + helpText)
	}
}

if (require.main === module)
	main(process.argv.slice(2))
