#!/usr/bin/env node

import * as fs from 'fs'
import arg = require('arg')
import * as nodepath from 'path'
import toml = require('@iarna/toml')
import ts = require('typescript')
import * as c from '@ts-std/codec'
import { sync as globSync } from 'fast-glob'
import { Result, Ok, Err } from '@ts-std/monads'
import sourceMapSupport = require('source-map-support')

import { Dict, tuple as t, exec, NonEmpty } from '../lib/utils'
import { createTransformer, Macro, SourceChannel } from '../lib/transformer'

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

function glob(patterns: string[]) {
	return globSync(patterns, { dot: true })
}

function undefReadFile(path: string) {
	return Result.attempt(() => fs.readFileSync(path, 'utf8')).ok_undef()
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

// we have an option of doing virtual paths intelligently

type ScriptTarget = Exclude<ts.ScriptTarget, ts.ScriptTarget.JSON>
const ScriptTarget = c.wrap<ScriptTarget>('ScriptTarget', input => {
	if (typeof input !== 'string') return Err(`invalid target: ${input}`)
	if (input.toLowerCase() === 'json') return Err(`the JSON target isn't supported`)
	if (input in ts.ScriptTarget)
		return Ok(ts.ScriptTarget[input as keyof typeof ts.ScriptTarget] as ScriptTarget)
	return Err(`invalid target: ${input}`)
})

type CompilationEnvironment = {
	platform: 'browser' | 'node' | 'anywhere',
	target: ScriptTarget,
}
namespace CompilationEnvironment {
	const fullDecoder = c.object<CompilationEnvironment>({
		platform: c.literals('browser', 'node', 'anywhere'),
		target: ScriptTarget,
	})

	export const decoder = c.wrap('CompilationEnvironment', env => {
		if (typeof env !== 'string')
			return fullDecoder.decode(env)

		switch (env) {
			case 'legacybrowser':
				return Ok({ platform: 'browser', target: ts.ScriptTarget.ES5 })
			case 'modernbrowser':
				return Ok({ platform: 'browser', target: ts.ScriptTarget.Latest })
			case 'node':
				return Ok({ platform: 'node', target: ts.ScriptTarget.Latest })
			case 'anywhere':
				return Ok({ platform: 'anywhere', target: ts.ScriptTarget.Latest })
		}
		return Err(`invalid environment shorthand: ${env}`)
	})

	// https://www.typescriptlang.org/docs/handbook/tsconfig-json.html#types-typeroots-and-types
	export function options({ platform, target }: CompilationEnvironment) {
		switch (platform) {
			case 'node':
				return {}
			case 'anywhere':
				return { types: [], lib: [] }
			case 'browser':
				const opt = { types: [], lib: ['dom'] }
				if (target >= ts.ScriptTarget.ES2015)
					opt.lib.push('webworker')
				return opt
		}
	}
}


// this means that they can have just a single thing to worry about, the environment they're compiling to
// if we make the reasonable assumption that if this is intended to be a browser *application*,
// that they'll be using a bundler that expects all code to be in esmodule style
// then we don't have to care about either the module options or the outDir/outFile options, we can just use target/.dist
// anyone wanting to build something more specific can just leverage the raw machinery in this package

function NonEmptyDecoder<T>(decoder: c.Decoder<T>): c.Decoder<[T, ...T[]]> {
	const arrayDecoder = c.array(decoder)
	return c.wrap(`NonEmpty<${decoder.name}>`, input => {
		const result = arrayDecoder.decode(input)
		if (result.is_err()) return result
		const values = result.value
		if (values.length === 0) return Err(`array empty, expected at least one item`)
		return Ok([values[0], ...values.slice(1)])
	})
}
function flattenNonEmpty<T>(item: T | NonEmpty<T>): NonEmpty<T> {
	return Array.isArray(item) ? item : [item]
}

const MacroTsConfig = c.object({
	macros: c.optional(c.string),
	packages: c.array(c.object({
		location: c.string,
		entry: c.union(c.string, NonEmptyDecoder(c.string)),
		environments: c.union(CompilationEnvironment.decoder, NonEmptyDecoder(CompilationEnvironment.decoder)),
		dev: c.optional(c.boolean),
	})),
})
type MacroTsConfig = c.TypeOf<typeof MacroTsConfig>

function parseMacroTsConfig(fileName: string) {
	return Result.attempt(() => toml.parse(fs.readFileSync(fileName, 'utf8')))
		.change_err(error => error.message)
		.try_change(obj => MacroTsConfig.decode(obj))
}

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
	return { noUnusedParameters: releaseMode, noUnusedLocals: releaseMode, preserveConstEnums: releaseMode, removeComments: releaseMode }
}

export function reportDiagnostics(workingDir: string, diagnostics: readonly ts.Diagnostic[]): never {
	const diagnosticText = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
		getNewLine: () => ts.sys.newLine,
		getCurrentDirectory: () => workingDir,
		getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? x => x : x => x.toLowerCase(),
	})
	return fatal(diagnosticText)
}


// type EmitOptions = {}
type EmitOptions = true
const defaultMacrosEntry = './.macros.ts'

type CompileArgs = {
	entryFiles: string[],
	emitOptions?: {
		target: ScriptTarget,
		lib?: string[],
		types?: string[],
	},
}

function produceConfig(entryGlob: string | undefined, workingDir: string) {
	const configPath = nodepath.join(workingDir, './.macro-ts.toml')
	// const configText = undefReadFile(configPath)
	// if (configText) {
	// 	//
	// }
	const configResult = parseMacroTsConfig(configPath)

	const [macrosEntry, entryFiles] = entryGlob !== undefined
		? [configResult.change(c => c.macros || defaultMacrosEntry).default(defaultMacrosEntry), glob([entryGlob])]
		: (() => {
			const { macros, packages } = configResult.unwrap()
			// TODO this isn't right
			// each of these projects could potentially have different environments etc.
			// so we need to go over each of these separately
			// the entire config parsing stage should probably be moved up a level,
			// and this function should take more precise inputs
			return t(
				macros || defaultMacrosEntry,
				packages.flatMap(({ location, entry }) => glob(flattenNonEmpty(entry).map(e => nodepath.join(location, e)))),
			)
		})()

	return { macrosEntry, entryFiles }
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

export function compile(entryGlob: string | undefined, devMode: boolean, emitOptions: EmitOptions | undefined) {
	const workingDir = process.cwd()
	const { macrosEntry, entryFiles } = produceConfig(entryGlob, workingDir)
	const { transformer, transformedTsSources } = produceTransformer(macrosEntry, workingDir)

	const initialProgram = ts.createProgram(entryFiles, nonEmitOptions)
	for (const sourceFile of initialProgram.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue
		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
		transformedTsSources.set(sourceFile.fileName, printer.printFile(newSourceFile))
	}

	const emitDirectory = './target/.dist'
	const compileOptions = {
		...alwaysOptions, ...makeDevModeOptions(devMode),
		...(
			emitOptions === undefined
				? nonEmitOptions
				: { outDir: emitDirectory, ...alwaysEmitOptions }
		),
	}
	const capturingCompilerHost = createInterceptingHost(workingDir, transformedTsSources, compileOptions)
	const transformedProgram = ts.createProgram(entryFiles, compileOptions, capturingCompilerHost)

	const diagnostics = emitOptions === undefined
		? ts.getPreEmitDiagnostics(transformedProgram)
		: exec(() => {
			fs.rmdirSync(emitDirectory, { recursive: true })
			return transformedProgram.emit().diagnostics
		})

	// TODO use diagnostic.category === ts.DiagnosticCategory.Error to see if any of these are actually severe
	if (diagnostics.length)
		reportDiagnostics(workingDir, diagnostics)
}

function check(entryGlob: string | undefined, devMode: boolean) {
	compile(entryGlob, devMode, undefined)
}
function build(entryGlob: string | undefined, devMode: boolean) {
	compile(entryGlob, devMode, true)
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
		getScriptVersion: (fileName: string) => {
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

	function compileWithService(code: string, fileName: string){
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
		// if (register.ignored(filename)) return old(mod, filename)
		// if (/(?:^|\/)node_modules\//.test(filename)) return jsHandler(mod, filename)

		const originalModuleCompile = mod._compile
		mod._compile = function(code: string, fileName: string) {
			return originalModuleCompile.call(this, compileWithService(code, fileName), fileName)
		}

		return jsHandler(mod, filename)
	}

	process.argv = ['node', nodepath.join(workingDir, entryFile), ...runArgs]
	Module.runMain()
}


function fatal(message: string): never {
	console.error(message)
	return process.exit(1)
}
function exit(message: string): never {
	console.log(message)
	return process.exit(0)
}

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

	// TODO
	if (help) exit('no help yet')
	if (version) exit('no version yet')

	switch (command) {
		case 'build':
			if (args.length > 1) fatal(`build can only accept one positional argument`)
			build(args[0], devMode)
			break

		case 'check':
			if (args.length > 1) fatal(`check can only accept one positional argument`)
			check(args[0], devMode)
			break

		case 'run':
			const entryFile = args[0]
			if (entryFile === undefined) fatal(`run expects a filename`)
			run(entryFile, args.slice(1), devMode)
			break

		default:
			fatal(`invalid command: ${command}`)
	}
}

if (require.main === module)
	main(process.argv.slice(2))
