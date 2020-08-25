import * as fs from 'fs'
import arg = require('arg')
import * as nodepath from 'path'
import ts = require('typescript')
import toml = require('@iarna/toml')
import { Result } from '@ts-std/monads'
import { sync as globSync } from 'fast-glob'
import sourceMapSupport = require('source-map-support')

import { fatal, exit } from './utils'
import { assertSuccess } from './message'
import { Transformer, Macro } from '../lib/transformer'
import { MacroTsConfig, CompilationEnvironment } from '../lib/config'
import { Dict, exec, NonEmpty, cachedLookup, setExtend } from '../lib/utils'


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
	noEmitOnError: true, declaration: true, sourceMap: true, rootDir: '.',
}

function makeDevModeOptions(devMode: boolean) {
	const releaseMode = !devMode
	return { noUnusedParameters: releaseMode, noUnusedLocals: releaseMode, preserveConstEnums: !releaseMode, removeComments: releaseMode }
}

import chalk = require('chalk')
const filesColor = chalk.cyan
const commandsColor = chalk.bold.magenta
const environmentColor = chalk.bold.blue
const progressColor = chalk.green
const successColor = chalk.bold.green
const errorColor = chalk.bold.red
const warnColor = chalk.yellow

function formatStringList(list: string[]) {
	return list.map(s => filesColor(s)).join(', ')
}

export function reportDiagnostics(workingDir: string, diagnostics: readonly ts.Diagnostic[]): never {
	const diagnosticText = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
		getNewLine: () => ts.sys.newLine,
		getCurrentDirectory: () => workingDir,
		getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? x => x : x => x.toLowerCase(),
	})
	return fatal('\n' + diagnosticText)
}


type CompileArgs = {
	includedLocations: string[],
	entryFiles: Set<string>,
	outDir: string,
	environment: CompilationEnvironment,
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

	if (configResult.is_err()) fatal(`${errorColor(`Invalid config in`)} ${filesColor(configLocation)}\n${configResult.error}`)
	return configResult.value
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
			fatal(errorColor(`if an entryGlob isn't provided, a `) + filesColor('.macro-ts.toml') + errorColor(` config file must be present`))

		const outputs: Dict<CompileArgs> = {}
		for (const { location, entry, exclude, environment, dev } of Object.values(config.packages)) {
			const excludes = exclude ? NonEmpty.flattenInto(exclude) : []
			const entries = glob(NonEmpty.flattenInto(entry).map(e => nodepath.join(location, e)), excludes)
			const environments = NonEmpty.flattenInto(environment)
			for (const environment of environments) {
				const outDir = CompilationEnvironment.key(environment)
				const currentOutput = outputs[outDir]
				// TODO need to figure out the tricky issue of dev disagreeing across packages
				if (currentOutput) {
					currentOutput.includedLocations.push(location)
					currentOutput.entryFiles = setExtend(currentOutput.entryFiles, entries)
				}
				else
					outputs[outDir] = {
						includedLocations: [location], entryFiles: new Set(entries), outDir, dev, environment,
						...CompilationEnvironment.options(environment),
					}
			}
		}

		return {
			macrosEntry: config.macros || defaultMacrosEntry, configDevMode: false,
			compileArgsList: Object.values(outputs),
		}
	}

	const {
		location = undefined,
		environment = defaultEnvironment,
		dev = false,
	} = config ? MacroTsConfig.selectPackageForPath(entryGlob, config) || {} : {}

	const macrosEntry = config ? config.macros || defaultMacrosEntry : defaultMacrosEntry
	const compileArgsList = [{
		// outDir can be a pointless value since entryGlob being defined means we're running the check command
		includedLocations: location ? [location] : [], entryFiles: new Set(glob([entryGlob], [])), outDir: '.',
		dev, environment,
		...CompilationEnvironment.options(environment)
	}]

	return { macrosEntry, configDevMode: dev, compileArgsList }
}

// TODO a good idea to add some kind of hash-enabled caching
export function produceTransformer(macrosEntry: string, workingDir: string) {
	const macrosContents = undefReadFile(macrosEntry)
	const macrosEntryFilePortion = filesColor(macrosEntry)
	if (macrosContents === undefined) {
		console.log(warnColor(`unable to read file at ${macrosEntryFilePortion}, proceeding without macros`))
		return undefined
	}
	console.log(progressColor(`found macros file at ${macrosEntryFilePortion}`))

	const macrosOptions = {
		...alwaysOptions, noEmit: false, noEmitOnError: true, declaration: false, sourceMap: false,
		target: ts.ScriptTarget.Latest, module: ts.ModuleKind.CommonJS, outDir: './.macro-ts/macros',
	}
	const macrosSourceFile = ts.createSourceFile(macrosEntry, macrosContents, ts.ScriptTarget.Latest)
	let foundMacros = false
	const { transformed: [newMacrosSourceFile] } = ts.transform(macrosSourceFile, [() => sourceFile => {
		const finalStatements = [ts.createImportDeclaration(
			undefined, undefined,
			ts.createImportClause(undefined, ts.createNamedImports([
				ts.createImportSpecifier(ts.createIdentifier('Dict'), ts.createIdentifier('___Dict')),
				ts.createImportSpecifier(ts.createIdentifier('Macro'), ts.createIdentifier('___Macro')),
			])),
			ts.createStringLiteral('@blainehansen/macro-ts'),
		) as ts.Statement]

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
	if (!foundMacros)
		fatal(errorColor(`your macros file at ${macrosEntryFilePortion} didn't export a "macros" identifier`))


	function dirMaker(sourceFileName: string) {
		const currentDir = nodepath.relative(workingDir, nodepath.dirname(sourceFileName))
		const currentFile = nodepath.basename(sourceFileName)
		return { currentDir, currentFile }
	}
	const dummyTransformer = new Transformer<undefined>(undefined, workingDir, () => {}, undefReadFile, nodepath.join, dirMaker)
	dummyTransformer.transformSourceFile(newMacrosSourceFile)
	const macrosCompilerHost = createInterceptingHost(dummyTransformer, macrosOptions)
	const macrosProgram = ts.createProgram([macrosEntry], macrosOptions, macrosCompilerHost)

	fs.rmdirSync(macrosOptions.outDir, { recursive: true })
	const emitResult = macrosProgram.emit()
	const wereErrors = emitResult.emitSkipped
	if (wereErrors) {
		console.error(errorColor(`while compiling macros, type errors were encountered`))
		reportDiagnostics(workingDir, emitResult.diagnostics)
	}
	console.log(progressColor(`macros compiled successfully`))

	const macrosPath = nodepath.join(workingDir, './.macro-ts/macros/', nodepath.basename(macrosEntry, '.ts'))
	const macros: Dict<Macro> = require(macrosPath).macros
	if (Object.keys(macros).length === 0) return undefined

	return new Transformer<undefined>(macros, workingDir, () => {}, undefReadFile, nodepath.join, dirMaker)
}


export function compile(entryGlob: string | undefined, devMode: boolean, shouldEmit: boolean) {
	const workingDir = process.cwd()
	const { macrosEntry, configDevMode, compileArgsList } = getCompileConfig(entryGlob, workingDir)
	const transformer = produceTransformer(macrosEntry, workingDir)

	const emitDirectory = './.macro-ts/dist'
	if (shouldEmit)
		fs.rmdirSync(emitDirectory, { recursive: true })

	if (entryGlob !== undefined)
		console.log('entry glob is: ' + filesColor(entryGlob))
	if (devMode)
		console.log(warnColor('dev mode enabled'))
	console.log('')

	for (const { includedLocations, entryFiles, outDir, environment: { platform, target }, dev, module, lib, types } of compileArgsList) {
		const entries = [...entryFiles]
		const actualOutDir = nodepath.join(emitDirectory, outDir)
		const commandPortion = commandsColor(shouldEmit ? 'building' : 'checking')
		const environmentPortion = `platform ${environmentColor(platform)} and target ${environmentColor(ts.ScriptTarget[target])}`
		const emitPortion = shouldEmit ? ` into ${filesColor(actualOutDir)}` : ''
		const locationsPortion = includedLocations.length !== 0 ? formatStringList(includedLocations) : warnColor('no locations')

		if (entryFiles.size === 0) {
			console.warn(`${warnColor(`no files were matched`)} while ${commandPortion} ${locationsPortion} with ${environmentPortion}${emitPortion}`)
			continue
		}

		console.log(`${commandPortion} ${locationsPortion} with ${environmentPortion}${emitPortion}`)
		console.log(`includes these files: \n${formatStringList(entries)}`)
		const compileOptions = {
			...alwaysOptions, ...makeDevModeOptions(dev || devMode || configDevMode),
			target, module, lib, types,
			...(
				shouldEmit
					? { ...alwaysEmitOptions, outDir: actualOutDir }
					: nonEmitOptions
			),
		}

		const finalProgram = transformer
			? exec(() => {
				transformer.reset()
				const initialProgram = ts.createProgram(entries, nonEmitOptions)
				for (const sourceFile of initialProgram.getSourceFiles()) {
					if (sourceFile.isDeclarationFile) continue
					transformer.transformSourceFile(sourceFile)
				}

				const capturingCompilerHost = createInterceptingHost(transformer, compileOptions)
				const program = ts.createProgram(entries, compileOptions, capturingCompilerHost)
				assertSuccess(transformer)
				return program
			})
			: ts.createProgram(entries, compileOptions)

		const diagnostics = shouldEmit
			? finalProgram.emit().diagnostics
			: ts.getPreEmitDiagnostics(finalProgram)

		if (diagnostics.length)
			reportDiagnostics(workingDir, diagnostics)
		else
			console.log(successColor('🗸 🗸 🗸 no type errors 🗸 🗸 🗸\n'))
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
	console.log(`${commandsColor('running')} ${filesColor(`${entryFile} ${runArgs.join(' ')}`)}`)
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

	const cachedFileExists = cachedLookup(ts.sys.fileExists)

	const registry = ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, workingDir)
	const service = ts.createLanguageService({
		getProjectVersion: () => String(projectVersion),
		getScriptFileNames: () => Array.from(fileVersions.keys()),
		getScriptVersion(fileName: string) {
			const version = fileVersions.get(fileName)
			return version ? version.toString() : ''
		},
		readFile: cachedLookup(ts.sys.readFile),
		fileExists(fileName: string) {
			return (transformer ? transformer.has(fileName) : undefined) || cachedFileExists(fileName)
		},
		getScriptSnapshot(fileName: string) {
			const cachedScriptSnapshot = scriptSnapshotCache.get(fileName)
			if (cachedScriptSnapshot !== undefined) return cachedScriptSnapshot

			const fileContents = (transformer ? transformer.get(fileName) : undefined) || undefReadFile(fileName)
			if (fileContents === undefined) return undefined

			const finalContents = transformer && !fileName.includes('node_modules')
				? exec(() => {
					const source = transformer.transformSource(fileName, fileContents)
					assertSuccess(transformer)
					return source
				})
				: fileContents

			const snapshot = ts.ScriptSnapshot.fromString(finalContents)
			scriptSnapshotCache.set(fileName, snapshot)
			return snapshot
		},
		// readDirectory: ts.sys.readDirectory,
		getDirectories: cachedLookup(ts.sys.getDirectories),
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

		const filesPortion = filesColor(nodepath.relative(workingDir, fileName))
		if (diagnostics.length) {
			const program = service.getProgram()!
			let fileText = ''
			for (const sourceFile of program.getSourceFiles()) {
				if (sourceFile.isDeclarationFile || sourceFile.fileName !== fileName) continue
				fileText = printer.printFile(sourceFile)
				break
			}
			console.error(errorColor(`type errors encountered in `) + filesPortion)
			if (transformer)
				console.error(`${chalk.italic.gray('this file has potentially been transformed by macros, so here is the transformed text:')}\n${fileText}`)
			reportDiagnostics(workingDir, diagnostics)
		}

		if (output.emitSkipped)
			fatal(`${errorColor('emit skipped')} for ${filesPortion}`)
		if (output.outputFiles.length === 0)
			fatal(`${errorColor('Unable to require file:')} ${filesPortion}`)

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
	let jsCompile = undefined as Function | undefined
	require.extensions['.ts'] = function(mod: any, fileName) {
		if (/(?:^|\/)node_modules\//.test(fileName)) return jsHandler(mod, fileName)

		const originalModuleCompile = jsCompile = mod._compile
		mod._compile = function(code: string, fileName: string) {
			return originalModuleCompile.call(this, compileWithService(code, fileName), fileName)
		}

		return jsHandler(mod, fileName)
	}

	if (transformer && transformer.macros)
		for (const [extension, macro] of Object.entries(transformer.macros)) {
			if (macro.type !== 'import') continue

			require.extensions[`.${extension}`] = function(mod: any, fileName) {
				mod._compile = function(code: string, fileName: string) {
					if (!jsCompile) throw new Error()
					return jsCompile.call(this, compileWithService(code, fileName + '.ts'), fileName)
				}

				return jsHandler(mod, fileName)
			}
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
																	emitting into .macro-ts/dist.

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
			if (entryFile === undefined) fatal(commandsColor('run') + errorColor(` expects a filename\n\n`) + helpText)
			run(entryFile, args.slice(1), devMode)
			break

		case 'build':
			if (args.length) fatal(commandsColor('build') + errorColor(` accepts no positional arguments\n\n`) + helpText)
			build(devMode)
			break

		case 'check':
			if (args.length > 1) fatal(commandsColor('check') + errorColor(` can only accept one positional argument\n\n`) + helpText)
			check(args[0], devMode)
			break

		default:
			fatal(`${errorColor('invalid command:')} ${command}\n\n` + helpText)
	}
}

if (require.main === module)
	main(process.argv.slice(2))
