import * as ts from 'typescript'
import * as c from '@ts-std/codec'
import { Result, Ok, Err } from '@ts-std/monads'

import { NonEmptyOrSingle, Dict, UnboxArray, exec, longestMatchingStem } from './utils'

export type ScriptTarget = Exclude<ts.ScriptTarget, ts.ScriptTarget.JSON>
export const ScriptTarget = c.wrap<ScriptTarget>('ScriptTarget', input => {
	if (typeof input !== 'string') return Err(`invalid target: ${input}`)
	if (input.toLowerCase() === 'json') return Err(`the JSON target isn't supported`)
	if (input in ts.ScriptTarget)
		return Ok(ts.ScriptTarget[input as keyof typeof ts.ScriptTarget] as ScriptTarget)
	return Err(`invalid target: ${input}`)
})

export type CompilationEnvironment = {
	platform: 'browser' | 'webworker' | 'node' | 'anywhere',
	target: ScriptTarget,
}
export namespace CompilationEnvironment {
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
			case 'webworker':
				return Ok({ platform: 'webworker', target: ts.ScriptTarget.Latest })
			case 'node':
				return Ok({ platform: 'node', target: ts.ScriptTarget.Latest })
			case 'anywhere':
				return Ok({ platform: 'anywhere', target: ts.ScriptTarget.Latest })
		}
		return Err(`invalid environment shorthand: ${env}`)
	})

	const latestLib = exec((): string => {
		for (const key of Object.keys(ts.ScriptTarget)) {
			const value = ts.ScriptTarget[key as keyof typeof ts.ScriptTarget]
			if (key !== 'Latest' && value === ts.ScriptTarget.Latest)
				return `lib.${key.toLowerCase()}.d.ts`
		}
		throw new Error("There isn't a ts.ScriptTarget that isn't Latest but is equivalent to Latest")
	})
	export function options(
		{ platform, target }: CompilationEnvironment,
	): { module: ts.ModuleKind, lib: string[], types?: string[] } {
		const lib = [] as string[]
		if (target >= ts.ScriptTarget.ES2015)
			lib.push('lib.es2015.d.ts')
		if (target === ts.ScriptTarget.Latest)
			lib.push(latestLib)
		else if (target > ts.ScriptTarget.ES2015)
			lib.push(`lib.${ts.ScriptTarget[target].toLowerCase()}.d.ts`)

		// https://www.typescriptlang.org/docs/handbook/tsconfig-json.html#types-typeroots-and-types
		switch (platform) {
			case 'node':
				return { module: ts.ModuleKind.CommonJS, lib }
			case 'anywhere':
				return { module: ts.ModuleKind.ES2015, lib, types: [] }
			case 'browser':
			case 'webworker':
				lib.push(platform === 'browser' ? 'lib.dom.d.ts' : 'lib.webworker.d.ts')
				return { module: ts.ModuleKind.ES2015, lib, types: [] }
		}
	}
}

const StringNonEmptyOrSingle = NonEmptyOrSingle.decoder(c.string)

const RawMacroTsConfigDecoder = c.object({
	macros: c.optional(c.string),
	packages: c.array(c.object({
		location: c.string,
		entry: StringNonEmptyOrSingle,
		exclude: c.optional(StringNonEmptyOrSingle),
		// environment: NonEmptyOrSingle.decoder(CompilationEnvironment.decoder),
		environment: CompilationEnvironment.decoder,
		dev: c.optional(c.boolean),
	})),
})
type RawMacroTsConfig = c.TypeOf<typeof RawMacroTsConfigDecoder>
export type MacroTsConfigPackage = UnboxArray<RawMacroTsConfig['packages']>
export type MacroTsConfig = Omit<RawMacroTsConfig, 'packages'> & { packages: Dict<MacroTsConfigPackage> }
export namespace MacroTsConfig {
	export const decoder = c.wrap<MacroTsConfig>('MacroTsConfig', input => {
		const decodeResult = RawMacroTsConfigDecoder.decode(input)
		if (decodeResult.is_err()) return decodeResult
		const rawConfig = decodeResult.value

		const packages: Dict<MacroTsConfigPackage> = {}
		for (const pkg of rawConfig.packages) {
			const { location } = pkg
			if (location in packages) return Err(location)
			packages[location] = pkg
		}

		return Ok({ ...rawConfig, packages })
	})

	export function expect(result: Result<MacroTsConfig> | undefined): MacroTsConfig {
		if (result === undefined)
			throw new Error("undefined config")
		if (result.is_err())
			throw new Error("Invalid config:\n" + result.error)
		return result.value
	}

	export function decode(obj: unknown) {
		return decoder.decode(obj)
	}

	export function selectPackageForGlob(glob: string, { packages }: MacroTsConfig) {
		const longestLocation = longestMatchingStem(glob, Object.keys(packages))
		if (longestLocation === undefined) return undefined
		return packages[longestLocation]
	}
}
