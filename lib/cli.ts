import * as fs from 'fs'
import * as nodepath from 'path'
import yaml = require('js-yaml')
import ts = require('typescript')
import * as c from '@ts-std/codec'
import { sync as globSync } from 'glob'
import { Result, Ok, Err } from '@ts-std/monads'

import { Dict, tuple as t, exec } from './utils'
import { createTransformer, Macro, SourceChannel } from './transformer'

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

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
	transformedTsSources: Dict<string>,
	compilerOptions: ts.CompilerOptions,
): ts.CompilerHost {
	const defaultCompilerHost = ts.createCompilerHost(compilerOptions)
	// https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#customizing-module-resolution
	return {
		...defaultCompilerHost,
		getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
			if (!fileName.includes('node_modules')) {
				console.log('getSourceFile')
				console.log(fileName)
				console.log()
			}
			const transformedSource = transformedTsSources[nodepath.relative(workingDir, fileName)]
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
			return nodepath.relative(workingDir, fileName) in transformedTsSources || defaultCompilerHost.fileExists(fileName)
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

// type ScriptTarget = Exclude<ts.ScriptTarget, ts.ScriptTarget.JSON>
// const ScriptTarget = c.wrap<ScriptTarget>('ScriptTarget', input => {
// 	if (typeof input !== 'string') return Err()
// 	if (input in ScriptTarget) return ScriptTarget[]
// })

// type CompilationEnvironment = {
// 	environment: 'browser' | 'node' | 'anywhere',
// 	target: ScriptTarget,
// }
// const CompilationEnvironment = c.object<CompilationEnvironment>({
// 	environment: c.literals('browser', 'node', 'anywhere')
// 	target: ScriptTarget,
// })

// // anywhere kills @types/node by setting types: []
// // browser adds dom, webworker if target is >= es2015, kills @types/node by setting types: []
// // node doesn't kill @types/node
// // https://www.typescriptlang.org/docs/handbook/tsconfig-json.html#types-typeroots-and-types
// function parseCompilationEnvironment(rawEnv: unknown): CompilationEnvironment {
// 	if (typeof rawEnv === 'string') {
// 		const env = rawEnv.toLowerCase()
// 		switch (env) {
// 			case 'legacybrowser':
// 				return { environment: 'browser', target: ts.ScriptTarget.ES5 }
// 			case 'modernbrowser':
// 				return { environment: 'browser', target: ts.ScriptTarget.Latest }
// 			case 'node':
// 				return { environment: 'node', target: ts.ScriptTarget.Latest }
// 			case 'anywhere':
// 				return { environment: 'anywhere', target: ts.ScriptTarget.Latest }
// 			default:
// 				throw new Error()
// 		}
// 	}
// 	//
// }

// this means that they can have just a single thing to worry about, the environment they're compiling to
// if we make the reasonable assumption that if this is intended to be a browser *application*,
// that they'll be using a bundler that expects all code to be in esmodule style
// then we don't have to care about either the module options or the outDir/outFile options, we can just use target/.dist
// anyone wanting to build something more specific can just leverage the raw machinery in this package

const MacroTsConfig = c.object({
	macros: c.optional(c.string),
	packages: c.array(c.object({
		include: c.string,
		// target: c.wrap(parseCompilationEnvironment),
		// dev: c.optional(c.boolean),
	})),
})
type MacroTsConfig = c.TypeOf<typeof MacroTsConfig>

function parseMacroTsConfig(fileName: string) {
	return Result.attempt(() => yaml.safeLoad(fs.readFileSync(fileName, 'utf8')))
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


// type EmitOptions = {}
type EmitOptions = true
const defaultMacrosEntry = './.macro-ts.ts'

export function compile(entryGlob: string | undefined, devMode: boolean, emitOptions: EmitOptions | undefined) {
	const workingDir = process.cwd()

	const configPath = nodepath.join(workingDir, './.macro-ts.yml')
	const configResult = parseMacroTsConfig(configPath)

	const [macrosEntry, entryFiles] = entryGlob !== undefined
		// if they pass an entryGlob, then we assume they might be prototyping, so we don't get mad if we don't find a config file
		? [configResult.change(c => c.macros || defaultMacrosEntry).default(defaultMacrosEntry), globSync(entryGlob)]
		// if they don't pass one, then we *must* find a config file at the current working directory, so we can discover their list of packages
		: (() => {
			const config = configResult.unwrap()
			// TODO this isn't right
			// each of these projects could potentially have different environments etc.
			// so we need to go over each of these separately
			// the entire config parsing stage should probably be moved up a level,
			// and this function should take more precise inputs
			return t(config.macros || defaultMacrosEntry, config.packages.flatMap(p => globSync(p.include)))
		})()


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
			ts.createStringLiteral(`../lib/${mod}`),
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
	if (!foundMacros) {
		console.error("your macros file didn't export a `macros` identifier")
		process.exit(1)
	}

	const macrosCompilerHost = createInterceptingHost(workingDir, { [macrosEntry]: printer.printFile(newMacrosSourceFile) }, macrosOptions)
	const macrosProgram = ts.createProgram([macrosEntry], macrosOptions, macrosCompilerHost)
	fs.rmdirSync(macrosOptions.outDir, { recursive: true })
	const emitResult = macrosProgram.emit()
	const wereErrors = emitResult.emitSkipped
	if (wereErrors) {
		for (const diagnostic of emitResult.diagnostics)
			console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
		process.exit(1)
	}

	const macrosPath = nodepath.join(workingDir, './target/.macros/', nodepath.basename(macrosEntry, '.ts'))
	const macros: Dict<Macro> = require(macrosPath).macros


	function dirMaker(sourceFileName: string) {
		const currentDir = nodepath.relative(workingDir, nodepath.dirname(sourceFileName))
		const currentFile = nodepath.basename(sourceFileName)
		return { currentDir, currentFile }
	}
	const transformedTsSources: Dict<string> = {}
	const receivePayload: SourceChannel<undefined> = script => {
		if (!script) return
		const sourceFile = ts.createSourceFile(script.path, script.source, ts.ScriptTarget.ESNext)
		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
		transformedTsSources[script.path] = printer.printFile(newSourceFile)
	}
	const transformer = createTransformer(macros, receivePayload, workingDir, undefReadFile, dirMaker)


	const initialProgram = ts.createProgram(entryFiles, nonEmitOptions)
	for (const sourceFile of initialProgram.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue
		const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
		transformedTsSources[sourceFile.fileName] = printer.printFile(newSourceFile)
	}

	const emitDirectory = './target/.dist'
	const finalOptions = {
		...alwaysOptions, ...makeDevModeOptions(devMode),
		...(
			emitOptions === undefined
				? nonEmitOptions
				: { outDir: emitDirectory, ...alwaysEmitOptions }
		),
	}
	const capturingCompilerHost = createInterceptingHost(workingDir, transformedTsSources, finalOptions)
	const transformedProgram = ts.createProgram(entryFiles, finalOptions, capturingCompilerHost)

	const diagnostics = emitOptions === undefined
		? ts.getPreEmitDiagnostics(transformedProgram)
		: exec(() => {
			fs.rmdirSync(emitDirectory, { recursive: true })
			return transformedProgram.emit().diagnostics
		})

	// TODO use diagnostic.category === ts.DiagnosticCategory.Error to see if any of these are actually severe
	if (diagnostics.length) {
		for (const diagnostic of diagnostics)
			console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
		process.exit(1)
	}
}


function check(entryGlob: string | undefined, devMode: boolean) {
	compile(entryGlob, devMode, undefined)
}
function build(entryGlob: string | undefined, devMode: boolean) {
	compile(entryGlob, devMode, true)
}

import Module = require('module')
function run(entryFile: string, devMode: boolean) {
	// you don't have to do all the fancy stuff that ts-node does, in fact you can be really dumb and inefficient for now
	registerMacroTs(devMode)
	// /home/blaine/.nvm/versions/node/v12.18.2/bin/node
	process.argv = ['node', nodepath.join(workingDir, entryFile)]
	Module.runMain()
}

function registerMacroTs(devMode: boolean) {
	const jsHandler = require.extensions['.js']

	require.extensions['.ts'] = function(mod: any, filename) {
	  // if (register.ignored(filename)) return old(mod, filename)

	  const originalModuleCompile = mod._compile

	  mod._compile = function(code: string, fileName: string) {
	    debug('module._compile', fileName)

	    // const sourceFile = ts.createSourceFile(script.path, script.source, ts.ScriptTarget.ESNext)
	    // const { transformed: [newSourceFile] } = ts.transform(sourceFile, [transformer])
	    return originalModuleCompile.call(this, macroTsCompileCode(code, fileName), fileName)
	  }

	  return jsHandler(mod, filename)
	}
}


// console.log('checking')
// check('./app/main.ts', false)
// console.log('')

// console.log('building')
// build('./app/main.ts', false)
// console.log('')

console.log('running')
run('./app/main.ts', false)
console.log('')
